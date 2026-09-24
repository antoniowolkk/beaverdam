# Input Validation

Every external input is validated against a schema at the boundary, before it reaches business logic or the database. Unknown fields are rejected. Raw request data never goes directly into a query, a write, a shell command, or a file path.

**Read when:** adding or changing an endpoint, webhook, file upload, query parameter, socket message handler, or any code that reads from the request.

## What counts as external input

Request body, query string, path params, headers, cookies, file uploads and their filenames, webhook payloads, socket messages, third-party API responses, and anything read back from storage that a user originally wrote.

## Rule

- **Schema at the boundary.** One schema per endpoint, using the recipe's validation library. Validation happens in the route or middleware layer. Services receive typed, validated data and never the raw request.
- **Allowlist, not blocklist.** Define what is allowed: types, lengths, ranges, formats, enums. Do not try to strip what is bad.
- **Reject unknown fields.** Prevents mass assignment (a user setting `role`, `owner_id`, `is_verified`, or `price` via a field you did not expect).
- **Bound everything.** Max string length, max array length, max page size, max request body size set at the server level, max upload size.
- **Parameterized queries only.** Use the ORM or query builder's parameter binding. Never build SQL by string concatenation or template literals, including for `ORDER BY` and column names — map those through an allowlist.
- **No shell, no eval.** Never pass input to a shell command, `eval`, or a template engine as code. If a shell call is unavoidable, pass arguments as an array, never a string.
- **Validation failure** returns 400 (or 422) with field-level messages that do not echo back internals.

## Special inputs

| Input | Extra rules |
| --- | --- |
| IDs | Validate format (UUID, prefixed id). Then apply the ownership check from `rbac.md`. A valid id is not a permitted id. |
| Emails | Validate format, normalise case, cap length. Do not use as a trusted identity until verified. |
| URLs the server will fetch | Allowlist hosts. Block private, loopback, and link-local ranges, and re-check after redirects. This is SSRF. |
| File uploads | Size cap. Check type by content (magic bytes), not by extension or `Content-Type`. Store under a generated name, outside any web-served path, or in object storage. Never use the client's filename in a path. |
| File paths | Never built from input. If unavoidable, resolve and confirm the result stays inside the allowed directory. |
| Webhooks | Verify the provider's signature against the **raw** body before parsing. Check the timestamp tolerance to block replays. Then validate the payload schema. |
| Pagination | Default and maximum page size. Cursor or offset validated as a number or opaque token. |
| Dates and money | Explicit format. Money as integer minor units or a decimal type, never floats. |

## Steps

1. **List every input** the endpoint reads, including headers and path params.
2. **Write the schema** with types, bounds, and unknown fields rejected.
3. **Wire it at the boundary** using the recipe's pattern. The handler only touches the parsed result.
4. **Write the tests:** valid input passes; each of missing field, wrong type, too long, unknown field, and out-of-range value is rejected with 400/422 and does not reach the service.
5. **Check the queries** the endpoint runs. Every value bound as a parameter.

## Flag before writing

- `req.body`, `request.json()`, or `req.query` passed to a service, ORM `create`/`update`, or query.
- SQL built with `+`, template strings, or f-strings.
- `ORDER BY ${req.query.sort}`.
- A schema that allows extra fields, or an ORM update from the whole body (`User.update(req.body)`).
- A user-supplied URL fetched without a host allowlist.
- An upload saved using the original filename.
- A webhook parsed before its signature is verified.

## Done when

- [ ] Every input the change reads is covered by a schema at the boundary
- [ ] Unknown fields rejected, all strings and arrays bounded
- [ ] Every query parameterized
- [ ] Tests for valid and for each class of invalid input, passing, output pasted

`AGENTS.md` section 7 outranks this doc wherever they disagree.
