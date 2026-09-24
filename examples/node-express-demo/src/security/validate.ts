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
