# Audit Log

One structured log shape for the whole backend. Every state-changing action writes an audit entry saying who did what to which resource, when, from where, and whether it worked.

**Read when:** adding any state-changing endpoint (POST, PUT, PATCH, DELETE), adding a background job that changes data, adding any logging, or touching the logger.

The point is that anyone debugging later — you, a teammate, or an agent — can answer "what happened, who did it, is it safe to act next" from the log alone.

## The schema

One shape, JSON, for every entry:

```json
{
  "timestamp": "2026-09-24T12:00:00.000Z",
  "level": "info",
  "kind": "audit",
  "request_id": "01J8Z…",
  "actor": { "type": "user", "id": "usr_123", "role": "admin" },
  "action": "invoice.delete",
  "resource": { "type": "invoice", "id": "inv_456" },
  "result": "success",
  "source": { "ip": "203.0.113.7", "route": "DELETE /invoices/:id" },
  "detail": {}
}
```

| Field | Rule |
| --- | --- |
| `timestamp` | UTC, ISO 8601, milliseconds. |
| `kind` | `audit` for audit entries, `app` for operational logs, `security` for security events (refresh-token reuse, repeated failed logins). Same schema for all three. |
| `request_id` | Generated at the edge or taken from a trusted proxy header, attached to every log line and returned to the client in errors. |
| `actor.type` | `user`, `service`, `agent`, `anonymous`, or `system` (scheduled jobs). An AI agent acting for a user is `agent`, with the user in `detail.on_behalf_of`. |
| `action` | `resource.verb`, lowercase, from a fixed list in code. Not free text. |
| `result` | `success`, `denied`, or `error`. |
| `detail` | Small, structured, no personal data beyond ids. For changes: field names changed, not values, unless the value is non-sensitive (a role, a status). |

## What must be audited

- Every POST, PUT, PATCH, DELETE that changes state.
- Always, including when denied or failed: login success and failure, logout, password change and reset, role or permission change, delete, data export, payment or refund, secret or API key creation, settings changes that affect security.
- Background jobs and webhooks that change data (`actor.type` `system` or `service`).

Reads are not audited by default. Reads of sensitive data (exports, admin viewing another user's record) are.

## Rules

- **One logger.** No `console.log`, `print`, or `puts` for application events. The logger writes JSON to stdout; the platform collects it.
- **One audit writer.** A single function (`audit(action, resource, result, detail)`) that fills request id, actor, and source from the request context. Routes call it; they never build the entry by hand.
- **Redaction.** The logger has a redaction list: `password`, `token`, `authorization`, `cookie`, `secret`, `api_key`, card numbers, and every secret name from `secrets-handling.md`. Redacted at the logger, not left to each call site.
- **Never log:** passwords, tokens, session ids, full card numbers, secrets, request bodies wholesale, or personal data beyond an id.
- **Tamper resistance.** If audit entries go to a database table, the app's database role may insert but not update or delete them. Retention period documented in an ADR.
- **Same transaction where possible.** For DB-backed audit entries on transactional writes, write the entry in the same transaction as the change, so a rollback removes both.
- **Audit write failure** is logged as an error at `kind: security`. For sensitive actions (payments, role changes, deletes) the action fails if its audit entry cannot be written.

## Steps

1. **Name the action** as `resource.verb` and add it to the action list in code.
2. **Call the audit writer** on every exit path of the handler: success, denied, error. The denied path is the one most often forgotten.
3. **Write the test:** the endpoint call produces exactly one audit entry with the right action, actor, resource, and result. Test the denied path too.
4. **Check the output.** Run the endpoint locally and paste the actual log line. Confirm no secret or personal data in it.

## Flag before writing

- A POST, PUT, PATCH, or DELETE handler with no audit call.
- An audit call on the success path only.
- `console.log`, `print`, or a second logger instance.
- Logging `req.body`, `req.headers`, or a full user object.
- Free-text action names (`"deleted the invoice"`).
- An audit table the app can update or delete from.

## Done when

- [ ] Every state-changing endpoint in the change writes one audit entry on every exit path
- [ ] Tests assert the entry for success and denied
- [ ] Real log line pasted, checked for secrets and personal data
- [ ] No new logger, no stray `console.log` or `print`

`AGENTS.md` section 7 outranks this doc wherever they disagree. Changing the audit schema needs an ADR.
