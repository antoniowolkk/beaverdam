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
export const SECRET_NAMES = ["DATABASE_URL", "SESSION_SECRET", "REDIS_URL"] as const;
