import { z } from "zod";

export const IdParam = z.strictObject({ id: z.string().uuid() });

export const CreateInvoice = z.strictObject({
  customer_id: z.string().uuid(),
  amount_cents: z.number().int().positive().max(100_000_000), // integer minor units, never floats
  currency: z.enum(["EUR", "USD"]),
  note: z.string().trim().max(500).optional(),
});
