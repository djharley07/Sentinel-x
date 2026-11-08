BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.technicians (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES sentinel.organizations(id),
 code text NOT NULL,name text NOT NULL,UNIQUE(organization_id,code),UNIQUE(organization_id,id)
);
INSERT INTO sentinel.technicians(organization_id,code,name)
 SELECT o.id,t.code,t.name FROM sentinel.organizations o CROSS JOIN
 (VALUES ('TECH-A','Demo Technician A'),('TECH-B','Demo Technician B')) t(code,name)
 WHERE o.is_demo=true AND o.name='Sentinel Demo Factory' ON CONFLICT(organization_id,code) DO NOTHING;
CREATE TABLE IF NOT EXISTS sentinel.repair_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,review_id uuid NOT NULL,
 sequence_number integer NOT NULL CHECK(sequence_number>0),technician_id uuid NOT NULL,
 machine_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('assigned','in_progress','completed')),
 action_note text NOT NULL CHECK(length(trim(action_note)) BETWEEN 1 AND 4000),
 outcome text CHECK(outcome IN ('resolved','improved','unresolved','not_checked')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,review_id) REFERENCES sentinel.extraction_reviews(organization_id,id),
 FOREIGN KEY(organization_id,technician_id) REFERENCES sentinel.technicians(organization_id,id),
 FOREIGN KEY(organization_id,machine_id) REFERENCES sentinel.machines(organization_id,id),
 UNIQUE(review_id,sequence_number),CHECK((status='completed' AND outcome IS NOT NULL) OR (status<>'completed' AND outcome IS NULL))
);
ALTER TABLE sentinel.technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.repair_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.technicians,sentinel.repair_events FROM PUBLIC,anon,authenticated;
COMMIT;
