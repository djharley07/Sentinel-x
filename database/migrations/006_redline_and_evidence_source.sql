BEGIN;
ALTER TABLE sentinel.demo_evidence ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'online_demo' CHECK(source_kind IN ('online_demo','ai_generated_demo'));
UPDATE sentinel.demo_evidence SET source_kind='ai_generated_demo' WHERE source_url LIKE 'https://share.gemini.google/%';
CREATE TABLE IF NOT EXISTS sentinel.redline_events (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 review_id uuid NOT NULL,
 sequence_number integer NOT NULL CHECK(sequence_number>0),
 status text NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,review_id) REFERENCES sentinel.extraction_reviews(organization_id,id),
 UNIQUE(review_id,sequence_number)
);
ALTER TABLE sentinel.redline_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.redline_events FROM PUBLIC,anon,authenticated;
COMMIT;
