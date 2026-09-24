# Secrets Handling

Secrets live in one place, are referenced by name, and never land in code, git history, logs, fixtures, or anything the client can see.

**Read when:** adding config, an env var, a third-party integration, an API key, a signing key, a database URL, or anything that looks like a credential.

A secret is anything that grants access: API keys, database URLs with passwords, signing and encryption keys, OAuth client secrets, webhook signing secrets, service-role keys, SMTP passwords, private certificates.

## Rule

- **Source:** environment variables or the project's secrets manager, as recorded in section 3 of `AGENTS.md`. Nothing else.
- **One source per secret.** Referenced by name. Never copied into a second config file, a second `.env`, a README, or a script.
- **Read once, at startup,** through one config module. Fail fast if a required secret is missing. No silent fallback to a default value.
- **Never in:** source code, git history, logs, error messages, test fixtures, seed files, client bundles, API responses, commit messages, PR descriptions.
- **Least privilege.** Each key has only the permissions this backend needs. Separate keys per environment (dev, staging, production). Never reuse a production key locally.
- **Rotation path documented** for each secret: who rotates it, where, what needs a restart.

## Anything shipped to a client is public

Frontend bundles and mobile apps are readable by anyone. A key that ends up there is not a secret.

- Only keys designed to be public go to clients (e.g. a Supabase anon key, a Stripe publishable key), and only with server-side protection behind them (RLS, restricted scopes).
- Service-role keys, secret keys, and database URLs never go to a client, not even "temporarily".

## Steps

1. **Before adding a secret**, ask the human (section 7: secrets need a yes). Say what it is for and what permissions it needs.
2. **Add the name** to `.env.example` with an empty value and a one-line comment. Never a real value, never a realistic-looking fake.
3. **Read it** through the config module. Type it. Fail at startup if missing.
4. **Add it to the redaction list** used by the logger (see `audit-log.md`), so an accidental log of the config object prints `[REDACTED]`.
5. **Record the rotation path** in `docs/secrets.md`: name, purpose, where it lives, who rotates, what restarts. Names only, never values.
6. **Run the secret scan** from section 4 of `AGENTS.md` before calling the change done.

## Flag before writing

- A string that looks like a key: long random tokens, `sk_`, `pk_live`, `AKIA`, `ghp_`, `xox`, `-----BEGIN`, a URL with `user:password@`.
- `console.log(config)`, `print(os.environ)`, or logging a request with headers intact.
- A secret passed as a query parameter (ends up in access logs).
- A default value for a secret in code (`process.env.KEY || "dev-key"`).
- `.env` not in `.gitignore`.
- A secret in a Dockerfile, CI yaml, or `docker-compose.yml` instead of a reference to the platform's secret store.

## If a secret has already leaked

Removing it from the latest commit is not enough. It is in git history, and possibly in forks, CI logs, and caches. Stop and go to `incident-checklist.md`. The secret must be rotated. The human does the rotation (section 7).

## Done when

- [ ] Name in `.env.example`, value nowhere in the repo
- [ ] Read through the config module, fails fast if missing
- [ ] On the logger redaction list
- [ ] Rotation path in `docs/secrets.md`
- [ ] Secret scan passes, output pasted

`AGENTS.md` section 7 outranks this doc wherever they disagree. Creating, reading, printing, or modifying a secret always needs a yes first.
