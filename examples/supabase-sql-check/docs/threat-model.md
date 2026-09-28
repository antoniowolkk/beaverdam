# Threat model — supabase-sql-check

Last updated: 2026-09-28 · Backend shape: CRUD data API with sensitive actions via RPC, public low traffic

Trimmed to the entry-point table. It is the endpoint inventory: `run.mjs` fails if it and what the API roles can reach disagree. Assumes `public` is the only schema the Data API exposes.

## Entry points
| Entry point | Callers | Data touched | Rate limited | Audit logged |
| --- | --- | --- | --- | --- |
| `table public.orgs` | authenticated (own orgs) | orgs | pre-request hook | trigger |
| `table public.memberships` | authenticated (own org) | memberships | pre-request hook | trigger |
| `table public.invoices` | authenticated (own org) | invoices | pre-request hook | trigger |
| `rpc public.delete_invoice` | authenticated, admin+ | invoices | pre-request hook | yes, including denials |
| `rpc public.change_member_role` | authenticated, owner | memberships | pre-request hook | yes, including denials |
| `rpc public.take_quota` | authenticated | rate-limit counters | is the quota | no |
