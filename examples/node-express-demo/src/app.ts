import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { httpLogger } from "./logger.js";
import { errorHandler, notFound } from "./security/errors.js";
import { sessions, checkOrigin } from "./security/session.js";
import { auth } from "./routes/auth.js";
import { invoices } from "./routes/invoices.js";
import { health } from "./routes/health.js";
import { mount } from "./security/inventory.js";

export const app = express();

app.set("trust proxy", config.TRUST_PROXY_HOPS);
app.disable("x-powered-by");

app.use(httpLogger);                          // 1. request id first, so everything after can log it
app.use(helmet());                            // 2. security headers
app.use(express.json({ limit: "100kb" }));    // 4. bounded body parsing
app.use(sessions);                            // 5. pattern A only
app.use(checkOrigin);                         // 6. pattern A only

mount(app, "/health", health);                // 7. routes, all registered via secureRoute(), all mounted via mount()
mount(app, "/auth", auth);
mount(app, "/invoices", invoices);

app.use(notFound);                            // 8. unknown routes → 404 via the error handler
app.use(errorHandler);                        // 9. last
