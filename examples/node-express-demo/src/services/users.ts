import { pool, type Queryable } from "../db.js";
import type { Role } from "../security/permissions.js";

export type UserRow = { id: string; org_id: string; email: string; password_hash: string; role: Role; active: boolean };

export async function findByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, org_id, email, password_hash, role, active FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findActiveById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, org_id, email, password_hash, role, active FROM users WHERE id = $1 AND active`,
    [id],
  );
  return rows[0] ?? null;
}
