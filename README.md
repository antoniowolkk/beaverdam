# beaverdam

The security spine for every backend an AI agent builds. A rule set that makes the agent scaffold auth, secrets handling, RBAC, input validation, rate limiting, structured audit logging, and safe error handling by default, in whatever stack the project runs, without you naming each one.

The goal is not more security code. It is the same security baseline on every backend, instead of a fresh improvisation each time.

Three layers that need each other:

- **`AGENTS.md`.** The spine. Stack-agnostic rules, commands, guardrails. Always loaded.
- **`skills/`.** One short plain-markdown doc per part of the spine: the rule, what to flag, what counts as done.
- **`recipes/`.** One file per stack that turns each rule into real code in that stack's idiom.

A sibling to [junior-agent](https://github.com/antoniowolkk/junior-agent). junior-agent governs *how* the agent works: investigate before fixing, prove against the real thing, stop at anything hard to undo. beaverdam governs *what* it builds: the parts every backend needs no matter the language. Section 7 of `AGENTS.md` is strict by default, and the human is the merge authority.

## Install

Everything is plain markdown. No plugin format, no frontmatter. It reads the same in Claude Code, Cursor, Aider, and Codex CLI, since all of them read `AGENTS.md` natively.

Copy it into any project:

```bash
cp -n beaverdam/templates/AGENTS.md ./AGENTS.md
[ -e CLAUDE.md ] || ln -s AGENTS.md CLAUDE.md
mkdir -p docs/adr && cp -n beaverdam/templates/docs/secrets.md docs/ && cp -n beaverdam/templates/docs/adr/*.md docs/adr/
mkdir -p .beaverdam && cp -r beaverdam/skills .beaverdam/
mkdir -p .beaverdam/recipes && cp beaverdam/recipes/<your-stack>.md .beaverdam/recipes/
```

The trade-off of going tool-agnostic: Claude Code plugins can auto-load a skill by keyword match. Plain markdown cannot. Instead, `AGENTS.md` section 6b maps each task to the skill and recipe to read. Less automatic, but nothing breaks outside Claude Code.

## Set up a project

1. Copy `templates/AGENTS.md`, `templates/docs/`, `skills/`, and your stack's recipe into the project (above). `cp -n` never overwrites an `AGENTS.md` or `docs/` file the project already has, and an existing `CLAUDE.md` is left alone, so re-running is safe.
2. `ln -s AGENTS.md CLAUDE.md` so Claude Code picks it up.
3. Fill every `<...>` in `AGENTS.md`. If you do not know a value, ask the agent to read the repo and fill it, then review.
4. **Write `docs/prd.md` yourself**, including who the users are and which roles exist. The agent cannot know your role model.
5. Let the agent run `backend-shape` and `threat-model` before the first endpoint. Answer the one question `backend-shape` asks. Read the threat model it writes.
6. Fill in `docs/adr/0001-auth-pattern.md` and get it accepted before the first auth endpoint.
7. Fill in `docs/secrets.md` as each secret is added. Names and rotation steps only, never values.

Using junior-agent too? Use beaverdam's `AGENTS.md` as the project file instead of junior-agent's template. It keeps the same section numbers, so junior-agent's skills still find section 7 where they expect it.

## What is in here

| Path | What it is |
| --- | --- |
| `templates/AGENTS.md` | The main file, copied into each project. Spine, commands, conventions, guardrails. Template with `<...>` placeholders. |
| `templates/docs/adr/0000-template.md` | Blank ADR, from junior-agent. Copy per decision. |
| `templates/docs/adr/0001-auth-pattern.md` | The first ADR every project needs: which approved auth pattern, lifetimes, timeouts, deviations. |
| `templates/docs/secrets.md` | Secret names, owners, and rotation steps. Never values. |
| `skills/backend-shape.md` | Mandatory first gate. Classifies data shape and traffic shape; asks if unclear. |
| `skills/threat-model.md` | First pass on any new backend or major feature: data touched, who can reach it, worst case. |
| `skills/auth-spine.md` | The approved auth patterns. Blocks ad hoc reinvention. |
| `skills/secrets-handling.md` | Keeps secrets out of code, git history, logs, and responses. Rotation path. |
| `skills/rbac.md` | Deny by default. Every protected route declares its role. |
| `skills/audit-log.md` | The one log schema. Flags state-changing endpoints with no audit entry. |
| `skills/input-validation.md` | Boundary validation. Flags raw request data in a query or write. |
| `skills/rate-limit.md` | What needs limiting, and default thresholds. |
| `skills/incident-checklist.md` | Runbook, not a build rule: what to do when a key leaks or an account is compromised. |
| `recipes/node-express.md` | Spine → Node/Express + Postgres code. |
| `recipes/supabase.md` | Spine → Supabase RLS, policies, edge functions. |
| `recipes/python-fastapi.md` | Spine → FastAPI code. Added when a project needs it. |
| `examples/supabase-sql-check/` | The Supabase recipe's full migration, run on a throwaway Postgres with a stub of Supabase's roles and `auth` schema. 42 checks, no Docker needed. |
| `examples/node-express-demo/` | Pattern A (session + CSRF) built from the Node recipe: 16 integration tests against a throwaway Postgres. The proof the recipe works. |
| `LICENSE` | MIT. |

Recipes are additive. A new stack is a new file; the core never changes to fit one. No recipe for your stack yet? The agent follows the abstract rule in `skills/` and asks before writing any auth, secrets, or RBAC pattern. Those three are never improvised.

## The three rules that make it work

**Complete by default.** Section 5 of `AGENTS.md` lists seven things every backend gets from the first endpoint: auth, secrets, RBAC, input validation, rate limiting, audit logging, error handling. Not "before launch". The agent does not wait to be asked for each one, and it does not decide per project whether one applies.

**Same shape everywhere.** One approved list of auth patterns. One audit-log schema: timestamp, request id, actor, action, resource, result, source. One error handler. When every backend logs and fails the same way, you, a teammate, or an agent debugging it later can tell what happened, who did it, and whether it is safe to act next, without reverse-engineering a new logging style each time.

**Strict where it matters.** Section 7 is strict: the agent stops and asks before touching auth, roles, rate limits, CORS, secrets, migrations, or anything outside localhost. It never weakens a check to make a test pass. Every endpoint gets tests for the success path, invalid input, no credentials, and wrong role, and the unauthorized tests are never deleted to reach green.

**The cost is some speed on throwaway work.** For spikes there is a prototype mode, opted into explicitly, per session. It lets the agent skip rate limiting, full RBAC, and audit logging. It never skips secrets handling or auth on anything reachable from outside localhost, and prototype code never merges without the full spine.

## Why this instead of a bare agent

A stock coding agent builds what you ask for and stops there. Ask for a CRUD endpoint and you get a CRUD endpoint: no role check, `console.log` instead of an audit entry, the raw request body passed to the database, a stack trace in the error response. None of that is a bug in the model. Security is rarely in the request, so it is rarely in the output.

Against **reminding the agent each time**, the difference is that the reminder is written down. "Add auth, validate input, rate limit it, log it" retyped per project turns into five different implementations across five client backends. Here it is one rule set, read every session.

Against **a boilerplate starter repo**, the difference is portability. A starter locks you into one stack and one set of libraries. beaverdam is rules plus recipes: the rule holds across Node, Supabase, and FastAPI, and the recipe translates it.

Against **a security scanner**, the difference is timing. Scanners find the missing check after it is written. beaverdam shapes what gets written in the first place. It is not a replacement for dependency scanning, and does not try to be.

## Scope

| Domain | v1 | Later |
| --- | --- | --- |
| Auth | Session cookie + CSRF, or access + refresh token | OAuth / SSO providers |
| Secrets | Env vars, basic secrets manager | Vault, AWS Secrets Manager integration |
| Access control | RBAC | Attribute-based (ABAC) |
| Audit logging | Structured schema, local | Log shipping / SIEM |
| Input validation | Boundary validation | Schema-driven contracts end to end (OpenAPI, Zod) |
| Rate limiting | Fixed thresholds | Adaptive / anomaly-based |
| Incident response | Checklist | Automated alerting hooks |
| Compliance mapping | Out of scope | SOC2 / ISO27001, if a client requires it |
| Agent-specific guardrails | Out of scope, lives in junior-agent's planned governance skill | Cross-referenced once both exist |

Not a compliance framework, not a runtime scanner, not a clone-and-run app.

## Keep it alive

`AGENTS.md` is only useful while it is true. When a command changes, a role is added, or the auth pattern changes, update it in the same change. A stale `AGENTS.md` is worse than none, because the agent will trust it.

Recipes go stale as frameworks version. When a project surfaces drift between a recipe and the current framework, fix the recipe upstream in the same week.

## Before you start a project

- [ ] No `<...>` placeholders left in `AGENTS.md`
- [ ] Every command in section 4 actually runs, including the secret scan
- [ ] `docs/prd.md` filled in by a human, with the role model
- [ ] Backend shape set in section 1
- [ ] `docs/threat-model.md` written and read
- [ ] `docs/adr/0001-auth-pattern.md` accepted
- [ ] `docs/secrets.md` lists every secret the backend reads
- [ ] `.env` gitignored before the first commit
- [ ] `CLAUDE.md` symlink exists
- [ ] Skills and your stack's recipe copied into `.beaverdam/`

## Status

| Version | Contents |
| --- | --- |
| v0 | `AGENTS.md` core + build-time skills. Tested by hand on one Node/Express backend. |
| v0.1 | First recipe: Node/Express + Postgres. |
| v0.2 | Supabase recipe. |
| v1 | Both recipes proven on a real project each, incident checklist written, repo public. |
| v1.x | FastAPI and other recipes, only as real projects need them. |

## Credit

Structure follows [junior-agent](https://github.com/antoniowolkk/junior-agent), whose `AGENTS.md` / PRD / ADR shape comes from the "Agentic AI in the SDLC" workshop.

MIT licensed. Fork it, improve it, make it yours.
