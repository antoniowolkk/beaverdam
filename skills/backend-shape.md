# Backend Shape

Mandatory first gate on any new backend. Classify what kind of backend this is before anything else is designed, because the answer decides which parts of the spine get extra weight and which recipe pattern applies.

**Read when:** starting a new backend, adding a major feature that changes how data is written or read, or when section 1 of `AGENTS.md` has a blank backend shape.

## The two axes

**Data / consistency shape** — what the data must guarantee.

| Shape | Looks like | Signal words |
| --- | --- | --- |
| CRUD data API | Records created, read, edited, deleted by users. Last write wins is acceptable. | "manage", "list", "dashboard", "admin panel" |
| Transactional | A write that must happen exactly once, all or nothing. Money, stock, seats, slots. | "payment", "checkout", "booking", "inventory", "balance", "credits" |
| Analytics / reporting | Mostly reads over large sets. Aggregates, exports, charts. | "report", "export", "metrics", "history", "insights" |
| Real-time | Clients hold a connection open and get pushed updates. | "chat", "live", "notifications", "presence", "websocket" |

A backend can be more than one. Name every shape that applies and which endpoints each covers.

**Traffic shape** — who can reach it and how much.

| Shape | Looks like |
| --- | --- |
| Internal tool | Only known staff or one client's employees. Tens of users. |
| Public, low traffic | Anyone on the internet can reach it, but volume is small. Most client B2B SaaS. |
| Public, high traffic | Open signup, consumer-facing, or a known traffic spike. |

## Steps

1. **Look for the answer first.** Read `docs/prd.md`, the task, and section 1 of `AGENTS.md`. If both axes are stated or obvious from signal words, use them and say which words decided it.
2. **If either axis is unclear, ask.** One short question, not a questionnaire. Do not infer silently. Template:

   > Before I build: is this mainly [CRUD records / payments or bookings / reporting / live updates], and is it [internal staff only / public]? I'm reading it as <your guess> because <reason>.

3. **Write the answer** into section 1 of `AGENTS.md`, under Backend shape.
4. **Apply the emphasis** from the table below. State in one line which extras you are pulling in.
5. **Hand off** to `threat-model.md`.

## What each shape pulls in

| Shape | Extra emphasis | Extra guidance |
| --- | --- | --- |
| CRUD | Ownership checks on every record route (`rbac.md`). | Pagination on list endpoints. |
| Transactional | Idempotency keys on every money or stock write. DB transaction around multi-step writes. Audit every attempt, including failures. | Outbox pattern: write the side effect (email, webhook, payment call) to a table in the same transaction, send it from a worker. Never call a payment provider inside a DB transaction. |
| Analytics | Exports are rate limited and audited as data exports. Queries bounded (date range, row cap). | Read replica or cache for heavy reads, not write-path hardening. |
| Real-time | Authenticate the connection at handshake. Re-check authorization per channel or room subscription, not only at connect. Rate limit messages per connection. | Expire and re-validate long-lived connections when the session ends. |
| Internal tool | Still full spine. "Internal" is not a trust boundary if it is on the internet. | Consider IP allowlist or SSO in addition to auth, via ADR. |
| Public, low traffic | Default thresholds from `rate-limit.md`. | — |
| Public, high traffic | Tighter limits, timeouts on every outbound call, no unbounded queries. | Rate-limit store must be shared across instances. |

## Output

- Data shape(s), with the endpoints each covers.
- Traffic shape.
- Whether it was stated, obvious (and from which words), or answered by the human.
- The extras now in force, one line each.

`AGENTS.md` section 7 outranks this doc wherever they disagree.
