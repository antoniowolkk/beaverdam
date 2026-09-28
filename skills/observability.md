# Observability

Make abuse, probing, and slow failure visible before a client reports them. This covers security observability, not general monitoring: what is exposed, who is being denied, and whether the backend is degrading.

**Read when:** adding or removing a route, webhook, socket, or job; adding a health check; choosing what to alert on; or when someone asks "how would we know if this were being attacked?"

It builds on the audit log. It adds no second log shape and no second logger (`audit-log.md`).

## Rule

- **One endpoint inventory.** Every live route, webhook, socket, and scheduled job is a row in the entry-point table of `docs/threat-model.md`. That table is the inventory; there is no second list. A live entry point missing from it is a bug. So is a listed one that no longer exists.
- **The inventory is checked by a test**, which compares the entry points the running code registers with the table. Do not rely on someone remembering to update it.
- **Security signals are countable from the logs.** Per route and per action you can count `result: denied`, 401, 403, 429, failed logins, audit-write failures, and 5xx. They come from the existing log fields (`result`, `kind`, `action`, `source.route`), not from new logging calls.
- **Every request logs its duration.** Degradation (latency creep, lock contention, a slow database) shows up well before an outage. Up/down alone is not enough.
- **Two health checks.** *Liveness* touches nothing and says the process is up. *Readiness* also checks the database and returns 503 when it cannot reach it. Both are public and rate limited like any other public route. Their bodies carry a status only: no version, environment, hostname, dependency names, or error text.
- **Alerts are documented, then wired by the project.** The alert list lives in `docs/threat-model.md` under "Alerts". Sending alerts, or shipping logs to an outside service, is an outbound integration: it needs an ADR and a yes from the human (section 7). Until then the list says what would alert and on what threshold.
- **No personal data in metric labels.** Label by route template (`DELETE /invoices/:id`), never the raw path, user id, email, or IP.

## Minimum alert list

| Alert | Signal | Default threshold |
| --- | --- | --- |
| Denial spike | `result: denied` count | 5× the 7-day hourly median, or 50 in 10 min |
| Failed-login burst | failed `auth.login` | 20 in 5 min across all accounts |
| Rate-limit surge | 429 count | 100 in 5 min |
| Server errors | 5xx rate | above 2% for 5 min |
| Degradation | p95 duration | 2× the 7-day p95 for 10 min |
| Readiness failing | readiness returns 503 | 3 checks in a row |
| Audit write failed | `kind: security` audit-write error | any |

The thresholds are starting points (guess, not measured). Tune them in the threat model once real traffic exists, and say what changed and why.

## Steps

1. **Update the inventory.** In the same change that adds or removes an entry point, add or remove its row in `docs/threat-model.md`.
2. **Wire the inventory test** from the recipe, if the project does not have it yet. Break it once: add a route without a row and confirm the test fails.
3. **Add the two health checks** if they are missing. Test that readiness returns 503 when the database is unreachable, and that neither body contains anything beyond the status.
4. **Check the signals.** Run the change locally and paste one completed-request log line. Confirm it has the route template, status, and duration, and nothing sensitive.
5. **Update the alert list** if the change adds a sensitive action, an expensive endpoint, or a new trust boundary.
6. **Public production only: record one resilience drill** in `docs/threat-model.md`: restore the database from backup, and what the backend does when the rate-limit store is down (fails open or closed, decided in an ADR). Date it. A drill nobody has run is an open question, not a control.

## Flag before writing

- A route, webhook, socket, or job with no row in the inventory.
- A route registered outside the recipe's route helper, where the inventory test cannot see it.
- A health endpoint that returns a version, environment, stack trace, or dependency error.
- A health endpoint that is not rate limited.
- A `catch` that swallows an error without logging it.
- A raw path, user id, email, or IP used as a metric label.
- Alerts that only watch uptime.
- An agent adding an outbound log or alert integration without an ADR.

## Done when

- [ ] Every entry point in the change has a row in `docs/threat-model.md`
- [ ] Inventory test passes, and was seen to fail with an unlisted route
- [ ] Liveness and readiness exist, are rate limited, and return a status only
- [ ] Readiness returns 503 when the database is unreachable, tested
- [ ] A real completed-request log line pasted, with route template and duration
- [ ] Alert list in `docs/threat-model.md` covers the change
- [ ] Public production: resilience drill dated in `docs/threat-model.md`

`AGENTS.md` section 7 outranks this doc wherever they disagree.
