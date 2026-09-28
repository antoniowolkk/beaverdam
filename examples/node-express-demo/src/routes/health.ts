import { Router } from "express";
import { secureRoute } from "../security/secure-route.js";
import { pool } from "../db.js";

export const health = Router();

// Public and rate limited like any other route. Bodies carry a status only:
// no version, environment, hostname, or dependency detail.
secureRoute(health, "get", "/live", { public: true }, (_req, res) => {
  res.json({ status: "ok" });
});

secureRoute(health, "get", "/ready", { public: true }, async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    req.log.warn({ kind: "app", err }, "readiness check failed"); // detail to the log, never the body
    res.status(503).json({ status: "unavailable" });
  }
});
