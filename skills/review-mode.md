# Review Mode

Review an existing backend against the spine without changing it. The output is a findings report: what is missing or broken, where, how sure, and how bad.

**Read when:** reviewing or auditing an existing backend, bringing beaverdam into a repo that already has code, or asked "what is missing here?" or "is this secure?".

## Rule

- **Change nothing in the repo under review.** No edits, no formatting, no installs, no migrations, no commits. Do not run anything against a database, and make no network calls. Section 7 of `AGENTS.md` still applies in full.
- **Findings go to the reply,** or to a path the human names. Never into the reviewed repo unless the human says so.
- **Every finding cites evidence** as `file:line`, with the lines that show it. No finding from a file name, a folder name, or a hunch alone.
- **Every finding says how it was established:**
  - **confirmed**: the cited code shows it directly.
  - **inferred**: a pattern points to it, but something outside the code could close it (a gateway, a platform setting, another repo).
  - **guess**: judgment, stated as such.
- **Absence is a finding only after looking.** "No rate limiting" means you searched for it (middleware, gateway config, platform settings in the repo) and say where you looked.
- If junior-agent is installed, its `investigate` skill governs how to gather evidence. This doc says what to check.

## Severity

By outcome, not by category. The same category can be critical in one place and low in another.

| Severity | Outcome | Examples |
| --- | --- | --- |
| **critical** | Reachable without auth, and exposes personal or sensitive data or grants access | Data route with no auth, live secret in code or git history, SQL built from input, webhook with no signature check that moves money |
| **high** | A signed-in caller can reach another tenant's data or another role's actions | Record loaded by id with no owner or tenant filter, missing role check on an admin action, `role` writable by mass assignment, check-then-write on a balance |
| **medium** | A missing layer that turns one mistake or one attacker into damage | No rate limit on login, no audit entry on deletes or role changes, reflected-origin CORS, stack traces in responses |
| **low** | Hardening and hygiene | Route missing from the inventory, secret with no expiry recorded, no health check, verbose logs |

When unsure between two levels, pick the higher one and say why.

## Steps

1. **Backend shape, read-only.** Run `backend-shape.md` in read-only mode.
2. **Threat model, read-only.** Run `threat-model.md` in read-only mode.
3. **Walk every skill.** For each skill in `skills/`, check its **Rule** and **Flag before writing** list against the code. That covers auth, secrets, RBAC, input validation, rate limiting, audit log, and observability, plus error handling from `AGENTS.md` section 5.
4. **Run the recipe checks.** If a recipe matches the stack, run the greps in its "Checks before merge" section. They only read files. Report each hit, or "prints nothing".
5. **Write the report** in the format below.

## Output

```markdown
# Review — <repo> · <date> · read-only

## Backend shape
<shape(s) and traffic, each with evidence and confidence>

## Threat model
<the one-page model from threat-model.md, read-only mode>

## Findings
| # | Severity | Category | Location | Rule broken | Evidence | Confidence | Fix |

## Checked, nothing found
- <skill or check>: <where you looked>

## Not checked
- <anything out of reach: gateway config, platform settings, other repos, runtime behaviour>

## Open questions for the human
- <inferences to confirm, starting with the backend shape>
```

Sort findings by severity, then by location. **Category** is one of: auth, secrets, rbac, input-validation, rate-limit, audit-log, observability, errors, concurrency.

## Flag before writing

- About to edit, format, or "quickly fix" a file in the reviewed repo.
- About to install a dependency or run a tool that needs one.
- A finding with no `file:line`.
- A finding marked confirmed that depends on something outside the repo.
- A report with no "Not checked" section.

## Done when

- [ ] Nothing in the reviewed repo changed (`git status` there is unchanged, output pasted)
- [ ] Every skill walked, and listed under findings or under "Checked, nothing found"
- [ ] Every finding has severity, `file:line` evidence, and a confidence label
- [ ] The backend shape is an open question for the human, not a settled fact
- [ ] "Not checked" lists what the code alone cannot show

`AGENTS.md` section 7 outranks this doc wherever they disagree.
