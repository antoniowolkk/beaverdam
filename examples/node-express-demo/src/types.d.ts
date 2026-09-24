import type { Actor } from "./security/actor.js";

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    createdAt: number;
    csrf: string;
  }
}

export {};
