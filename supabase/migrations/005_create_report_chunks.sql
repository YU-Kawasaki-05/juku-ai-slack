CREATE TABLE report_chunks (
  id          UUID     NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id   UUID     NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  person_id   UUID     NOT NULL REFERENCES persons(id),
  chunk_index INTEGER  NOT NULL,
  content     TEXT     NOT NULL,
  embedding   vector(1536),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_chunks_person_id  ON report_chunks (person_id);
CREATE INDEX idx_report_chunks_report_id  ON report_chunks (report_id);
CREATE INDEX idx_report_chunks_embedding
  ON report_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
