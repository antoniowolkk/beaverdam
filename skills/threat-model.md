# Threat Model

A short, concrete pass on what this backend protects and from whom, done before building. The output is a file the agent keeps referring back to, not a report that gets filed and forgotten.

**Read when:** after `backend-shape.md` on a new backend, before a major feature (new data type, new caller, new integration, new role), or when `docs/threat-model.md` does not exist.

Keep it to one page. A threat model nobody rereads protects nothing.

## Steps

1. **List the data.** Every kind of data the backend stores or passes through. Mark each:
   - **Personal** — names, emails, addresses, anything that identifies a person (GDPR applies to EU clients).
   - **Sensitive** — credentials, payment data, health, contracts, anything a client would call confidential.
   - **Internal** — neither.
2. **List the callers.** Who or what can send a request: anonymous internet, signed-in users by role, admins, other services, webhooks from third parties, AI agents acting on a user's behalf.
3. **List the entry points.** Every route, webhook, socket, scheduled job, and file upload. For each: which callers can reach it, and what data it reads or writes.
4. **Mark the trust boundaries.** Where data crosses from something you do not control into something you do: client → API, third party → webhook, user upload → storage, API → external service.
5. **Ask four questions per entry point.** Keep only the ones with a real answer.
   - Can someone reach this who should not? (auth, RBAC)
   - Can someone reach data that is not theirs? (ownership, IDOR)
   - Can someone send input that does something unintended? (validation, injection, mass assignment)
   - Can someone overwhelm or abuse it? (rate limit, cost)
6. **Name the worst case.** For each sensitive data type: if it leaked tomorrow, what happens, and to whom.
7. **Map each risk to the spine.** Every risk points at the skill that closes it. A risk with no skill to point at goes to the human as an open question.
8. **Write `docs/threat-model.md`** in the format below. Show it to the human before building.

## Output — `docs/threat-model.md`

```markdown
# Threat model — <project>

Last updated: <date> · Backend shape: <from AGENTS.md section 1>

## Data
| Data | Class | Where stored | Who may read | Who may write |

## Callers
| Caller | How they authenticate | Roles |

## Entry points
| Entry point | Callers | Data touched | Rate limited | Audit logged |

## Trust boundaries
- <boundary>: <what crosses it, what checks it>

## Top risks
| # | Risk | Entry point | Worst case | Closed by |

## Open questions for the human
- <anything not closed by the spine>
```

## While building

- Before writing an endpoint, find its row in the entry-point table. If it is missing, add it.
- If a change adds a caller, a data type, or a trust boundary, update the file in the same change.
- In the final report for any feature, say which top risks it touched and whether each is still closed.

`AGENTS.md` section 7 outranks this doc wherever they disagree.
