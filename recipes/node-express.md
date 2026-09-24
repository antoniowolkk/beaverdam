# Recipe: Node + Express + Postgres

How each part of the spine in `AGENTS.md` section 5 looks in a Node/Express backend on Postgres. Read the matching section here alongside the skill in `skills/`. The skill says what the rule is; this file says how to write it in this stack.

Code is TypeScript, ESM, Express 5. Where a pattern depends on which auth pattern the project's ADR picked, both are shown: keep one, delete the other.

Installing any package below needs a yes first (`AGENTS.md` section 7). The versions below are the ones pattern A was last proven against in `examples/node-express-demo/` (type check + 16 integration tests on real Postgres, 2026-09-24). Pattern B (section 6) and the Redis store type-check but have not been run end to end. If a major has moved since, check the changelog for the APIs used here before copying code.

## Stack

| Concern | Package | Proven with | Why this one |
| --- | --- | --- | --- |
| Runtime | Node | 24 (22 LTS or newer) | Built-in `--env-file`, `crypto.randomUUID`, stable ESM |
| HTTP | `express` | 5.2 | Rejected promises in async handlers reach the error handler without a wrapper |
| DB driver | `pg` | 8.23 | Parameterized queries (`$1`), plain SQL, no ORM magic hiding queries |
| Migrations | `node-pg-migrate` | 9 (not exercised by the demo) | SQL-first, runs as a separate DB role |
| Validation | `zod` | 4.6 | `z.strictObject` rejects unknown fields |
| Logging | `pino`, `pino-http` | 10.3, 11.0 | JSON to stdout, built-in redaction, request ids |
| Security headers | `helmet` | 8.3 | Sensible defaults for headers |
| Rate limiting | `express-rate-limit` | 8.7 | `ipKeyGenerator` handles IPv6 correctly |
| Rate-limit store | `rate-limit-redis` + `redis` | 6.0, 6.2 (type-checked only) | Shared counters across instances. Skip only on a single long-running instance. |
| Passwords | `argon2` | 0.45 | argon2id by default |
| Sessions (pattern A) | `express-session` + `connect-pg-simple` | 1.19, 10.0 | Server-side sessions stored in Postgres |
| Tokens (pattern B) | `jose` | 6 (not exercised by the demo) | Maintained, explicit algorithm allowlist |
| Tests | `vitest` + `supertest` | 5.0, 7.3 (TypeScript 7.0) | Hit the real app over HTTP in tests |

CSRF (pattern A) is written by hand below with `node:crypto`. It is about fifteen lines and avoids depending on a CSRF package whose API has changed across majors.

## Layout

```
src/
  config.ts              the only file that reads process.env
  logger.ts              the one logger, with redaction
  db.ts                  pool, withTx, Queryable
  server.ts              starts the app
  app.ts                 middleware order lives here and nowhere else
  types.d.ts             Request.actor, SessionData
  security/
    actor.ts             Actor type, actorOf(req)
    errors.ts            AppError, errorHandler, notFound
    validate.ts          validate() middleware
    passwords.ts         hashPassword, verifyPassword, DUMMY_HASH
    session.ts           pattern A: sessions, checkOrigin, checkCsrf, authenticate
    tokens.ts            pattern B: issue/verify access, rotate refresh, authenticate
    permissions.ts       ROLES, PERMISSIONS, can()
    secure-route.ts      secureRoute(): the only way to register a route
    audit.ts             ACTIONS, audit(), audited()
    limits.ts            LIMITS config + limiter factory
  routes/                one file per resource, thin
  services/              business logic, takes Actor + validated data, never req
  schemas/               zod schemas per resource
migrations/
tests/
```

## Commands for `AGENTS.md` section 4

Suggested `package.json` scripts. The project's real scripts win; update section 4 to match.

| Purpose | Command |
| --- | --- |
| Install deps | `npm ci` |
| Run dev server | `tsx watch --env-file=.env src/server.ts` (Node's own type stripping does not rewrite the `.js` import specifiers used here) |
| Run all tests | `npx vitest run` |
| Run one test file | `npx vitest run tests/invoices.test.ts` |
| Lint | `npx eslint .` |
| Type check | `npx tsc --noEmit` |
| New migration (write only) | `npx node-pg-migrate create <name> --migration-file-language sql` |
| Secret scan | `gitleaks protect --staged` (newer gitleaks: `gitleaks git --staged`; check `gitleaks --help`) |

---

## 1. Config and secrets → `skills/secrets-handling.md`

One file reads the environment. Everything else imports `config`. Startup fails, naming the missing variables but never their values.

```ts
// src/config.ts
import { z } from "zod";
import { logger } from "./logger.js";

const csv = z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  // Number of proxies in front of the app. 0 = none. Never `true`. See section 10.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  ALLOWED_ORIGINS: csv,
  REDIS_URL: z.string().url().optional(),

  // Pattern A — keep if the auth ADR chose sessions.
  SESSION_SECRET: z.string().min(32),

  // Pattern B — keep if the auth ADR chose tokens.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  // Paths only. An issue message can contain the received value.
  logger.fatal(
    { kind: "app", missing_or_invalid: parsed.error.issues.map((i) => i.path.join(".")) },
    "invalid configuration",
  );
  process.exit(1);
}

export const config = Object.freeze(parsed.data);

// Mirrors the secret names in docs/secrets.md. Used by tests to check nothing leaks.
export const SECRET_NAMES = ["DATABASE_URL", "SESSION_SECRET", "JWT_SECRET", "REDIS_URL"] as const;
```

`.env.example`:

```bash
# Names only. Real values live in <secrets source from AGENTS.md section 3>.
NODE_ENV=
PORT=
DATABASE_URL=
TRUST_PROXY_HOPS=
ALLOWED_ORIGINS=
REDIS_URL=
SESSION_SECRET=
JWT_SECRET=
JWT_ISSUER=
JWT_AUDIENCE=
```

`.gitignore` contains `.env` and `.env.*` with `!.env.example`, before the first commit.

## 2. Logger and request id → `skills/audit-log.md`

One logger. JSON with the field names from the audit schema. Redaction at the logger, so a careless call site still cannot leak a secret.

```ts
// src/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined, // no pid/hostname noise; the platform adds its own
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    // `*.x` matches one level deep. Add a path when you add a nested secret-bearing field.
    paths: [
      "password", "*.password", "new_password", "*.new_password",
      "token", "*.token", "refresh_token", "*.refresh_token", "access_token", "*.access_token",
      "secret", "*.secret", "api_key", "*.api_key",
      "req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']",
      "res.headers['set-cookie']",
    ],
    censor: "[REDACTED]",
  },
});
```

Request logging and the request id:

```ts
// src/logger.ts (continued)
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";

export const httpLogger = pinoHttp({
  logger,
  // Generate our own. Only reuse an incoming X-Request-Id if it is set by a proxy you control.
  genReqId: (_req, res) => {
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: () => ({ kind: "app" }),
  // Log method + path, not the full request. Query strings can carry tokens.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, path: req.url?.split("?")[0] }),
    res: (res) => ({ status: res.statusCode }),
  },
});
```

After this middleware, `req.id` is the request id and `req.log` is a child logger that includes it. Use `req.log` inside handlers. No `console.*` anywhere in `src/`.

## 3. Errors → `AGENTS.md` section 5.7

One error type, one handler, registered last. The client gets a safe message and the request id. The server log gets everything.

```ts
// src/security/errors.ts
import type { ErrorRequestHandler, Request, RequestHandler } from "express";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    readonly detail?: string, // internal only, never sent
  ) {
    super(detail ?? publicMessage);
  }
}

export const routeOf = (req: Request) => `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;

const SAFE: Record<number, string> = {
  400: "Invalid request.",
  401: "Sign in required.",
  403: "You don't have access to this.",
  404: "Not found.",
  409: "Conflict.",
  413: "Request too large.",
  429: "Too many requests. Try again later.",
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Body-parser and similar set err.status for client errors.
  const status =
    err instanceof AppError ? err.status
    : typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status
    : 500;

  req.log.error(
    { kind: "app", err, status, route: routeOf(req), actor_id: req.actor?.id ?? null },
    "request failed",
  );

  const message = err instanceof AppError ? err.publicMessage : (SAFE[status] ?? "Something went wrong.");
  res.status(status).json({ error: message, request_id: req.id });
};

export const notFound: RequestHandler = () => {
  throw new AppError(404, SAFE[404]);
};
```

Rules in this stack:
- Throw `AppError` for anything the client should see. Everything else becomes a 500 with a generic message.
- Express 5 forwards rejected promises from async handlers to `errorHandler`. Do not add `try/catch` just to call `next(err)`.
- Never `catch {}` with an empty body. If you catch, log with `req.log` and rethrow or return a deliberate response.

## 4. Input validation → `skills/input-validation.md`

A `validate()` middleware parses params, query, and body against zod schemas. Handlers read the parsed result from `res.locals.valid` only. In Express 5, `req.query` is a read-only getter, so do not try to overwrite it with parsed data.

```ts
// src/security/validate.ts
import type { RequestHandler } from "express";
import type { ZodType } from "zod";

type Schemas = { params?: ZodType; query?: ZodType; body?: ZodType };

export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const valid: Record<string, unknown> = {};
    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        res.status(400).json({
          error: "Invalid input.",
          fields: result.error.issues.map((i) => ({ path: [part, ...i.path].join("."), message: i.message })),
          request_id: req.id,
        });
        return;
      }
      valid[part] = result.data;
    }
    res.locals.valid = valid;
    next();
  };
}
```

Schemas use `z.strictObject` so unknown fields are rejected. Every string and array is bounded.

```ts
// src/schemas/invoices.ts
import { z } from "zod";

export const IdParam = z.strictObject({ id: z.string().uuid() });

export const CreateInvoice = z.strictObject({
  customer_id: z.string().uuid(),
  amount_cents: z.number().int().positive().max(100_000_000), // integer minor units, never floats
  currency: z.enum(["EUR", "USD"]),
  note: z.string().trim().max(500).optional(),
});

export const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
  sort: z.enum(["created_at", "amount_cents"]).default("created_at"), // allowlist → safe to map to a column
});
```

Queries always bind values as parameters. Identifiers (sort columns) go through an allowlist map, never interpolated from input:

```ts
const SORT_COLUMNS = { created_at: "created_at", amount_cents: "amount_cents" } as const;

await db.query(
  `SELECT id, amount_cents, status FROM invoices
   WHERE org_id = $1 ORDER BY ${SORT_COLUMNS[query.sort]} DESC LIMIT $2`,
  [actor.orgId, query.limit],
);
```

Body size cap is set once in `app.ts`: `express.json({ limit: "100kb" })`. Raise it per route only for endpoints that need it, never globally.

**Webhooks:** verify the signature against the raw body before parsing. Mount the webhook route with `express.raw({ type: "application/json", limit: "1mb" })` ahead of the global `express.json()`, verify with the provider's SDK or `crypto.timingSafeEqual` on an HMAC, check the timestamp tolerance, then `JSON.parse` and validate with zod.

## 5. Auth, pattern A: session cookie + CSRF → `skills/auth-spine.md`

```ts
// src/security/session.ts
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
```

Session table migration (the columns `connect-pg-simple` expects):

```sql
CREATE TABLE session (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);
```

Login and logout are in section 9, because they use `audited()`.

## 6. Auth, pattern B: access token + refresh token → `skills/auth-spine.md`

```ts
// src/security/tokens.ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Request, RequestHandler } from "express";
import { config } from "../config.js";
import { withTx, type Queryable } from "../db.js";
import { AppError } from "./errors.js";
import { audit } from "./audit.js";
import * as users from "../services/users.js";

const key = new TextEncoder().encode(config.JWT_SECRET);
const ACCESS_TTL = "10m";                            // from the auth ADR
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;     // from the auth ADR

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

export function issueAccessToken(userId: string, familyId: string) {
  // Minimal claims. Role is read from the DB per request, not trusted from the token.
  return new SignJWT({ sid: familyId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(key);
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = (req.get("authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token) throw new AppError(401, "Sign in required.");

  let sub: string | undefined;
  let sid: unknown;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"], // pinned; rejects `none` and algorithm confusion
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }); // exp checked by jose
    sub = payload.sub;
    sid = payload.sid;
  } catch {
    throw new AppError(401, "Sign in required.", "access token rejected");
  }

  const user = sub ? await users.findActiveById(sub) : null;
  if (!user || typeof sid !== "string" || !(await users.isFamilyActive(sid))) {
    throw new AppError(401, "Sign in required.");
  }
  req.actor = { type: "user", id: user.id, role: user.role, orgId: user.org_id };
  next();
};

export const authGuards: RequestHandler[] = [authenticate];

export async function issueRefreshToken(db: Queryable, userId: string, familyId = randomUUID()) {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO refresh_tokens (family_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond')`,
    [familyId, userId, sha256(token), REFRESH_TTL_MS],
  );
  return { token, familyId };
}

type RotateOutcome =
  | { ok: true; userId: string; familyId: string; token: string }
  | { ok: false; reason: "invalid" | "reused" };

export async function rotateRefreshToken(req: Request, presented: string): Promise<RotateOutcome> {
  // Returns instead of throwing on reuse: throwing inside withTx would roll back the revocation.
  return withTx(async (db) => {
    const { rows: [row] } = await db.query(
      `SELECT id, family_id, user_id, used_at, revoked_at, expires_at
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [sha256(presented)],
    );
    if (!row || row.revoked_at || row.expires_at < new Date()) return { ok: false, reason: "invalid" };

    if (row.used_at) {
      await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id]);
      await audit(req, "auth.refresh_reuse", { type: "user", id: row.user_id }, "denied", { family_id: row.family_id }, { db, kind: "security" });
      return { ok: false, reason: "reused" };
    }

    await db.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.id]);
    const next = await issueRefreshToken(db, row.user_id, row.family_id);
    return { ok: true, userId: row.user_id, familyId: row.family_id, token: next.token };
  });
}
```

```sql
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,  -- sha256 of a 256-bit random token; never the token itself
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
```

`users.isFamilyActive(sid)` returns false when every token in the family is revoked, so logout and reuse detection also kill the outstanding access token on its next request, not only at expiry.

Web clients get the refresh token as a cookie scoped to the refresh route. Mobile clients get it in the response body and store it in Keychain/Keystore.

```ts
res.cookie("rt", token, {
  httpOnly: true, secure: true, sameSite: "strict",
  path: "/auth/refresh", maxAge: REFRESH_TTL_MS,
});
```

Pattern B with a browser frontend on another origin needs CORS with an explicit origin list (`cors({ origin: config.ALLOWED_ORIGINS, credentials: true })`). Adding or changing CORS needs an ADR (`AGENTS.md` section 7).

## 7. Passwords (both patterns) → `skills/auth-spine.md`

```ts
// src/security/passwords.ts
import { randomBytes } from "node:crypto";
import argon2 from "argon2";

// argon2 defaults are argon2id, 64 MiB, t=3, p=4 — above the OWASP minimum. Do not lower them.
export const hashPassword = (plain: string) => argon2.hash(plain, { type: argon2.argon2id });
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain);

// Verified against when the email does not exist, so both paths take the same time.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));
```

```ts
// src/schemas/auth.ts
export const Login = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
export const NewPassword = z.string().min(12).max(128);
```

Password reset tokens: `randomBytes(32).toString("base64url")`, stored as `sha256`, `expires_at = now() + interval '1 hour'`, `used_at` set on use in the same transaction that changes the password, and all sessions or refresh families for the user revoked in that transaction. The request endpoint returns the same response whether or not the email exists.

## 8. RBAC and `secureRoute()` → `skills/rbac.md`

Roles and permissions mirror the role matrix in `docs/prd.md` or the ADR. Do not add one here that is not there.

```ts
// src/security/actor.ts
import type { Request } from "express";
import { AppError } from "./errors.js";
import type { Role } from "./permissions.js";

export type Actor = { type: "user" | "service" | "agent"; id: string; role: Role; orgId: string };

export function actorOf(req: Request): Actor {
  if (!req.actor) throw new AppError(401, "Sign in required.");
  return req.actor;
}
```

```ts
// src/security/permissions.ts
import type { RequestHandler } from "express";
import { AppError } from "./errors.js";
import { audit } from "./audit.js";

export const ROLES = ["member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

// One entry per row of the role matrix.
export const PERMISSIONS = {
  "session.self":       ["member", "admin", "owner"], // any signed-in user acting on their own session
  "invoice.read_own":   ["member", "admin", "owner"],
  "invoice.read_any":   ["admin", "owner"],
  "invoice.create":     ["member", "admin", "owner"],
  "invoice.delete":     ["admin", "owner"],
  "member.role_change": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(permission: Permission): RequestHandler {
  const allowed: readonly Role[] = PERMISSIONS[permission];
  return async (req, _res, next) => {
    if (!req.actor) throw new AppError(401, "Sign in required.");
    if (!allowed.includes(req.actor.role)) {
      await audit(req, "access.denied", { type: "permission", id: permission }, "denied");
      throw new AppError(403, "You don't have access to this.");
    }
    next();
  };
}
```

**Deny by default, by construction.** Routes are only registered through `secureRoute()`. It requires an access declaration and, through the type signature, requires that every write route ends in an `audited()` handler (section 9). A write route without an audit entry does not type-check.

```ts
// src/security/secure-route.ts
import type { RequestHandler, Router } from "express";
import { authGuards } from "./session.js"; // or "./tokens.js" for pattern B
import { can, type Permission } from "./permissions.js";
import { limiter } from "./limits.js";
import type { AuditedHandler } from "./audit.js";

type Access =
  | { public: true; expensive?: boolean }
  | { permission: Permission; expensive?: boolean };

type ReadMethod = "get";
type WriteMethod = "post" | "put" | "patch" | "delete";

const anonDefault = limiter("anonDefault", "ip");
const authedDefault = limiter("authedDefault", "user");
const expensive = limiter("expensive", "user");
const expensiveAnon = limiter("expensive", "ip");

export function secureRoute(router: Router, method: ReadMethod, path: string, access: Access, ...handlers: RequestHandler[]): void;
export function secureRoute(router: Router, method: WriteMethod, path: string, access: Access, ...handlers: [...RequestHandler[], AuditedHandler]): void;
export function secureRoute(router: Router, method: ReadMethod | WriteMethod, path: string, access: Access, ...handlers: RequestHandler[]) {
  const guards: RequestHandler[] =
    "public" in access
      ? [anonDefault, ...(access.expensive ? [expensiveAnon] : [])]
      : [...authGuards, authedDefault, ...(access.expensive ? [expensive] : []), can(access.permission)];
  router[method](path, ...guards, ...handlers);
}
```

Ownership lives in the service, as a scoped query. Not found and not yours are the same 404.

```ts
// src/services/invoices.ts
import type { Queryable } from "../db.js";
import type { Actor } from "../security/actor.js";
import { AppError } from "../security/errors.js";

export async function remove(db: Queryable, actor: Actor, id: string) {
  const { rowCount } = await db.query(
    `DELETE FROM invoices WHERE id = $1 AND org_id = $2`,
    [id, actor.orgId], // tenant from the session, never from the request
  );
  if (rowCount === 0) throw new AppError(404, "Not found.");
}
```

Postgres RLS is the optional second layer: `ALTER TABLE invoices ENABLE ROW LEVEL SECURITY` with a policy on `org_id = current_setting('app.org_id')::uuid`, and `SET LOCAL app.org_id = $1` at the start of each transaction. It adds a guard, not a replacement for the scoped query. Decide it in an ADR.

## 9. Audit writer and `audited()` → `skills/audit-log.md`

```ts
// src/db.ts
import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, statement_timeout: 5000 });
export type Queryable = Pick<pg.PoolClient, "query">;

export async function withTx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

```ts
// src/security/audit.ts
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
```

Audit table. Migrations run as a separate owner role; the app connects as `app_user`, which can insert and read but never change history. A table owner can always re-grant itself, so the app role must not own it.

```sql
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp     timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind IN ('audit', 'security')),
  request_id    text,
  actor_type    text NOT NULL,
  actor_id      text,
  actor_role    text,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   text,
  result        text NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  ip            inet,
  route         text,
  detail        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, timestamp);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_type, resource_id, timestamp);

REVOKE ALL ON audit_log FROM app_user;
GRANT INSERT, SELECT ON audit_log TO app_user;
```

### Putting it together: a resource route

```ts
// src/routes/invoices.ts
import { Router } from "express";
import type { z } from "zod";
import { secureRoute } from "../security/secure-route.js";
import { validate } from "../security/validate.js";
import { audited } from "../security/audit.js";
import { actorOf } from "../security/actor.js";
import { CreateInvoice, IdParam } from "../schemas/invoices.js";
import * as invoiceService from "../services/invoices.js";

export const invoices = Router();

secureRoute(invoices, "get", "/:id", { permission: "invoice.read_own" },
  validate({ params: IdParam }),
  async (req, res) => {
    const { params } = res.locals.valid as { params: z.infer<typeof IdParam> };
    res.json(await invoiceService.get(actorOf(req), params.id));
  },
);

secureRoute(invoices, "post", "/", { permission: "invoice.create" },
  validate({ body: CreateInvoice }),
  audited("invoice.create", async (req, res, ctx) => {
    const { body } = res.locals.valid as { body: z.infer<typeof CreateInvoice> };
    const invoice = await invoiceService.create(ctx.db, actorOf(req), body);
    ctx.resource = { type: "invoice", id: invoice.id };
    ctx.detail = { currency: body.currency }; // non-sensitive only
    return { status: 201, body: invoice };
  }),
);

secureRoute(invoices, "delete", "/:id", { permission: "invoice.delete" },
  validate({ params: IdParam }),
  audited("invoice.delete", async (req, res, ctx) => {
    const { params } = res.locals.valid as { params: z.infer<typeof IdParam> };
    ctx.resource = { type: "invoice", id: params.id }; // set before anything can throw
    await invoiceService.remove(ctx.db, actorOf(req), params.id);
    return { status: 204 };
  }),
);
```

### Login and logout (pattern A)

```ts
// src/routes/auth.ts
import { Router } from "express";
import type { z } from "zod";
import { secureRoute } from "../security/secure-route.js";
import { validate } from "../security/validate.js";
import { audited } from "../security/audit.js";
import { AppError } from "../security/errors.js";
import { DUMMY_HASH, verifyPassword } from "../security/passwords.js";
import { startSession, endSession } from "../security/session.js";
import { loginLimiters, loginPerAccount, accountKey } from "../security/limits.js";
import { Login } from "../schemas/auth.js";
import * as users from "../services/users.js";

export const auth = Router();

secureRoute(auth, "post", "/login", { public: true },
  ...loginLimiters, // before validate: count every attempt, valid-looking or not
  validate({ body: Login }),
  audited("auth.login", async (req, res, ctx) => {
    const { body } = res.locals.valid as { body: z.infer<typeof Login> };
    const user = await users.findByEmail(ctx.db, body.email);
    ctx.resource = { type: "user", id: user?.id ?? null }; // never the email
    const ok = await verifyPassword(user?.password_hash ?? DUMMY_HASH, body.password);
    if (!user || !ok || !user.active) throw new AppError(401, "Email or password is incorrect.");

    const csrf = await startSession(req, user.id);
    req.actor = { type: "user", id: user.id, role: user.role, orgId: user.org_id };
    await loginPerAccount.resetKey(accountKey(req)); // success clears the failed-attempt counter
    return { status: 200, body: { csrf_token: csrf } };
  }),
);

secureRoute(auth, "post", "/logout", { permission: "session.self" },
  audited("auth.logout", async (req, _res, ctx) => {
    ctx.resource = { type: "user", id: actorOf(req).id };
    await endSession(req);
    return { status: 204 };
  }),
);
```

Add `import { actorOf } from "../security/actor.js";` to the imports above.

## 10. Rate limits → `skills/rate-limit.md`

```ts
// src/security/limits.ts
import type { Request, RequestHandler } from "express";
import { rateLimit, ipKeyGenerator, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Thresholds from skills/rate-limit.md, overridden only by the PRD or an ADR.
export const LIMITS = {
  loginPerAccount: { windowMs: 15 * 60_000, limit: 5 },
  loginPerIp:      { windowMs: 60_000,      limit: 20 },
  signup:          { windowMs: 60 * 60_000, limit: 5 },
  resetPerAccount: { windowMs: 60 * 60_000, limit: 3 },
  resetPerIp:      { windowMs: 60 * 60_000, limit: 10 },
  refresh:         { windowMs: 60_000,      limit: 30 },
  expensive:       { windowMs: 60_000,      limit: 10 },
  authedDefault:   { windowMs: 60_000,      limit: 100 },
  anonDefault:     { windowMs: 60_000,      limit: 60 },
} as const;
type LimitName = keyof typeof LIMITS;

const SECURITY_LIMITS = new Set<LimitName>(["loginPerAccount", "loginPerIp", "signup", "resetPerAccount", "resetPerIp", "refresh"]);

const redis = config.REDIS_URL ? createClient({ url: config.REDIS_URL }) : null;
if (redis) await redis.connect();
if (!redis && config.NODE_ENV === "production") {
  // In-memory counters are per process. Only acceptable on a single long-running instance, per ADR.
  logger.warn({ kind: "app" }, "rate limits using in-memory store");
}

// Each limiter needs its own store instance (express-rate-limit rejects a shared one).
const storeFor = (name: string): Store | undefined =>
  redis ? new RedisStore({ prefix: `rl:${name}:`, sendCommand: (...args: string[]) => redis.sendCommand(args) }) : undefined;

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");
const userKey = (req: Request) => req.actor?.id ?? ipKey(req);
export const accountKey = (req: Request) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254);

const KEYS = { ip: ipKey, user: userKey, account: accountKey } as const;

export function limiter(name: LimitName, by: keyof typeof KEYS, extra: Parameters<typeof rateLimit>[0] = {}) {
  return rateLimit({
    ...LIMITS[name],
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => KEYS[by](req),
    store: storeFor(`${name}:${by}`),
    handler: (req, res, _next, options) => {
      if (SECURITY_LIMITS.has(name)) {
        logger.warn({ kind: "security", request_id: req.id, action: "rate_limit.hit", limit: name, source: { ip: req.ip } }, "rate limit hit");
      }
      res.status(options.statusCode).json({ error: "Too many requests. Try again later.", request_id: req.id });
    },
    ...extra,
  });
}

// Failed attempts only; a success resets the counter via resetKey in the login handler.
export const loginPerAccount = limiter("loginPerAccount", "account", { skipSuccessfulRequests: true });
export const loginLimiters: RequestHandler[] = [limiter("loginPerIp", "ip"), loginPerAccount];
```

Proxy trust, in `app.ts`: `app.set("trust proxy", config.TRUST_PROXY_HOPS)`. Set it to the exact number of proxies in front of the app (1 for a single load balancer). Never `true`: that trusts any `X-Forwarded-For` value and lets a client choose its own IP. `express-rate-limit` warns at startup if it sees a misconfiguration; treat that warning as a failed check.

`express-rate-limit` sets `Retry-After` on the 429 when standard headers are on. Check that the test in section 13 asserts it, so you do not rely on this line.

## 11. App wiring

Order matters. This file is the one place it is defined.

```ts
// src/app.ts
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { httpLogger } from "./logger.js";
import { errorHandler, notFound } from "./security/errors.js";
import { sessions, checkOrigin } from "./security/session.js"; // pattern A
import { auth } from "./routes/auth.js";
import { invoices } from "./routes/invoices.js";

export const app = express();

app.set("trust proxy", config.TRUST_PROXY_HOPS);
app.disable("x-powered-by");

app.use(httpLogger);                          // 1. request id first, so everything after can log it
app.use(helmet());                            // 2. security headers
// app.use("/webhooks", webhooks);            // 3. raw-body routes, before the JSON parser
app.use(express.json({ limit: "100kb" }));    // 4. bounded body parsing
app.use(sessions);                            // 5. pattern A only
app.use(checkOrigin);                         // 6. pattern A only; pattern B: cors({ origin: config.ALLOWED_ORIGINS })

app.use("/auth", auth);                       // 7. routes, all registered via secureRoute()
app.use("/invoices", invoices);

app.use(notFound);                            // 8. unknown routes → 404 via the error handler
app.use(errorHandler);                        // 9. last
```

## 12. Transactional extras → `skills/backend-shape.md`

Only when the backend shape is transactional.

**Idempotency keys** on every write that moves money or stock. The client sends `Idempotency-Key: <uuid>`; a repeat of the same key returns the first response instead of doing the work twice.

```sql
CREATE TABLE idempotency_keys (
  user_id        uuid NOT NULL,
  key            text NOT NULL,
  request_hash   text NOT NULL,  -- sha256 of method + path + validated body
  response_status int,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
```

Flow, inside the handler's transaction:
1. `INSERT ... ON CONFLICT (user_id, key) DO NOTHING RETURNING key`. Inserted → do the work, then `UPDATE` the row with the status and body before commit.
2. Not inserted → `SELECT ... FOR UPDATE`. Different `request_hash` → 422. Has a response → return it unchanged. No response yet → 409 (the first request is still in flight).
3. A cleanup job deletes keys older than the retention in the ADR (default 24 hours).

**Outbox** for side effects that must happen exactly once after a commit (emails, webhooks, payment-provider calls). Never call an external service inside a DB transaction.

```sql
CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic        text NOT NULL,
  payload      jsonb NOT NULL,        -- ids, not personal data
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX outbox_pending_idx ON outbox (id) WHERE sent_at IS NULL;
```

The handler inserts into `outbox` with `ctx.db`, inside the same transaction as the change. A worker sends:

```ts
// src/workers/outbox.ts — run as a separate process
const BATCH = 20;
export async function drainOnce() {
  await withTx(async (db) => {
    const { rows } = await db.query(
      `SELECT id, topic, payload FROM outbox
       WHERE sent_at IS NULL AND attempts < 10
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, // safe with several workers
      [BATCH],
    );
    for (const msg of rows) {
      try {
        await deliver(msg.topic, msg.payload); // has its own timeout; receiver must tolerate duplicates
        await db.query(`UPDATE outbox SET sent_at = now() WHERE id = $1`, [msg.id]);
      } catch (err) {
        await db.query(`UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [msg.id, String(err).slice(0, 500)]);
        logger.error({ kind: "app", err, outbox_id: msg.id, topic: msg.topic }, "outbox delivery failed");
      }
    }
  });
}
```

Delivery is at least once: a crash between `deliver` and the `UPDATE` resends. Pass the outbox `id` to the receiver as its idempotency key.

## 13. Tests

Every endpoint gets the six tests from `AGENTS.md` section 6. Tests hit the real app with `supertest` against a local throwaway Postgres (never a shared database). `examples/node-express-demo/tests/` has the working versions of everything below: `global-setup.ts` starts a throwaway Postgres with `embedded-postgres` and runs the migration as the owner role, `helpers.ts` has `loginAs(role)`, `seed`, `resetDb`, and `auditFor(requestId)`. Two details the snippet relies on:

- The app connects as `app_user`; seeding and reset use a separate owner connection, so the append-only audit grant is tested for real.
- `loginAs` returns `request.agent(app).set("Origin", ORIGIN)`, so every request from the agent passes `checkOrigin`. Without that default, every write test fails with 403 before reaching the code under test.

Prove the tests bite: remove `can(...)`, `checkCsrf`, and the `org_id` filter one at a time and confirm exactly one test fails each time. The demo was checked this way.

```ts
// tests/invoices.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { loginAs, seed, resetDb } from "./helpers.js";

describe("DELETE /invoices/:id", () => {
  beforeEach(resetDb);

  it("401 without a session", async () => {
    const inv = await seed.invoice();
    await request(app).delete(`/invoices/${inv.id}`).set("Origin", "http://localhost:5173").expect(401);
  });

  it("403 for a member, and the denial is audited", async () => {
    const { agent, csrf } = await loginAs("member");
    const inv = await seed.invoice();
    const res = await agent.delete(`/invoices/${inv.id}`).set("x-csrf-token", csrf).expect(403);
    const { rows } = await pool.query(`SELECT action, result FROM audit_log WHERE request_id = $1`, [res.headers["x-request-id"]]);
    expect(rows).toEqual([{ action: "access.denied", result: "denied" }]);
  });

  it("404 for another org's invoice", async () => {
    const { agent, csrf } = await loginAs("admin");
    const other = await seed.invoice({ orgId: (await seed.org()).id });
    await agent.delete(`/invoices/${other.id}`).set("x-csrf-token", csrf).expect(404);
    expect((await pool.query(`SELECT 1 FROM invoices WHERE id = $1`, [other.id])).rowCount).toBe(1);
  });

  it("400 for a malformed id", async () => {
    const { agent, csrf } = await loginAs("admin");
    await agent.delete(`/invoices/not-a-uuid`).set("x-csrf-token", csrf).expect(400);
  });

  it("403 without the CSRF token", async () => {
    const { agent } = await loginAs("admin");
    const inv = await seed.invoice();
    await agent.delete(`/invoices/${inv.id}`).expect(403);
  });

  it("204 for an admin, with exactly one audit entry", async () => {
    const { agent, csrf, user } = await loginAs("admin");
    const inv = await seed.invoice({ orgId: user.org_id });
    const res = await agent.delete(`/invoices/${inv.id}`).set("x-csrf-token", csrf).expect(204);
    const { rows } = await pool.query(
      `SELECT action, result, actor_id, resource_id FROM audit_log WHERE request_id = $1`,
      [res.headers["x-request-id"]],
    );
    expect(rows).toEqual([{ action: "invoice.delete", result: "success", actor_id: user.id, resource_id: inv.id }]);
  });
});

describe("POST /auth/login rate limit", () => {
  it("returns 429 with Retry-After after 5 failures for one account", async () => {
    const body = { email: "a@example.test", password: "wrong-password" };
    for (let i = 0; i < 5; i++) {
      await request(app).post("/auth/login").set("Origin", "http://localhost:5173").send(body).expect(401);
    }
    const res = await request(app).post("/auth/login").set("Origin", "http://localhost:5173").send(body).expect(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

describe("no secrets in responses", () => {
  it("error bodies never contain config values or stack traces", async () => {
    const res = await request(app).get("/does-not-exist");
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/at .+\.(ts|js):\d+/); // stack frame
    for (const name of ["DATABASE_URL", "SESSION_SECRET", "JWT_SECRET"]) {
      const value = process.env[name];
      if (value) expect(text).not.toContain(value);
    }
  });
});
```

Also assert that unknown fields are rejected (`{ ...valid, role: "owner" }` → 400) on every create and update endpoint. That is the mass-assignment test.

## 14. Checks before merge

The pre-merge checklist in `AGENTS.md` section 6, as commands for this stack. Each should print nothing. Paste the output in the report.

```bash
grep -rnE "^[[:space:]]*[a-zA-Z]+\.(get|post|put|patch|delete)\(" src/routes
```

Routes registered without `secureRoute()`.

```bash
grep -rnE "console\.(log|info|warn|error|debug)" src
```

Stray logging outside the one logger.

```bash
grep -rnE 'query\([[:space:]]*`[^`]*\$\{' src
```

SQL built with template interpolation. The only allowed hit is an allowlist map like `SORT_COLUMNS[...]`; say so if it appears.

```bash
grep -rnE "req\.(body|query|params)" src/services
```

Raw request data reaching business logic.

```bash
grep -rn "process\.env" src | grep -v "src/config.ts" | grep -v "src/logger.ts"
```

Environment read outside the config module.

```bash
grep -rnE "catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}" src
```

Empty catch blocks.

Plus: type check passes (enforces `audited()` on write routes), full test suite passes, secret scan passes.

## When this recipe is out of date

Framework majors move. If a project hits an API here that no longer exists or behaves differently, stop, do not guess a replacement for anything in sections 1, 5, 6, 7, 8, or 9 (secrets, auth, RBAC, audit), and tell the human. Fix this file upstream in the same week, with the version that changed.

`AGENTS.md` section 7 outranks this recipe wherever they disagree.
