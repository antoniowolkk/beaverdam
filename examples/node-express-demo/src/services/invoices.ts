import { pool, type Queryable } from "../db.js";
import type { Actor } from "../security/actor.js";
import { AppError } from "../security/errors.js";

type Invoice = { id: string; customer_id: string; amount_cents: number; currency: string; note: string | null };

export async function get(actor: Actor, id: string): Promise<Invoice> {
  const { rows } = await pool.query<Invoice>(
    `SELECT id, customer_id, amount_cents, currency, note FROM invoices WHERE id = $1 AND org_id = $2`,
    [id, actor.orgId],
  );
  if (!rows[0]) throw new AppError(404, "Not found.");
  return rows[0];
}

export async function create(
  db: Queryable,
  actor: Actor,
  input: { customer_id: string; amount_cents: number; currency: string; note?: string },
): Promise<Invoice> {
  const { rows } = await db.query<Invoice>(
    `INSERT INTO invoices (org_id, customer_id, amount_cents, currency, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, customer_id, amount_cents, currency, note`,
    [actor.orgId, input.customer_id, input.amount_cents, input.currency, input.note ?? null, actor.id],
  );
  return rows[0];
}

export async function remove(db: Queryable, actor: Actor, id: string) {
  const { rowCount } = await db.query(
    `DELETE FROM invoices WHERE id = $1 AND org_id = $2`,
    [id, actor.orgId], // tenant from the session, never from the request
  );
  if (rowCount === 0) throw new AppError(404, "Not found.");
}
