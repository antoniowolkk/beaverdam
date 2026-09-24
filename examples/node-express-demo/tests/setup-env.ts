import { randomBytes } from "node:crypto";
import { APP_URL, ORIGIN } from "./db-urls.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = APP_URL;
process.env.ALLOWED_ORIGINS = ORIGIN;
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
process.env.LOG_LEVEL ??= "silent";
