# Secrets

Names, owners, and rotation steps for every secret this backend uses. **Never values.** Values live in <secrets source from AGENTS.md section 3>.

Update this file in the same change that adds, removes, or renames a secret. See `.beaverdam/skills/secrets-handling.md`.

| Name | Purpose | Where it lives | Environments | Permissions it grants | Rotated by | How to rotate | What restarts or redeploys |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | App connection to Postgres (as `app_user`) | <...> | dev, staging, prod (separate values) | read/write app tables, insert-only audit log | <name> | <steps> | <app> |
| `SESSION_SECRET` | Signs session cookies | <...> | <...> | forging a session if leaked | <name> | <steps; all users signed out> | <app> |
| `<NAME>` | <...> | <...> | <...> | <...> | <...> | <...> | <...> |

## If a secret leaks

Stop and follow `.beaverdam/skills/incident-checklist.md`. Rotate at the provider; removing it from git does not un-leak it.
