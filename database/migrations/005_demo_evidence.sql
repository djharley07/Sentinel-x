BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.demo_evidence (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 review_id uuid NOT NULL,
 source_url text NOT NULL,
 claim_checked text NOT NULL CHECK(length(trim(claim_checked)) BETWEEN 1 AND 2000),
 observation text NOT NULL CHECK(length(trim(observation)) BETWEEN 1 AND 4000),
 assessment text NOT NULL CHECK(assessment IN ('supports','conflicts','cannot_verify')),
 review_source text NOT NULL DEFAULT 'local_demo' CHECK(review_source='local_demo'),
 request_hash text NOT NULL,
 image_bytes bytea NOT NULL CHECK(octet_length(image_bytes) <= 5242880),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,review_id) REFERENCES sentinel.extraction_reviews(organization_id,id)
);
CREATE INDEX IF NOT EXISTS demo_evidence_review_idx ON sentinel.demo_evidence(organization_id,review_id,created_at);
ALTER TABLE sentinel.demo_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.demo_evidence FROM PUBLIC,anon,authenticated;
COMMIT;
