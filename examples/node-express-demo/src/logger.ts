import pino from "pino";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";

// `*.x` matches one level deep. Add a path when you add a nested secret-bearing field.
// Every name in config.ts SECRET_NAMES must be here too (tests/integrity.test.ts checks it).
export const REDACT_PATHS = [
  "password", "*.password", "new_password", "*.new_password",
  "token", "*.token", "refresh_token", "*.refresh_token", "access_token", "*.access_token",
  "secret", "*.secret", "api_key", "*.api_key",
  "DATABASE_URL", "*.DATABASE_URL", "SESSION_SECRET", "*.SESSION_SECRET", "REDIS_URL", "*.REDIS_URL",
  "req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']",
  "res.headers['set-cookie']",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined, // no pid/hostname noise; the platform adds its own
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
});

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
