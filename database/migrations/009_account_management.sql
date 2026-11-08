BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.account_admin_events (
 request_id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES sentinel.organizations(id),
 actor_id uuid NOT NULL, target_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','password_reset','enabled','disabled')),
 request_data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,actor_id) REFERENCES sentinel.accounts(organization_id,id),
 FOREIGN KEY(organization_id,target_id) REFERENCES sentinel.accounts(organization_id,id)
);
CREATE INDEX IF NOT EXISTS account_admin_events_org_idx ON sentinel.account_admin_events(organization_id,created_at DESC);
ALTER TABLE sentinel.account_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.account_admin_events FROM PUBLIC,anon,authenticated;
COMMIT;
