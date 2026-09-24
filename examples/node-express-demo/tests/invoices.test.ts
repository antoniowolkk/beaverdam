import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { loginAs, seed, resetDb, owner, auditFor } from "./helpers.js";
import { ORIGIN } from "./db-urls.js";

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe("DELETE /invoices/:id", () => {
  it("401 without a session", async () => {
    const inv = await seed.invoice();
    await request(app).delete(`/invoices/${inv.id}`).set("Origin", ORIGIN).expect(401);
  });

  it("403 for a member, and the denial is audited", async () => {
    const { agent, csrf, user } = await loginAs("member");
    const inv = await seed.invoice({ orgId: user.org_id });
    const res = await agent.delete(`/invoices/${inv.id}`).set("x-csrf-token", csrf).expect(403);
    expect(await auditFor(res.headers["x-request-id"])).toEqual([
      { action: "access.denied", result: "denied", actor_type: "user", actor_id: user.id, resource_type: "permission", resource_id: "invoice.delete" },
    ]);
  });

  it("404 for another org's invoice, which is left intact", async () => {
    const { agent, csrf } = await loginAs("admin");
    const other = await seed.invoice();
    await agent.delete(`/invoices/${other.id}`).set("x-csrf-token", csrf).expect(404);
    expect((await owner.query(`SELECT 1 FROM invoices WHERE id = $1`, [other.id])).rowCount).toBe(1);
  });

  it("400 for a malformed id", async () => {
    const { agent, csrf } = await loginAs("admin");
    await agent.delete(`/invoices/not-a-uuid`).set("x-csrf-token", csrf).expect(400);
  });

  it("403 without the CSRF token", async () => {
    const { agent, user } = await loginAs("admin");
    const inv = await seed.invoice({ orgId: user.org_id });
    await agent.delete(`/invoices/${inv.id}`).expect(403);
  });

  it("403 from a foreign Origin even with a valid token", async () => {
    const { agent, csrf, user } = await loginAs("admin");
    const inv = await seed.invoice({ orgId: user.org_id });
    await agent.delete(`/invoices/${inv.id}`).set("Origin", "https://evil.example").set("x-csrf-token", csrf).expect(403);
  });

  it("204 for an admin, with exactly one audit entry", async () => {
    const { agent, csrf, user } = await loginAs("admin");
    const inv = await seed.invoice({ orgId: user.org_id });
    const res = await agent.delete(`/invoices/${inv.id}`).set("x-csrf-token", csrf).expect(204);
    expect(await auditFor(res.headers["x-request-id"])).toEqual([
      { action: "invoice.delete", result: "success", actor_type: "user", actor_id: user.id, resource_type: "invoice", resource_id: inv.id },
    ]);
  });
});

describe("POST /invoices", () => {
  const valid = { customer_id: "3f2c6b1e-8a4d-4c2b-9f1a-2b7e5d9c0a11", amount_cents: 1999, currency: "EUR" };

  it("201 and audited", async () => {
    const { agent, csrf, user } = await loginAs("member");
    const res = await agent.post("/invoices").set("x-csrf-token", csrf).send(valid).expect(201);
    expect(await auditFor(res.headers["x-request-id"])).toEqual([
      { action: "invoice.create", result: "success", actor_type: "user", actor_id: user.id, resource_type: "invoice", resource_id: res.body.id },
    ]);
  });

  it("400 for an unknown field (mass assignment)", async () => {
    const { agent, csrf } = await loginAs("member");
    await agent.post("/invoices").set("x-csrf-token", csrf).send({ ...valid, org_id: "3f2c6b1e-8a4d-4c2b-9f1a-2b7e5d9c0a11" }).expect(400);
  });

  it("400 for a float amount", async () => {
    const { agent, csrf } = await loginAs("member");
    await agent.post("/invoices").set("x-csrf-token", csrf).send({ ...valid, amount_cents: 19.99 }).expect(400);
  });
});

describe("POST /auth/login", () => {
  it("failed login is audited as denied, anonymous, same message for unknown user", async () => {
    const user = await seed.user("member");
    const wrongPw = await request(app).post("/auth/login").set("Origin", ORIGIN).send({ email: user.email, password: "nope" }).expect(401);
    const unknown = await request(app).post("/auth/login").set("Origin", ORIGIN).send({ email: "ghost@example.test", password: "nope" }).expect(401);
    expect(wrongPw.body.error).toBe(unknown.body.error);
    expect(await auditFor(wrongPw.headers["x-request-id"])).toEqual([
      { action: "auth.login", result: "denied", actor_type: "anonymous", actor_id: null, resource_type: "user", resource_id: user.id },
    ]);
  });

  it("session cookie is HttpOnly and SameSite", async () => {
    const user = await seed.user("member");
    const res = await request(app).post("/auth/login").set("Origin", ORIGIN).send({ email: user.email, password: "correct-horse-battery-staple" }).expect(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("returns 429 with Retry-After after 5 failures for one account", async () => {
    const body = { email: "a@example.test", password: "wrong-password" };
    for (let i = 0; i < 5; i++) {
      await request(app).post("/auth/login").set("Origin", ORIGIN).send(body).expect(401);
    }
    const res = await request(app).post("/auth/login").set("Origin", ORIGIN).send(body).expect(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

describe("POST /auth/logout", () => {
  it("ends the session", async () => {
    const { agent, csrf, user } = await loginAs("member");
    const inv = await seed.invoice({ orgId: user.org_id });
    await agent.post("/auth/logout").set("x-csrf-token", csrf).expect(204);
    await agent.get(`/invoices/${inv.id}`).expect(401);
  });
});

describe("audit log is append-only for the app", () => {
  it("app_user cannot update or delete audit rows", async () => {
    await expect(pool.query(`UPDATE audit_log SET result = 'success'`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/);
  });
});

describe("no secrets in responses", () => {
  it("error bodies never contain config values or stack traces", async () => {
    const res = await request(app).get("/does-not-exist").expect(404);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/at .+\.(ts|js):\d+/);
    for (const name of ["DATABASE_URL", "SESSION_SECRET"]) {
      const value = process.env[name];
      if (value) expect(text).not.toContain(value);
    }
    expect(res.body.request_id).toBeTypeOf("string");
  });
});
