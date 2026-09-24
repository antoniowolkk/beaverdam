import type { Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { pool, withTx, type Queryable } from "../db.js";
import { logger } from "../logger.js";
import { AppError, routeOf } from "./errors.js";

// Fixed list. Add here before using a new action.
export const ACTIONS = [
  "auth.login", "auth.logout", "auth.refresh", "auth.refresh_reuse",
  "auth.password_change", "auth.reset_request", "auth.reset_complete",
  "access.denied",
  "invoice.create", "invoice.delete",
  "member.role_change",
  "data.export",
] as const;
export type Action = (typeof ACTIONS)[number];

// The action fails if its audit entry cannot be written.
const MUST_PERSIST = new Set<Action>(["invoice.delete", "member.role_change", "data.export", "auth.password_change"]);

export type Resource = { type: string; id: string | null };
type Result = "success" | "denied" | "error";

export async function audit(
  req: Request,
  action: Action,
  resource: Resource,
  result: Result,
  detail: Record<string, unknown> = {},
  opts: { db?: Queryable; kind?: "audit" | "security" } = {},
) {
  const actor = req.actor
    ? { type: req.actor.type, id: req.actor.id, role: req.actor.role }
    : { type: "anonymous" as const, id: null, role: null };
  const source = { ip: req.ip ?? null, route: routeOf(req) };
  const kind = opts.kind ?? "audit";

  logger.info({ kind, request_id: req.id, actor, action, resource, result, source, detail }, action);

  try {
    await (opts.db ?? pool).query(
      `INSERT INTO audit_log
         (kind, request_id, actor_type, actor_id, actor_role, action, resource_type, resource_id, result, ip, route, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [kind, req.id, actor.type, actor.id, actor.role, action, resource.type, resource.id, result, source.ip, source.route, detail],
    );
  } catch (err) {
    logger.error({ kind: "security", err, action, request_id: req.id }, "audit write failed");
    if (MUST_PERSIST.has(action)) throw err;
  }
}

// ---- audited(): the only way to write a state-changing handler ----

declare const AUDITED: unique symbol;
export type AuditedHandler = RequestHandler & { readonly [AUDITED]: true };

export type AuditCtx = { db: pg.PoolClient; resource: Resource; detail: Record<string, unknown> };
type Reply = { status: number; body?: unknown };

/**
 * Runs the handler in a transaction, writes the success audit entry in the same transaction,
 * and only then sends the response. On any error, rolls back, audits denied/error, rethrows.
 */
export function audited(
  action: Action,
  fn: (req: Request, res: Response, ctx: AuditCtx) => Promise<Reply>,
): AuditedHandler {
  const handler: RequestHandler = async (req, res) => {
    // One object shared with the handler, so ctx.resource set inside fn is visible on the error path.
    const ctx = { resource: { type: action.split(".")[0], id: null }, detail: {} } as AuditCtx;
    let reply: Reply;
    try {
      reply = await withTx(async (db) => {
        ctx.db = db;
        const r = await fn(req, res, ctx);
        await audit(req, action, ctx.resource, "success", ctx.detail, { db });
        return r;
      });
    } catch (err) {
      const result = err instanceof AppError && err.status < 500 ? "denied" : "error";
      await audit(req, action, ctx.resource, result, ctx.detail).catch(() => {}); // already logged inside audit()
      throw err;
    }
    reply.body === undefined ? res.status(reply.status).end() : res.status(reply.status).json(reply.body);
  };
  return handler as AuditedHandler;
}
