# ADR-0001: Auth pattern

- **Status:** Proposed
- **Date:** <YYYY-MM-DD>
- **Deciders:** <names>

## Context

Every beaverdam backend uses exactly one auth pattern from the approved list in `.beaverdam/skills/auth-spine.md`. This ADR records which one, with its lifetimes and timeouts, before the first auth endpoint is written.

- **Callers:** <web app on the same site | web app on another origin | mobile app | other services>
- **Backend shape:** <from AGENTS.md section 1>
- **Client or provider requirements:** <e.g. "client mandates Azure AD SSO" — if any, this ADR is not enough; see Decision>

## Decision

We use **<Pattern A: session cookie + CSRF | Pattern B: short-lived access token + refresh token>**, implemented with <library / provider, e.g. `express-session` + `connect-pg-simple` | `jose` | Supabase Auth>.

| Setting | Value | Skill default |
| --- | --- | --- |
| Idle timeout (A) / access token lifetime (B) | <...> | 30 min / 5–15 min |
| Absolute timeout (A) / refresh token lifetime (B) | <...> | 12 h / 7–30 days |
| Refresh token rotation + reuse detection (B) | <on> | on |
| Cookie flags | <HttpOnly, Secure, SameSite=...> | HttpOnly, Secure, Lax |
| Password hashing | <argon2id | bcrypt (provider)> | argon2id |
| Minimum password length | <...> | 12 |
| Password reset token lifetime | <...> | ≤ 1 h |
| Login rate limits | <...> | 5 failures / 15 min per account, 20 / min per IP |

Deviations from `auth-spine.md`, each with the reason:

- <e.g. "Supabase default JWT expiry of 3600 s kept, because ...">
- <e.g. "`@supabase/ssr` stores tokens in JS-readable cookies; mitigated by strict CSP">

Anything outside the approved list (SSO, magic links, API keys for machine callers) needs its own ADR and explicit approval.

## Alternatives considered

- **<The other approved pattern>** — <why not>
- **<Provider or library not chosen>** — <why not>

## Consequences

**Good**
- <...>

**Bad / accepted cost**
- <...>

**Follow-ups**
- Auth endpoints rate limited and audited per `rate-limit.md` and `audit-log.md`.
- Tests for expired, revoked, and missing credentials.

---
Rules: one page maximum. Immutable once accepted — to change the auth pattern, write a new ADR that supersedes this one.
