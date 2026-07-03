CREATE TABLE ai_error_logs (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  error_code          VARCHAR(50) NOT NULL,
  severity            VARCHAR(20) NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  provider            VARCHAR(50),
  person_id           UUID        REFERENCES persons(id),
  slack_channel_id    VARCHAR(50),
  thread_ts           VARCHAR(50),
  message_ts          VARCHAR(50),
  user_facing_message TEXT,
  internal_message    TEXT,
  raw_error           JSONB,
  retryable           BOOLEAN     NOT NULL DEFAULT false,
  resolved            BOOLEAN     NOT NULL DEFAULT false,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_error_logs_created_at ON ai_error_logs (created_at DESC);
CREATE INDEX idx_error_logs_error_code ON ai_error_logs (error_code);
CREATE INDEX idx_error_logs_resolved   ON ai_error_logs (resolved);
CREATE INDEX idx_error_logs_person_id  ON ai_error_logs (person_id);
