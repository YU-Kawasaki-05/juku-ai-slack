CREATE TABLE reports (
  id                    UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id             UUID         NOT NULL REFERENCES persons(id),
  title                 VARCHAR(200) NOT NULL,
  report_month          DATE         NOT NULL,
  body_markdown         TEXT,
  status                VARCHAR(20)  NOT NULL DEFAULT 'ai_draft'
                          CHECK (status IN ('ai_draft', 'draft', 'approved', 'sent')),
  is_ai_reference       BOOLEAN      NOT NULL DEFAULT true,
  generated_by_ai       BOOLEAN      NOT NULL DEFAULT false,
  slack_message_ts      VARCHAR(50),
  embeddings_updated_at TIMESTAMPTZ,
  error_message         TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_reports_person_month UNIQUE (person_id, report_month)
);

CREATE INDEX idx_reports_person_id    ON reports (person_id);
CREATE INDEX idx_reports_status       ON reports (status);
