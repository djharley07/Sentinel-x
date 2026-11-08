BEGIN;
CREATE TABLE IF NOT EXISTS sentinel.worker_machine_events (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL,
 worker_id uuid NOT NULL, machine_id uuid NOT NULL, actor_id uuid NOT NULL,
 sequence_number integer NOT NULL CHECK(sequence_number>0), active boolean NOT NULL,
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(worker_id,machine_id,sequence_number),
 FOREIGN KEY(organization_id,worker_id) REFERENCES sentinel.accounts(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES sentinel.accounts(organization_id,id),
 FOREIGN KEY(organization_id,machine_id) REFERENCES sentinel.machines(organization_id,id)
);
CREATE INDEX IF NOT EXISTS worker_machine_latest_idx ON sentinel.worker_machine_events(organization_id,worker_id,machine_id,sequence_number DESC);
ALTER TABLE sentinel.worker_machine_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel.worker_machine_events FROM PUBLIC,anon,authenticated;
COMMIT;
