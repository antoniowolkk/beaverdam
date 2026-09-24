# Incident Checklist

A runbook, not a build rule. What to do when a secret may have leaked, an account looks compromised, or the logs show something that should not have happened.

**Read when:** a key or token appears in git, logs, a screenshot, a chat, or a public place; a user reports activity they did not do; audit logs show unexpected access, role changes, or deletes; a dependency or provider announces a breach that affects this backend.

## First, stop

1. **Stop building.** Do not keep working on the current task.
2. **Tell the human immediately,** in plain words: what you saw, where, and when you saw it. Paste the evidence, with any secret value masked.
3. **Do not act alone on containment.** Rotating keys, revoking sessions, disabling accounts, and touching production all need a yes (section 7 of `AGENTS.md`). Your job is to prepare the exact steps so the human can run them fast.

Speed matters, but a wrong containment step on production is its own incident.

## Contain

Prepare these for the human, in order, marking which apply.

| Situation | Contain by |
| --- | --- |
| Secret in git (any commit, any branch) | Rotate the secret at the provider. Rewriting history does not un-leak it — assume it was copied. Then update the secret source and restart. |
| Secret in logs | Rotate. Then purge or restrict the affected logs, and fix the code that logged it. |
| Compromised user account | Revoke all sessions and refresh tokens for the user. Force password reset. Check for changes to their email, MFA, or API keys. |
| Compromised admin account | Same as above, plus review every role change and destructive action by that account in the window. |
| Database credentials | Rotate. Check database logs for connections from unexpected sources. |
| Signing key (sessions, JWTs, webhooks) | Rotate. This logs out every user, or breaks webhook delivery until the provider has the new secret. Warn the human before. |
| Third-party breach | Rotate every key shared with that provider. Check their advisory for the exposure window. |

## Find the window

1. **Earliest possible exposure:** the commit time, the log time, the date the provider says.
2. **Detection time:** now, or when it was first noticed.
3. **The window is between the two.** Everything below is scoped to it.

## Check the blast radius

Use the audit log (`audit-log.md` schema) for the window:

- Every action by the affected actor or key: `actor.id` matches, sorted by `timestamp`.
- Every `denied` result from unexpected IPs or at unusual volume.
- Every role change, permission change, delete, data export, and API key creation.
- Every `kind: security` event: refresh-token reuse, repeated failed logins, rate-limit hits.
- What data the leaked credential could reach, from `docs/threat-model.md`. Assume anything reachable was read unless the logs prove otherwise.

Label each finding measured (seen in logs), inferred, or unknown. "No evidence of access" when the logs do not cover that access is **unknown**, not safe.

## Fix the cause

- Find how it happened: the commit, the log line, the missing check.
- Write a failing test or a scan rule that would have caught it.
- Fix it under the normal TDD flow in section 6 of `AGENTS.md`.
- If the spine had a gap, propose a change to the relevant skill.

## Notify

The human decides who to notify and when. Prepare the facts they need:

- What was exposed, the window, what the logs show was accessed, what is unknown.
- **If personal data of EU residents may be affected:** GDPR requires notifying the supervisory authority within 72 hours of becoming aware of a personal data breach, unless it is unlikely to result in a risk to people. Flag this to the human at the start, not at the end. The decision is theirs and the client's.
- For client projects, the client is told. Their contract may set a shorter deadline than GDPR.

## Write it down

Add `docs/incidents/<date>-<short-name>.md`:

```markdown
# <date> — <short name>

- Detected: <time, by whom or what>
- Exposure window: <from> → <to>
- What was exposed:
- What the logs show:            (measured)
- What we do not know:
- Contained by: <steps, who ran them, when>
- Root cause:
- Fix: <PR / commit>
- Notified: <who, when> / not required because <reason>
```

## Done when

- [ ] Human told, evidence shared with secrets masked
- [ ] Containment steps prepared and run by the human
- [ ] Window and blast radius written down, every finding labelled
- [ ] Root cause fixed with a test that would have caught it
- [ ] Notification decision made by the human and recorded
- [ ] Incident note in `docs/incidents/`

`AGENTS.md` section 7 outranks this doc wherever they disagree. During an incident that matters more, not less.
