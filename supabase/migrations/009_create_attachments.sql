CREATE TABLE attachments (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_file_id    VARCHAR(50) NOT NULL,
  slack_channel_id VARCHAR(50) NOT NULL,
  thread_ts        VARCHAR(50) NOT NULL,
  message_ts       VARCHAR(50) NOT NULL,
  person_id        UUID        REFERENCES persons(id),
  file_type        VARCHAR(20) NOT NULL CHECK (file_type IN ('jpg', 'jpeg', 'png', 'webp')),
  mime_type        VARCHAR(100),
  original_name    VARCHAR(255),
  storage_path     VARCHAR(500),
  file_size        INTEGER,
  width            INTEGER,
  height           INTEGER,
  ocr_text         TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'stored'
                     CHECK (status IN ('storing', 'stored', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_thread ON attachments (slack_channel_id, thread_ts);
