import type { RequestHandler, Router } from "express";
import { authGuards } from "./session.js";
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
