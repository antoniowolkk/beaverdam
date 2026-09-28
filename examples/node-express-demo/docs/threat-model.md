# Threat model — node-express-demo

Last updated: 2026-09-28 · Backend shape: CRUD data API, public low traffic

Trimmed to the entry-point table. It is the endpoint inventory: `tests/observability.test.ts` fails if it and the live routes disagree.

## Entry points
| Entry point | Callers | Data touched | Rate limited | Audit logged |
| --- | --- | --- | --- | --- |
| `GET /health/live` | anonymous | none | anonDefault | no (read) |
| `GET /health/ready` | anonymous | none (database ping) | anonDefault | no (read) |
| `POST /auth/login` | anonymous | users, session | loginPerIp, loginPerAccount | yes, including failures |
| `POST /auth/logout` | member, admin | session | authedDefault | yes |
| `GET /invoices/:id` | member (own org) | invoices | authedDefault | no (read) |
| `POST /invoices` | member, admin | invoices | authedDefault | yes |
| `DELETE /invoices/:id` | admin (own org) | invoices | authedDefault | yes, including denials |
