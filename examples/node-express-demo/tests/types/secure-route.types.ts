// Type-level tests: checked by `tsc --noEmit`, never run.
import { Router } from "express";
import { secureRoute } from "../../src/security/secure-route.js";

const r = Router();

// @ts-expect-error — a write route whose last handler is not audited() must not compile
secureRoute(r, "post", "/x", { permission: "invoice.create" }, async (_req, res) => { res.end(); });

// @ts-expect-error — a route with no access declaration must not compile
secureRoute(r, "get", "/y", async (_req, res) => { res.end(); });

// @ts-expect-error — an unknown permission must not compile
secureRoute(r, "get", "/z", { permission: "invoice.nuke" }, async (_req, res) => { res.end(); });
