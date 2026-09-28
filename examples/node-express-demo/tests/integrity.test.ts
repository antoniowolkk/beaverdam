import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import pino from "pino";
import { pool } from "../src/db.js";
import { logger, REDACT_PATHS } from "../src/logger.js";
import { SECRET_NAMES } from "../src/config.js";
import { loginAs, owner, resetDb } from "./helpers.js";

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe("audit write fails inside the handler's transaction", () => {
  beforeEach(async () => {
    // Owner-only test hook: make the audit insert for invoice.create fail, as a full disk or a bad column would.
    await owner.query(`CREATE FUNCTION fail_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'invoice.create' THEN RAISE EXCEPTION 'audit write refused (test)'; END IF; RETURN NEW; END $$`);
    await owner.query(`CREATE TRIGGER fail_create_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_create_audit()`);
  });
  afterEach(async () => {
    await owner.query(`DROP TRIGGER IF EXISTS fail_create_audit ON audit_log`);
    await owner.query(`DROP FUNCTION IF EXISTS fail_create_audit()`);
    vi.restoreAllMocks();
  });

  it("the request fails, nothing is stored, and the failure is logged", async () => {
    const errors = vi.spyOn(logger, "error");
    const { agent, csrf, user } = await loginAs("member");
    const res = await agent.post("/invoices").set("x-csrf-token", csrf)
      .send({ customer_id: "3f2c6b1e-8a4d-4c2b-9f1a-2b7e5d9c0a11", amount_cents: 1999, currency: "EUR" });

    expect(res.status).toBe(500);
    expect((await owner.query(`SELECT 1 FROM invoices WHERE org_id = $1`, [user.org_id])).rowCount).toBe(0);
    expect(errors.mock.calls.some((c) => c[1] === "audit write failed")).toBe(true);
  });
});

describe("logger redaction", () => {
  it("covers every secret name, top level and one level deep", () => {
    for (const name of SECRET_NAMES) {
      expect(REDACT_PATHS).toContain(name);
      expect(REDACT_PATHS).toContain(`*.${name}`);
    }
  });

  it("a logged config object prints no secret value", () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, { write: (l: string) => void lines.push(l) });
    const fake = Object.fromEntries(SECRET_NAMES.map((n) => [n, `value-of-${n}`]));
    log.info(fake);
    log.info({ config: fake });
    expect(lines.join("")).not.toMatch(/value-of-/);
  });
});
