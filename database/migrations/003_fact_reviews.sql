BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.machines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES sentinel.organizations(id),
 code text NOT NULL,
 name text NOT NULL,
 department text NOT NULL,
 UNIQUE (organization_id, code), UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS extractions_org_id_idx ON sentinel.report_extractions(organization_id,id);
CREATE TABLE IF NOT EXISTS sentinel.extraction_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 extraction_id uuid NOT NULL UNIQUE,
 machine_id uuid,
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts) = 'object'),
 review_source text NOT NULL DEFAULT 'local_demo' CHECK(review_source = 'local_demo'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,extraction_id) REFERENCES sentinel.report_extractions(organization_id,id),
 FOREIGN KEY(organization_id,machine_id) REFERENCES sentinel.machines(organization_id,id)
);
INSERT INTO sentinel.machines(organization_id,code,name,department)
SELECT o.id,m.code,m.name,m.department FROM sentinel.organizations o
CROSS JOIN (VALUES ('MOTOR-015','Motor 15','Production'),('PUMP-007','Pump 7','Utilities'),('COMP-003','Compressor 3','Utilities')) AS m(code,name,department)
WHERE o.is_demo = true AND o.name = 'Sentinel Demo Factory'
ON CONFLICT(organization_id,code) DO NOTHING;
ALTER TABLE sentinel.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.extraction_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.machines,sentinel.extraction_reviews FROM PUBLIC,anon,authenticated;
COMMIT;
