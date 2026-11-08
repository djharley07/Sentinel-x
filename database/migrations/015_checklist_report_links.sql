BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.checklist_report_links (
    submission_id uuid PRIMARY KEY REFERENCES sentinel.checklist_submissions(id),
    organization_id uuid NOT NULL,
    report_id uuid NOT NULL UNIQUE,
    linked_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (organization_id, report_id) REFERENCES sentinel.reports(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE sentinel.checklist_report_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.checklist_report_links FROM PUBLIC, anon, authenticated;
COMMIT;
