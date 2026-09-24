import { Router } from "express";
import type { z } from "zod";
import { secureRoute } from "../security/secure-route.js";
import { validate } from "../security/validate.js";
import { audited } from "../security/audit.js";
import { actorOf } from "../security/actor.js";
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
