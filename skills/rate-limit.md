# Rate Limit

Every public-facing endpoint is rate limited. Auth endpoints and expensive endpoints get stricter limits. Thresholds live in one config, not scattered through the code.

**Read when:** adding a public endpoint, an auth endpoint, an endpoint that does expensive work (search, export, file processing, AI calls, paid third-party calls), or changing a threshold.

## Rule

- **Every endpoint reachable from the internet has a limit.** A global default applies to everything; stricter limits stack on top for sensitive routes.
- **Keyed by user when authenticated, by IP otherwise.** Login is keyed by both the target account and the IP, so one attacker cannot spray one account from many IPs or many accounts from one IP unnoticed.
- **One config.** Thresholds in a single config object or file, named by route group. Changing an auth threshold needs an ADR (section 8 of `AGENTS.md`).
- **429 with `Retry-After`.** The response says when to retry and nothing about how the limiter works.
- **Rate-limit hits on auth endpoints are logged** as `kind: security` per `audit-log.md`.

## Default thresholds

Starting points. The PRD or an ADR can change them; the agent does not.

| Route group | Limit | Key |
| --- | --- | --- |
| Login | 5 failed attempts per 15 min | per account |
| Login | 20 requests per min | per IP |
| Signup | 5 per hour | per IP |
| Password reset request | 3 per hour | per account, and 10 per hour per IP |
| Token refresh | 30 per min | per user |
| Expensive (export, search, file processing, AI, paid APIs) | 10 per min | per user |
| Authenticated default | 100 per min | per user |
| Unauthenticated default | 60 per min | per IP |
| Webhooks from a provider | Provider's documented peak × 2 | per source |

## Getting the key right

- **Behind a proxy or load balancer,** configure the framework to trust exactly that proxy for the client IP. Trusting all `X-Forwarded-For` values lets anyone spoof their IP and dodge the limit. Not trusting any makes every request look like it comes from the proxy.
- **More than one instance** (serverless, horizontal scaling) needs a shared store: Redis, Postgres, or the platform's built-in limiter. In-memory limits are only correct on a single long-running instance. Say which one is in use.

## Beyond request counts

- **Bound the work, not only the requests.** Page size caps, export row caps, query timeouts, upload size caps. Ten requests per minute that each export a million rows is still a problem.
- **Timeouts on every outbound call** so a slow dependency cannot tie up every worker.
- **Paid third-party calls** (AI, SMS, email) get a per-user daily cap as well as a per-minute limit, so one account cannot run up the bill.

## Steps

1. **Classify the endpoint:** auth, expensive, authenticated default, unauthenticated default, webhook.
2. **Apply the limit** using the recipe's pattern, reading the threshold from config.
3. **Confirm the key** is right for the deployment (trusted proxy set, shared store if multi-instance).
4. **Write the test:** requests up to the limit succeed; the next returns 429 with `Retry-After`; for login, the failed-attempt counter resets on success.
5. **Log** auth rate-limit hits as security events.

## Flag before writing

- A public route with no limit, including health checks that do real work.
- Login limited only per IP, or only per account.
- `trust proxy = true` (trust everything) instead of the specific proxy.
- An in-memory limiter on a serverless or multi-instance deployment.
- Thresholds as magic numbers inside route files.
- An export or search endpoint with no row or page cap.

## Done when

- [ ] Every public endpoint in the change has a limit from config
- [ ] Auth and expensive endpoints on their stricter group
- [ ] Key and store correct for how this is deployed, stated in the report
- [ ] Test hits the limit and gets 429 with `Retry-After`, output pasted

`AGENTS.md` section 7 outranks this doc wherever they disagree. Changing rate limits needs an ADR and approval.
