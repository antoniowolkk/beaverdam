import { randomBytes, timingSafeEqual } from "node:crypto";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Request, RequestHandler } from "express";
import { config } from "../config.js";
import { pool } from "../db.js";
import { AppError } from "./errors.js";
import * as users from "../services/users.js";

const IDLE_MS = 30 * 60 * 1000;           // from the auth ADR
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;  // from the auth ADR

const PgStore = connectPgSimple(session);

export const sessions = session({
  store: new PgStore({ pool, tableName: "session", createTableIfMissing: false }), // table created by a migration
  name: "sid",
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // refresh maxAge on activity → idle timeout
  cookie: {
    httpOnly: true,
    // Staging runs NODE_ENV=production. Behind a TLS-terminating proxy this needs correct `trust proxy`,
    // or express-session silently refuses to set the cookie.
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: IDLE_MS,
  },
});

const promisify = (fn: (cb: (err?: unknown) => void) => void) =>
  new Promise<void>((ok, fail) => fn((err) => (err ? fail(err) : ok())));

export async function startSession(req: Request, userId: string): Promise<string> {
  await promisify((cb) => req.session.regenerate(cb)); // new session id on login
  req.session.userId = userId;
  req.session.createdAt = Date.now();
  req.session.csrf = randomBytes(32).toString("base64url");
  return req.session.csrf;
}

export const endSession = (req: Request) => promisify((cb) => req.session.destroy(cb));

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Global: every state-changing request must come from an allowed Origin.
export const checkOrigin: RequestHandler = (req, _res, next) => {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) {
    throw new AppError(403, "Request blocked.", `origin rejected: ${origin ?? "none"}`);
  }
  next();
};

// Per authenticated route: synchronizer token from the session, sent back in a header.
export const checkCsrf: RequestHandler = (req, _res, next) => {
  if (!UNSAFE.has(req.method)) return next();
  const sent = Buffer.from(req.get("x-csrf-token") ?? "");
  const expected = Buffer.from(req.session.csrf ?? "");
  if (expected.length === 0 || sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    throw new AppError(403, "Request blocked.", "csrf token mismatch");
  }
  next();
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  const s = req.session;
  if (!s.userId) throw new AppError(401, "Sign in required.");
  // Missing createdAt counts as expired: never let a malformed session skip the absolute timeout.
  if (!s.createdAt || Date.now() - s.createdAt > ABSOLUTE_MS) {
    await endSession(req);
    throw new AppError(401, "Session expired.");
  }
  // Re-read on every request so role changes and deactivation apply immediately.
  const user = await users.findActiveById(s.userId);
  if (!user) {
    await endSession(req);
    throw new AppError(401, "Sign in required.");
  }
  req.actor = { type: "user", id: user.id, role: user.role, orgId: user.org_id };
  next();
};

// Mounted after authenticate by secureRoute(), so CSRF is checked on every protected write.
export const authGuards: RequestHandler[] = [authenticate, checkCsrf];
