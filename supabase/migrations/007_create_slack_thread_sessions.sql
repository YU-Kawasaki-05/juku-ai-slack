CREATE TABLE slack_thread_sessions (
  id               UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_team_id    VARCHAR(50)  NOT NULL,
  slack_channel_id VARCHAR(50)  NOT NULL,
  root_message_ts  VARCHAR(50)  NOT NULL,
  thread_ts        VARCHAR(50)  NOT NULL,
  person_id        UUID         NOT NULL REFERENCES persons(id),
  report_id        UUID         REFERENCES reports(id) ON DELETE SET NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'closed')),
  thread_summary   TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ,

  CONSTRAINT uq_thread_sessions_channel_thread UNIQUE (slack_channel_id, thread_ts)
);

CREATE UNIQUE INDEX idx_thread_sessions_channel_thread
  ON slack_thread_sessions (slack_channel_id, thread_ts);
CREATE INDEX idx_thread_sessions_person_id ON slack_thread_sessions (person_id);
