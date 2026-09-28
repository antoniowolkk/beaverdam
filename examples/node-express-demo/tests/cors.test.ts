import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { owner } from "./helpers.js";
import { ORIGIN } from "./db-urls.js";

afterAll(async () => {
  await pool.end();
  await owner.end();
});

// Pattern A is same-site: the API sends no CORS headers at all, so a browser on
// another origin can never read a response, with or without credentials.
describe("CORS (pattern A)", () => {
  for (const origin of ["https://evil.example", ORIGIN]) {
    it(`no Access-Control-* headers for Origin ${origin}`, async () => {
      const get = await request(app).get("/health/live").set("Origin", origin);
      const preflight = await request(app)
        .options("/invoices")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type, x-csrf-token");
      for (const res of [get, preflight]) {
        expect(Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
      }
    });
  }
});
