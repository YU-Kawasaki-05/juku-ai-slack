CREATE TABLE slack_messages (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_team_id    VARCHAR(50) NOT NULL,
  slack_channel_id VARCHAR(50) NOT NULL,
  thread_ts        VARCHAR(50) NOT NULL,
  message_ts       VARCHAR(50) NOT NULL,
  slack_user_id    VARCHAR(50),
  person_id        UUID        REFERENCES persons(id),
  role             VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  text             TEXT,
  has_attachments  BOOLEAN     NOT NULL DEFAULT false,
  raw_event        JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_slack_messages_thread    ON slack_messages (slack_channel_id, thread_ts);
CREATE INDEX idx_slack_messages_person_id ON slack_messages (person_id);
