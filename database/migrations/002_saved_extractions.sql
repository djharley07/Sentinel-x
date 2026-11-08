BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.report_extractions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    attempt_id uuid NOT NULL UNIQUE,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, attempt_id)
        REFERENCES sentinel.transcription_attempts(organization_id, id)
);
ALTER TABLE sentinel.report_extractions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.report_extractions FROM PUBLIC, anon, authenticated;
COMMIT;
