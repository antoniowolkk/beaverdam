import { describe, it, expect, afterAll, vi } from "vitest";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { routeInventory } from "../src/security/inventory.js";
import { owner } from "./helpers.js";

afterAll(async () => {
  await pool.end();
  await owner.end();
});

// First column of the "Entry points" table in docs/threat-model.md, e.g. `DELETE /invoices/:id`.
async function documentedEntryPoints() {
  const doc = await readFile("docs/threat-model.md", "utf8");
  const section = doc.split(/^## Entry points$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();
}

describe("endpoint inventory", () => {
  it("every live route is in the threat model, and every listed route is live", async () => {
    expect(routeInventory(app)).toEqual(await documentedEntryPoints());
  });
});

describe("health", () => {
  it("live: 200 with a status only", async () => {
    const res = await request(app).get("/health/live").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("ready: 200 with a status only when the database answers", async () => {
    const res = await request(app).get("/health/ready").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("ready: 503 and no error detail when the database is down", async () => {
    const spy = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const res = await request(app).get("/health/ready").expect(503);
    spy.mockRestore();
    expect(res.body).toEqual({ status: "unavailable" });
  });

  it("health checks are rate limited like any public route", async () => {
    const res = await request(app).get("/health/live").expect(200);
    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});
