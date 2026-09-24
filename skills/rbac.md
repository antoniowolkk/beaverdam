# RBAC

Deny by default. Every protected route declares the role it requires, at the boundary, and checks that the caller owns the record it touches.

**Read when:** adding a route, adding or changing a role, changing what a role may do, or touching any code that decides whether a caller may act.

## Rule

- **Deny by default.** A route with no declared requirement rejects the request. Public routes are declared public explicitly, not left undeclared.
- **Declared at the boundary.** The required role is stated at the route or middleware level, where a reviewer can see it next to the route definition. Never buried in business logic, never inferred from which button the frontend shows.
- **Two checks, both required where they apply:**
  - **Role check** — may this kind of user do this kind of action?
  - **Ownership check** — may *this* user touch *this* record? (Their own invoice, their organisation's project.) Missing ownership checks are the most common access bug (IDOR).
- **Identity and roles come from the server.** From the verified session or token, then the database. Never from a request body, query string, or client-set header.
- **The role model is written down.** Roles and their permissions live in `docs/prd.md` or an ADR as a matrix. Do not invent a role or a permission.
- **Multi-tenant:** every query on tenant-owned data is scoped by the caller's tenant id, taken from the session. A query without the tenant filter is a bug.

## The role matrix

Keep it in `docs/prd.md` or `docs/adr/`:

```markdown
| Action              | anonymous | member | admin | owner |
| ------------------- | --------- | ------ | ----- | ----- |
| invoice.read (own)  |           | ✓      | ✓     | ✓     |
| invoice.read (any)  |           |        | ✓     | ✓     |
| invoice.delete      |           |        | ✓     | ✓     |
| member.role.change  |           |        |       | ✓     |
```

Every route maps to one row. If a route has no row, stop and ask.

## Steps

1. **Find the row** in the role matrix for the action. None → ask the human.
2. **Declare the requirement** on the route using the recipe's pattern (middleware, decorator, RLS policy).
3. **Add the ownership check** if the route takes a record id. Load the record scoped to the caller (`WHERE id = ? AND owner_id = ?`), rather than loading by id and comparing afterwards. Not found and not yours return the same 404.
4. **Write the tests:** allowed role succeeds, lower role gets 403, no credentials gets 401, same role but someone else's record gets 404 (or 403, consistently).
5. **Audit** role changes, permission changes, and denied attempts on sensitive actions per `audit-log.md`.

## Privilege changes

- A user cannot grant themselves a role or a higher role than their own.
- The last owner of an organisation cannot be removed or demoted.
- Role changes take effect on the next request, not at next login: re-read the role from the database or revoke sessions.
- Every role change is audited with actor, target user, old role, new role.

## Database-level enforcement

Where the stack supports it (Postgres RLS, Supabase policies), enforce ownership in the database too. It is a second layer, not a replacement for the route check. On Supabase, RLS is enabled on every table in an exposed schema, with no exceptions.

## Flag before writing

- A route with no role declaration.
- `if (user.role === 'admin')` inside a service instead of at the boundary.
- A record loaded by id with no owner or tenant filter.
- A `userId`, `role`, `orgId`, or `isAdmin` field read from the request body.
- A role check that allows by default and blocks by exception (`if role != 'guest'`).
- Mass assignment that lets a user set their own `role` field via a profile update.
- A table with RLS disabled or a policy of `USING (true)` on user data.

## Done when

- [ ] Every route in the change maps to a row in the role matrix
- [ ] Role declared at the boundary for each
- [ ] Ownership or tenant scope enforced in the query for each record route
- [ ] Tests for 200, 401, 403, and not-your-record, all passing, output pasted
- [ ] Role and permission changes audited

`AGENTS.md` section 7 outranks this doc wherever they disagree. Changing roles or permissions needs an ADR and approval.
