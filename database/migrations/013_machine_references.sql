BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.machine_reference_documents (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 machine_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 title text NOT NULL,
 document_version text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('fictional_reference','owner_reference')),
 manufacturer text NOT NULL,
 model text NOT NULL,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 8000),
 content_sha256 text NOT NULL,
 create_payload jsonb NOT NULL,
 available boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,machine_id) REFERENCES sentinel.machines(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES sentinel.accounts(organization_id,id)
);
CREATE TABLE IF NOT EXISTS sentinel.machine_reference_events (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 document_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 revision integer NOT NULL,
 available boolean NOT NULL,
 reason text NOT NULL,
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,revision),
 FOREIGN KEY(organization_id,document_id) REFERENCES sentinel.machine_reference_documents(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES sentinel.accounts(organization_id,id)
);
CREATE INDEX IF NOT EXISTS machine_reference_scope_idx ON sentinel.machine_reference_documents(organization_id,machine_id,available);
ALTER TABLE sentinel.machine_reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.machine_reference_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.machine_reference_documents,sentinel.machine_reference_events FROM PUBLIC,anon,authenticated;
COMMIT;
