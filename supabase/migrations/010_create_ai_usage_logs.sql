CREATE TABLE ai_usage_logs (
  id               UUID           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id        UUID           NOT NULL REFERENCES persons(id),
  slack_channel_id VARCHAR(50)    NOT NULL,
  thread_ts        VARCHAR(50)    NOT NULL,
  message_ts       VARCHAR(50)    NOT NULL,
  model            VARCHAR(100)   NOT NULL,
  input_tokens     INTEGER        NOT NULL DEFAULT 0,
  output_tokens    INTEGER        NOT NULL DEFAULT 0,
  total_tokens     INTEGER        NOT NULL DEFAULT 0,
  estimated_cost   NUMERIC(12, 8) NOT NULL DEFAULT 0,
  has_image        BOOLEAN        NOT NULL DEFAULT false,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_logs_person_id  ON ai_usage_logs (person_id);
CREATE INDEX idx_usage_logs_created_at ON ai_usage_logs (created_at);
CREATE INDEX idx_usage_logs_model      ON ai_usage_logs (model);
