import type { Request } from "express";
import { AppError } from "./errors.js";
import type { Role } from "./permissions.js";

export type Actor = { type: "user" | "service" | "agent"; id: string; role: Role; orgId: string };

export function actorOf(req: Request): Actor {
  if (!req.actor) throw new AppError(401, "Sign in required.");
  return req.actor;
}
