BEGIN;

CREATE SCHEMA sentinel;

-- These tables are accessed through our Python backend.
REVOKE ALL ON SCHEMA sentinel FROM PUBLIC, anon, authenticated;

CREATE TABLE sentinel.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    is_demo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sentinel.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL
        REFERENCES sentinel.organizations(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE TABLE sentinel.transcription_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    report_id uuid NOT NULL,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    original_transcript text NOT NULL
        CHECK (length(trim(original_transcript)) > 0),
    model text NOT NULL,
    detected_language_code text,
    provider_request_id text,
    audio_storage_key text NOT NULL
        CHECK (length(trim(audio_storage_key)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (organization_id, report_id)
        REFERENCES sentinel.reports(organization_id, id),

    UNIQUE (organization_id, id),
    UNIQUE (report_id, attempt_number)
);

CREATE TABLE sentinel.transcription_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    attempt_id uuid NOT NULL UNIQUE,
    decision text NOT NULL CHECK (
        decision IN ('accepted', 'corrected', 'rerecord_requested')
    ),
    corrected_transcript text,
    reviewer_user_id uuid REFERENCES auth.users(id),
    review_source text NOT NULL CHECK (
        review_source IN ('local_demo', 'authenticated_user')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (organization_id, attempt_id)
        REFERENCES sentinel.transcription_attempts(organization_id, id),

    CHECK (
        (
            decision = 'corrected'
            AND corrected_transcript IS NOT NULL
            AND length(trim(corrected_transcript)) > 0
        )
        OR
        (
            decision IN ('accepted', 'rerecord_requested')
            AND corrected_transcript IS NULL
        )
    ),

    CHECK (
        (review_source = 'local_demo' AND reviewer_user_id IS NULL)
        OR
        (review_source = 'authenticated_user' AND reviewer_user_id IS NOT NULL)
    )
);

CREATE INDEX reports_organization_created_idx
    ON sentinel.reports (organization_id, created_at DESC);

CREATE INDEX attempts_report_created_idx
    ON sentinel.transcription_attempts (report_id, created_at DESC);

-- Additional protection against direct Data API access.
ALTER TABLE sentinel.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.transcription_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel.transcription_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA sentinel
    FROM PUBLIC, anon, authenticated;

INSERT INTO sentinel.organizations (name, is_demo)
VALUES ('Sentinel Demo Factory', true);

COMMIT;