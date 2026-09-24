import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54331;
await rm(".pgdata", { recursive: true, force: true });
const server = new EmbeddedPostgres({ databaseDir: ".pgdata", user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
await server.initialise(); await server.start(); await server.createDatabase("supa");
const pool = new pg.Pool({ connectionString: `postgres://postgres:postgres@localhost:${PORT}/supa`, max: 4 });

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

try {
  await pool.query(await readFile("supabase-stub.sql", "utf8"));
  await pool.query(await readFile("migration.sql", "utf8"));
  ok(true, "migration applies cleanly on Postgres " + (await pool.query("show server_version")).rows[0].server_version);

  // Run fn as an API caller, like PostgREST does: set claims + role inside a transaction.
  async function as(sub, fn, { role = "authenticated", method = "POST" } = {}) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.method', $2, true), set_config('request.path', '/rest/v1/rpc', true), set_config('request.headers', $3, true)",
        [JSON.stringify(sub ? { sub, role } : { role }), method, JSON.stringify({ "x-request-id": "req-" + randomUUID(), "x-forwarded-for": "203.0.113.7, 10.0.0.1" })]);
      await c.query(`set local role ${role}`);
      const out = await fn(c);
      await c.query("commit");
      return { out };
    } catch (err) {
      await c.query("rollback");
      return { err };
    } finally { c.release(); }
  }
  const q = (sql, p) => (c) => c.query(sql, p);

  // --- seed (as owner) ---
  const [uMember, uAdmin, uOwner, uOther] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const u of [uMember, uAdmin, uOwner, uOther]) await pool.query("insert into auth.users (id, email) values ($1, $2)", [u, u + "@example.test"]);
  const orgA = (await pool.query("insert into public.orgs (name) values ('A') returning id")).rows[0].id;
  const orgB = (await pool.query("insert into public.orgs (name) values ('B') returning id")).rows[0].id;
  await pool.query("insert into public.memberships values ($1,$4,'member'),($2,$4,'admin'),($3,$4,'owner'),($5,$6,'owner')", [uMember, uAdmin, uOwner, orgA, uOther, orgB]);
  const invA = (await pool.query("insert into public.invoices (org_id, customer_id, amount_cents, currency, created_by) values ($1, gen_random_uuid(), 1000, 'EUR', $2) returning id", [orgA, uAdmin])).rows[0].id;
  const invB = (await pool.query("insert into public.invoices (org_id, customer_id, amount_cents, currency, created_by) values ($1, gen_random_uuid(), 1000, 'EUR', $2) returning id", [orgB, uOther])).rows[0].id;
  await pool.query("delete from private.audit_log");

  // --- spine checks (same queries as the recipe's section 12) ---
  const spine = {
    "no public table without RLS": `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`,
    "anon has no privilege on any public table": `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m') and has_table_privilege('anon', c.oid, 'select,insert,update,delete')`,
    "anon can execute no public function": `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    "every security definer function pins search_path": `select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public','private') and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')`,
    "no public view bypasses RLS": `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> array['security_invoker=true'], false)`,
    "API roles cannot touch private tables": `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relkind = 'r' and (has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') or has_table_privilege('anon', c.oid, 'select,insert,update,delete'))`,
  };
  for (const [name, sql] of Object.entries(spine)) { const r = await pool.query(sql); ok(r.rowCount === 0, "spine: " + name, r.rows.map(Object.values).join(", ")); }

  // --- RLS reads ---
  let r = await as(uMember, q("select id from public.invoices"));
  ok(r.out?.rows.length === 1 && r.out.rows[0].id === invA, "member sees only own org's invoices");
  r = await as(uMember, q("select user_id from public.memberships"));
  ok(r.out?.rows.length === 1, "member sees only own membership");
  r = await as(null, q("select id from public.invoices"), { role: "anon" });
  ok(r.err?.code === "42501", "anon cannot read invoices", r.err?.code);

  // --- inserts: RLS + column grants + constraints ---
  const body = (org) => [org, randomUUID(), 1999, "EUR"];
  r = await as(uMember, q("insert into public.invoices (org_id, customer_id, amount_cents, currency) values ($1,$2,$3,$4) returning id, created_by", body(orgA)));
  ok(r.out?.rows[0]?.created_by === uMember, "member creates in own org; created_by defaults to caller");
  const created = r.out?.rows[0]?.id;
  r = await as(uMember, q("insert into public.invoices (org_id, customer_id, amount_cents, currency) values ($1,$2,$3,$4)", body(orgB)));
  ok(r.err?.code === "42501", "member cannot create in another org (RLS with check)", r.err?.code);
  r = await as(uMember, q("insert into public.invoices (org_id, customer_id, amount_cents, currency, created_by) values ($1,$2,$3,$4,$5)", [...body(orgA), uAdmin]));
  ok(r.err?.code === "42501", "member cannot set created_by (column grant = mass-assignment block)", r.err?.code);
  r = await as(uMember, q("insert into public.invoices (org_id, customer_id, amount_cents, currency) values ($1,$2,0,'EUR')", [orgA, randomUUID()]));
  ok(r.err?.code === "23514", "amount 0 rejected by check constraint", r.err?.code);
  r = await as(uMember, q("insert into public.invoices (org_id, customer_id, amount_cents, currency) values ($1,$2,100,'GBP')", [orgA, randomUUID()]));
  ok(r.err?.code === "23514", "unknown currency rejected", r.err?.code);

  let a = (await pool.query("select action, result, actor_type, actor_id, resource_id, ip, route from private.audit_log where resource_id = $1", [created])).rows;
  ok(a.length === 1 && a[0].action === "invoice.create" && a[0].actor_id === uMember && a[0].ip === "203.0.113.7" && a[0].route === "POST /rest/v1/rpc", "insert audited by trigger with actor, ip, route", JSON.stringify(a));

  // --- no direct update/delete ---
  r = await as(uAdmin, q("update public.invoices set amount_cents = 1 where id = $1", [invA]));
  ok(r.err?.code === "42501", "no one can update invoices directly", r.err?.code);
  r = await as(uAdmin, q("delete from public.invoices where id = $1", [invA]));
  ok(r.err?.code === "42501", "no one can delete invoices directly", r.err?.code);

  // --- delete RPC ---
  r = await as(uMember, q("select public.delete_invoice($1) as ok", [invA]));
  ok(r.out?.rows[0].ok === false, "member delete_invoice → false");
  a = (await pool.query("select result, actor_id from private.audit_log where action = 'invoice.delete' and resource_id = $1", [invA])).rows;
  ok(a.length === 1 && a[0].result === "denied" && a[0].actor_id === uMember, "member's denied delete is audited and survives commit", JSON.stringify(a));
  r = await as(uAdmin, q("select public.delete_invoice($1) as ok", [invB]));
  ok(r.out?.rows[0].ok === false && (await pool.query("select 1 from public.invoices where id = $1", [invB])).rowCount === 1, "admin cannot delete another org's invoice; row intact");
  r = await as(uAdmin, q("select public.delete_invoice($1) as ok", [invA]));
  ok(r.out?.rows[0].ok === true, "admin delete_invoice → true");
  a = (await pool.query("select result from private.audit_log where action = 'invoice.delete' and resource_id = $1 and actor_id = $2", [invA, uAdmin])).rows;
  ok(a.length === 1 && a[0].result === "success", "admin delete audited exactly once", JSON.stringify(a));
  r = await as(null, q("select public.delete_invoice($1)", [invB]), { role: "anon" });
  ok(r.err?.code === "42501", "anon cannot execute delete_invoice", r.err?.code);

  // --- private schema is closed ---
  for (const t of ["private.audit_log", "private.role_permissions", "private.rate_limits"]) {
    r = await as(uOwner, q(`select * from ${t}`));
    ok(r.err?.code === "42501", `authenticated cannot read ${t}`, r.err?.code);
  }
  r = await as(uOwner, q("select private.hit('x', 1000, '1 minute')"));
  ok(r.err?.code === "42501", "authenticated cannot call private.hit directly", r.err?.code);
  r = await as(uOwner, q("select private.audit('invoice.delete','invoice','forged','success')"));
  ok(r.err?.code === "42501", "authenticated cannot forge audit entries", r.err?.code);

  // --- role changes ---
  r = await as(uAdmin, q("select public.change_member_role($1,$2,'owner') as ok", [orgA, uAdmin]));
  ok(r.out?.rows[0].ok === false, "admin cannot promote self to owner");
  r = await as(uOwner, q("select public.change_member_role($1,$2,'admin') as ok", [orgA, uMember]));
  ok(r.out?.rows[0].ok === true, "owner promotes member to admin");
  r = await as(uOwner, q("select public.change_member_role($1,$2,'admin') as ok", [orgA, uOwner]));
  ok(r.out?.rows[0].ok === false, "last owner cannot be demoted");
  r = await as(uMember, q("select id from public.invoices where id = $1", [created]));
  ok(r.out?.rows.length === 1, "role change applies on the very next query (no token refresh needed)");
  a = (await pool.query("select result, detail from private.audit_log where action = 'member.role_change' order by id")).rows;
  ok(a.map((x) => x.result).join(",") === "denied,success,denied" && a[2].detail.reason === "last_owner", "all three role-change attempts audited", JSON.stringify(a));

  // --- rate limiting ---
  const hits = [];
  for (let i = 0; i < 4; i++) hits.push((await pool.query("select private.hit('t', 3, '1 minute') as ok")).rows[0].ok);
  ok(hits.join(",") === "true,true,true,false", "private.hit allows 3 then blocks", hits.join(","));
  await pool.query("insert into private.rate_limits values ($1, now(), 100)", ["write:" + uMember]);
  r = await as(uMember, q("select private.check_request()"), { method: "POST" });
  ok(r.err?.code === "PGRST" && JSON.parse(r.err.detail).status === 429, "pre-request hook raises PGRST 429 with Retry-After", r.err?.code + " " + r.err?.detail);
  r = await as(uMember, q("select private.check_request()"), { method: "GET" });
  ok(!r.err, "pre-request hook skips GET (read-only transaction)");
  const still = (await pool.query("select hits from private.rate_limits where key = $1", ["write:" + uMember])).rows[0].hits;
  ok(still === 100, "blocked request's increment rolled back; stays blocked until window resets", String(still));
  // --- quotas ---
  const takes = [];
  for (let i = 0; i < 11; i++) takes.push((await as(uMember, q("select public.take_quota('export') as ok"))).out?.rows[0].ok);
  ok(takes.filter(Boolean).length === 10 && takes[10] === false, "take_quota('export') allows 10 per minute per user, then false", takes.join(","));
  r = await as(uAdmin, q("select public.take_quota('export') as ok"));
  ok(r.out?.rows[0].ok === true, "quota is per user (another user unaffected)");
  r = await as(uMember, q("select public.take_quota('nope') as ok"));
  ok(r.out?.rows[0].ok === false, "unknown quota bucket denies");
  r = await as(null, q("select public.take_quota('export')"), { role: "anon" });
  ok(r.err?.code === "42501", "anon cannot take quota", r.err?.code);
} catch (e) {
  fail++; console.log("CRASH", e);
} finally {
  await pool.end(); await server.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
