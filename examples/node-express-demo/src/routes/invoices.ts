import { Router } from "express";
import type { z } from "zod";
import { secureRoute } from "../security/secure-route.js";
import { validate } from "../security/validate.js";
import { audited } from "../security/audit.js";
import { actorOf } from "../security/actor.js";
import { CreateInvoice, IdParam } from "../schemas/invoices.js";
import * as invoiceService from "../services/invoices.js";

export const invoices = Router();

secureRoute(invoices, "get", "/:id", { permission: "invoice.read_own" },
  validate({ params: IdParam }),
  async (req, res) => {
    const { params } = res.locals.valid as { params: z.infer<typeof IdParam> };
    res.json(await invoiceService.get(actorOf(req), params.id));
  },
);

secureRoute(invoices, "post", "/", { permission: "invoice.create" },
  validate({ body: CreateInvoice }),
  audited("invoice.create", async (req, res, ctx) => {
    const { body } = res.locals.valid as { body: z.infer<typeof CreateInvoice> };
    const invoice = await invoiceService.create(ctx.db, actorOf(req), body);
    ctx.resource = { type: "invoice", id: invoice.id };
    ctx.detail = { currency: body.currency }; // non-sensitive only
    return { status: 201, body: invoice };
  }),
);

secureRoute(invoices, "delete", "/:id", { permission: "invoice.delete" },
  validate({ params: IdParam }),
  audited("invoice.delete", async (req, res, ctx) => {
    const { params } = res.locals.valid as { params: z.infer<typeof IdParam> };
    ctx.resource = { type: "invoice", id: params.id }; // set before anything can throw
    await invoiceService.remove(ctx.db, actorOf(req), params.id);
    return { status: 204 };
  }),
);
