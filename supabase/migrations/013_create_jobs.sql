CREATE TABLE jobs (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type     VARCHAR(50) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payload      JSONB       NOT NULL,
  attempt_count INTEGER    NOT NULL DEFAULT 0,
  max_attempts  INTEGER    NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  error_code   VARCHAR(50),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_status_scheduled
  ON jobs (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_jobs_created_at ON jobs (created_at);
