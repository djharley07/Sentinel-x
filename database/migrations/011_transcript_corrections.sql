BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.transcript_corrections (
 request_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 source_attempt_id uuid NOT NULL,
 new_attempt_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_attempt_id<>new_attempt_id),
 UNIQUE(organization_id,new_attempt_id),
 FOREIGN KEY(organization_id,source_attempt_id) REFERENCES sentinel.transcription_attempts(organization_id,id),
 FOREIGN KEY(organization_id,new_attempt_id) REFERENCES sentinel.transcription_attempts(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES sentinel.accounts(organization_id,id)
);
ALTER TABLE sentinel.transcript_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.transcript_corrections FROM PUBLIC,anon,authenticated;
COMMIT;
