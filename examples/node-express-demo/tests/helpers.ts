import request from "supertest";
import pg from "pg";
import { app } from "../src/app.js";
import { hashPassword } from "../src/security/passwords.js";
import type { Role } from "../src/security/permissions.js";
import { OWNER_URL, ORIGIN } from "./db-urls.js";

export const PASSWORD = "correct-horse-battery-staple";

// Owner connection for seeding and reset only. The app itself uses app_user.
export const owner = new pg.Pool({ connectionString: OWNER_URL, max: 2 });

export async function resetDb() {
  await owner.query(`TRUNCATE audit_log, invoices, users, orgs, session RESTART IDENTITY CASCADE`);
}

let n = 0;
export const seed = {
  async org(): Promise<{ id: string }> {
    const { rows } = await owner.query(`INSERT INTO orgs (name) VALUES ('org') RETURNING id`);
    return rows[0];
  },
  async user(role: Role, orgId?: string) {
    const org = orgId ?? (await seed.org()).id;
    const email = `user${++n}@example.test`;
    const { rows } = await owner.query(
      `INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, $2, $3, $4)
       RETURNING id, org_id, email, role`,
      [org, email, await hashPassword(PASSWORD), role],
    );
    return rows[0] as { id: string; org_id: string; email: string; role: Role };
  },
  async invoice(opts: { orgId?: string } = {}) {
    const creator = await seed.user("admin", opts.orgId);
    const { rows } = await owner.query(
      `INSERT INTO invoices (org_id, customer_id, amount_cents, currency, created_by)
       VALUES ($1, gen_random_uuid(), 1000, 'EUR', $2) RETURNING id, org_id`,
      [creator.org_id, creator.id],
    );
    return rows[0] as { id: string; org_id: string };
  },
};

export async function loginAs(role: Role) {
  const user = await seed.user(role);
  const agent = request.agent(app).set("Origin", ORIGIN);
  const res = await agent.post("/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
  return { agent, csrf: res.body.csrf_token as string, user };
}

export async function auditFor(requestId: string) {
  const { rows } = await owner.query(
    `SELECT action, result, actor_type, actor_id, resource_type, resource_id FROM audit_log WHERE request_id = $1 ORDER BY id`,
    [requestId],
  );
  return rows;
}
