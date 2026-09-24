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
