CREATE TABLE slack_channel_bindings (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_team_id        VARCHAR(50)  NOT NULL,
  slack_channel_id     VARCHAR(50)  NOT NULL,
  slack_channel_name   VARCHAR(200),
  person_id            UUID         NOT NULL REFERENCES persons(id),
  person_name_snapshot VARCHAR(100),
  default_report_id    UUID         REFERENCES reports(id) ON DELETE SET NULL,
  status               VARCHAR(20)  NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'inactive')),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_channel_bindings_channel_id UNIQUE (slack_channel_id)
);

CREATE UNIQUE INDEX idx_channel_bindings_channel_id ON slack_channel_bindings (slack_channel_id);
CREATE INDEX idx_channel_bindings_person_id         ON slack_channel_bindings (person_id);
CREATE INDEX idx_channel_bindings_status            ON slack_channel_bindings (status);
