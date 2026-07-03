CREATE TABLE slack_event_receipts (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id     VARCHAR(100) NOT NULL,
  slack_team_id VARCHAR(50) NOT NULL,
  event_type   VARCHAR(50) NOT NULL,
  event_ts     VARCHAR(50),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status       VARCHAR(20) NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'processed', 'skipped')),

  CONSTRAINT uq_event_receipts_event_id UNIQUE (event_id)
);

CREATE UNIQUE INDEX idx_event_receipts_event_id   ON slack_event_receipts (event_id);
CREATE INDEX        idx_event_receipts_received_at ON slack_event_receipts (received_at);
