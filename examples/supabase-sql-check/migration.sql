-- ============ 1. private schema: never in the Data API's exposed schemas ============
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated; -- RLS policies call private.has_permission()

-- ============ 2. role model ============
create type public.app_role as enum ('member', 'admin', 'owner');

create table public.orgs (
  id   uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200)
);

create table public.memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id  uuid not null references public.orgs(id) on delete cascade,
  role    public.app_role not null,
  primary key (user_id, org_id)
);

-- One row per cell of the role matrix in docs/prd.md.
create table private.role_permissions (
  role       public.app_role not null,
  permission text not null,
  primary key (role, permission)
);
insert into private.role_permissions (role, permission) values
  ('member', 'invoice.read_own'), ('admin', 'invoice.read_own'), ('owner', 'invoice.read_own'),
  ('member', 'invoice.create'),   ('admin', 'invoice.create'),   ('owner', 'invoice.create'),
  ('admin',  'invoice.delete'),   ('owner', 'invoice.delete'),
  ('owner',  'member.role_change');

create function private.has_permission(p_org uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join private.role_permissions rp on rp.role = m.role
    where m.user_id = auth.uid() and m.org_id = p_org and rp.permission = p_permission
  );
$$;
revoke all on function private.has_permission(uuid, text) from public;
grant execute on function private.has_permission(uuid, text) to authenticated;

-- ============ 3. audit log ============
create table private.audit_log (
  id            bigint generated always as identity primary key,
  timestamp     timestamptz not null default now(),
  kind          text not null check (kind in ('audit', 'security')),
  request_id    text,
  actor_type    text not null,
  actor_id      text,
  actor_role    text,
  action        text not null,
  resource_type text not null,
  resource_id   text,
  result        text not null check (result in ('success', 'denied', 'error')),
  ip            text,
  route         text,
  detail        jsonb not null default '{}'
);
create index on private.audit_log (actor_id, timestamp);
create index on private.audit_log (resource_type, resource_id, timestamp);

create function private.audit(
  p_action text, p_resource_type text, p_resource_id text, p_result text,
  p_detail jsonb default '{}'::jsonb, p_kind text default 'audit'
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  h jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  c jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  insert into private.audit_log
    (kind, request_id, actor_type, actor_id, actor_role, action, resource_type, resource_id, result, ip, route, detail)
  values (
    p_kind,
    h ->> 'x-request-id',
    case when c ->> 'role' = 'service_role' then 'service'
         when c ->> 'sub' is null then 'anonymous'
         else 'user' end,
    c ->> 'sub',
    c ->> 'role',
    p_action, p_resource_type, p_resource_id, p_result,
    nullif(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1), ''),
    nullif(trim(coalesce(current_setting('request.method', true), '') || ' ' || coalesce(current_setting('request.path', true), '')), ''),
    p_detail
  );
end;
$$;
revoke all on function private.audit(text, text, text, text, jsonb, text) from public;

-- Row trigger: every insert/update/delete that reaches the table is audited in the same transaction.
create function private.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_id      text;
  v_detail  jsonb := '{}'::jsonb;
  v_verb    text := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
begin
  if tg_op = 'DELETE' then v_id := old.id::text; else v_id := new.id::text; end if;
  if tg_op = 'UPDATE' then
    -- Column names only, never values.
    select jsonb_build_object('changed', coalesce(jsonb_agg(n.key), '[]'::jsonb)) into v_detail
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value;
  end if;
  perform private.audit(tg_argv[0] || '.' || v_verb, tg_argv[0], v_id, 'success', v_detail);
  return null;
end;
$$;
revoke all on function private.audit_row() from public;

-- ============ 4. tables: RLS on, default grants revoked, column-level grants ============
alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
revoke all on public.orgs, public.memberships from anon, authenticated;
grant select on public.orgs, public.memberships to authenticated;

create policy orgs_select_member on public.orgs
  for select to authenticated
  using (exists (select 1 from public.memberships m where m.org_id = orgs.id and m.user_id = auth.uid()));

create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  customer_id  uuid not null,
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  currency     text not null check (currency in ('EUR', 'USD')),
  note         text check (char_length(note) <= 500),
  created_by   uuid not null default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now()
);
alter table public.invoices enable row level security;
revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;
-- Column list = the allowlist. id, created_by, created_at cannot be set by the client.
grant insert (org_id, customer_id, amount_cents, currency, note) on public.invoices to authenticated;
-- No update or delete grant: deletes go through public.delete_invoice().

create policy invoices_select on public.invoices
  for select to authenticated
  using (private.has_permission(org_id, 'invoice.read_own'));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (private.has_permission(org_id, 'invoice.create'));

create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function private.audit_row('invoice');

-- ============ 5. sensitive actions: RPC only ============
create function public.delete_invoice(p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invoices where id = p_id;
  if v_org is null or not private.has_permission(v_org, 'invoice.delete') then
    -- Return, do not raise: an exception would roll back this audit row.
    perform private.audit('invoice.delete', 'invoice', p_id::text, 'denied');
    return false; -- not found and not allowed look the same
  end if;
  delete from public.invoices where id = p_id; -- audit_row records the success
  return true;
end;
$$;
revoke all on function public.delete_invoice(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;

create function public.change_member_role(p_org uuid, p_user uuid, p_role public.app_role)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_old    public.app_role;
  v_owners integer;
  v_res    text := p_org::text || ':' || p_user::text;
begin
  select role into v_old from public.memberships where org_id = p_org and user_id = p_user for update;
  if v_old is null or not private.has_permission(p_org, 'member.role_change') then
    perform private.audit('member.role_change', 'membership', v_res, 'denied');
    return false;
  end if;
  if v_old = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners from public.memberships where org_id = p_org and role = 'owner';
    if v_owners <= 1 then
      perform private.audit('member.role_change', 'membership', v_res, 'denied', jsonb_build_object('reason', 'last_owner'));
      return false;
    end if;
  end if;
  update public.memberships set role = p_role where org_id = p_org and user_id = p_user;
  perform private.audit('member.role_change', 'membership', v_res, 'success',
    jsonb_build_object('old_role', v_old, 'new_role', p_role));
  return true;
end;
$$;
revoke all on function public.change_member_role(uuid, uuid, public.app_role) from public, anon;
grant execute on function public.change_member_role(uuid, uuid, public.app_role) to authenticated;

-- ============ 6. rate limiting for Data API writes ============
create table private.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null
);

create function private.hit(p_key text, p_limit integer, p_window interval)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into private.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits         = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function private.hit(text, integer, interval) from public;

-- Registered as PostgREST's pre-request hook (see recipe section 6).
create function private.check_request()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_method text := current_setting('request.method', true);
  v_key    text := coalesce(
    auth.uid()::text,
    'ip:' || coalesce(nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1), ''), 'unknown')
  );
begin
  -- GET/HEAD run in a read-only transaction, so the counter cannot be written there.
  if v_method is null or v_method in ('GET', 'HEAD') then
    return;
  end if;
  if not private.hit('write:' || v_key, 100, interval '1 minute') then
    raise sqlstate 'PGRST' using
      message = '{"code":"rate_limited","message":"Too many requests. Try again later."}',
      detail  = '{"status":429,"headers":{"Retry-After":"60"}}';
  end if;
end;
$$;
revoke all on function private.check_request() from public;
grant execute on function private.check_request() to anon, authenticated;

-- Per-user quotas for expensive work (exports, paid APIs), called from RPCs and edge functions.
create table private.quotas (
  bucket           text primary key,
  limit_per_window integer not null check (limit_per_window > 0),
  window_length    interval not null
);
insert into private.quotas (bucket, limit_per_window, window_length) values
  ('export',     10, interval '1 minute'),
  ('email.send', 20, interval '1 day');

create function public.take_quota(p_bucket text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_limit  integer;
  v_window interval;
begin
  select limit_per_window, window_length into v_limit, v_window from private.quotas where bucket = p_bucket;
  if v_limit is null or auth.uid() is null then
    return false; -- unknown bucket or no caller: deny
  end if;
  -- Returns rather than raises, so the counted hit is kept.
  return private.hit(p_bucket || ':' || auth.uid()::text, v_limit, v_window);
end;
$$;
revoke all on function public.take_quota(text) from public, anon;
grant execute on function public.take_quota(text) to authenticated;
