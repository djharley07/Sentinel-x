BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sentinel.organizations(id),
 username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('owner','worker','technician')),
 technician_id uuid, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(technician_id),
 FOREIGN KEY(organization_id,technician_id) REFERENCES sentinel.technicians(organization_id,id),
 CHECK((role='technician')=(technician_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sentinel.sessions (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES sentinel.accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sentinel.sessions(account_id);
CREATE TABLE IF NOT EXISTS sentinel.login_limits (
 key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0,
 window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sentinel.reports ADD COLUMN IF NOT EXISTS created_by_account_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='reports_account_owner_fk' AND conrelid='sentinel.reports'::regclass) THEN
 ALTER TABLE sentinel.reports ADD CONSTRAINT reports_account_owner_fk
 FOREIGN KEY(organization_id,created_by_account_id) REFERENCES sentinel.accounts(organization_id,id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS reports_account_idx ON sentinel.reports(organization_id,created_by_account_id,created_at DESC);
CREATE TABLE IF NOT EXISTS sentinel.account_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES sentinel.accounts(id),
 organization_id uuid NOT NULL REFERENCES sentinel.organizations(id),
 record_table text NOT NULL, record_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION sentinel.record_account_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
 actor := nullif(current_setting('sentinel.account_id',true),'')::uuid;
 IF actor IS NOT NULL THEN
 INSERT INTO sentinel.account_actions(account_id,organization_id,record_table,record_id)
 VALUES(actor,NEW.organization_id,TG_TABLE_NAME,NEW.id);
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['reports','transcription_reviews','report_extractions','extraction_reviews','machine_link_events','demo_evidence','redline_events','repair_events'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS account_action ON sentinel.%I',t);
 EXECUTE format('CREATE TRIGGER account_action AFTER INSERT ON sentinel.%I FOR EACH ROW EXECUTE FUNCTION sentinel.record_account_action()',t);
 END LOOP;
END $$;
ALTER TABLE sentinel.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.account_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.accounts,sentinel.sessions,sentinel.login_limits,sentinel.account_actions FROM PUBLIC,anon,authenticated;
COMMIT;
