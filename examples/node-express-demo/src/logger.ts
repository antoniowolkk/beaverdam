import pino from "pino";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";

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
