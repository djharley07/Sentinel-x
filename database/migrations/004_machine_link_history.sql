BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS extraction_reviews_org_id_idx ON sentinel.extraction_reviews(organization_id,id);
CREATE TABLE IF NOT EXISTS sentinel.machine_link_events (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 review_id uuid NOT NULL,
 machine_id uuid,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 sequence_number integer NOT NULL CHECK(sequence_number > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,review_id) REFERENCES sentinel.extraction_reviews(organization_id,id),
 FOREIGN KEY(organization_id,machine_id) REFERENCES sentinel.machines(organization_id,id),
 UNIQUE(review_id,sequence_number)
);
ALTER TABLE sentinel.machine_link_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.machine_link_events FROM PUBLIC,anon,authenticated;
COMMIT;
