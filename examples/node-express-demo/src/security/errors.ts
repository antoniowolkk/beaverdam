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
