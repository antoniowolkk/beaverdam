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
