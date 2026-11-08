BEGIN;
ALTER TABLE sentinel.machines ADD COLUMN IF NOT EXISTS manufacturer text NOT NULL DEFAULT '';
ALTER TABLE sentinel.machines ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
ALTER TABLE sentinel.machines ADD COLUMN IF NOT EXISTS last_service_date date;
ALTER TABLE sentinel.machines ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE sentinel.machines ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE UNIQUE INDEX IF NOT EXISTS machines_org_code_case_idx ON sentinel.machines(organization_id,lower(code));
CREATE TABLE IF NOT EXISTS sentinel.machine_admin_events (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 machine_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision > 0),
 request_payload jsonb NOT NULL,
 before_data jsonb,
 after_data jsonb NOT NULL,
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(machine_id,revision),
 FOREIGN KEY(organization_id,machine_id) REFERENCES sentinel.machines(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES sentinel.accounts(organization_id,id)
);
CREATE INDEX IF NOT EXISTS machine_admin_history_idx ON sentinel.machine_admin_events(organization_id,machine_id,revision DESC);
ALTER TABLE sentinel.machine_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.machine_admin_events FROM PUBLIC,anon,authenticated;
COMMIT;
