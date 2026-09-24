-- Run as the owner role. The app connects as app_user and owns nothing.
CREATE TABLE orgs (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('member', 'admin', 'owner')),
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  customer_id  uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency     text NOT NULL,
  note         text,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);

CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp     timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind IN ('audit', 'security')),
  request_id    text,
  actor_type    text NOT NULL,
  actor_id      text,
  actor_role    text,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   text,
  result        text NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  ip            inet,
  route         text,
  detail        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, timestamp);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_type, resource_id, timestamp);

GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, users, invoices, session TO app_user;
REVOKE ALL ON audit_log FROM app_user;
GRANT INSERT, SELECT ON audit_log TO app_user;
