BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.checklist_versions (
    organization_id uuid NOT NULL,
    machine_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
    published_by uuid NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, machine_id, version),
    FOREIGN KEY (organization_id, machine_id) REFERENCES sentinel.machines(organization_id, id),
    FOREIGN KEY (organization_id, published_by) REFERENCES sentinel.accounts(organization_id, id)
);

CREATE TABLE IF NOT EXISTS sentinel.checklist_submissions (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    machine_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    worker_name text NOT NULL,
    machine_name text NOT NULL,
    machine_code text NOT NULL,
    version integer NOT NULL CHECK (version >= 0),
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
    answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
    note text NOT NULL CHECK (length(note) <= 500),
    needs_review boolean NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, machine_id) REFERENCES sentinel.machines(organization_id, id),
    FOREIGN KEY (organization_id, worker_id) REFERENCES sentinel.accounts(organization_id, id)
);

CREATE INDEX IF NOT EXISTS checklist_submissions_recent
ON sentinel.checklist_submissions(organization_id, submitted_at DESC, id DESC);
ALTER TABLE sentinel.checklist_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.checklist_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.checklist_versions, sentinel.checklist_submissions FROM PUBLIC, anon, authenticated;
COMMIT;
