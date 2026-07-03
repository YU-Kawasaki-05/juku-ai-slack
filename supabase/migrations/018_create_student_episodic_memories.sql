-- TBL-student_episodic_memories
-- 関連機能: FR-24 (エピソード記憶)
-- DEC-21: Open Brain / Duolingo Lilyパターン
-- 前提: 004_enable_pgvector.sql で vector 拡張を有効化済み

CREATE TABLE student_episodic_memories (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id         UUID        NOT NULL REFERENCES persons(id),
  content           TEXT        NOT NULL,
  importance        INTEGER     NOT NULL CHECK (importance BETWEEN 1 AND 10),
  embedding         vector(1536),
  superseded_by     UUID        REFERENCES student_episodic_memories(id),
  source_thread_ts  VARCHAR(50),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 重要度7以上・有効な記憶を高速取得（ブートシーケンス用）
CREATE INDEX idx_episodic_memories_person_importance
  ON student_episodic_memories (person_id, importance)
  WHERE superseded_by IS NULL;

-- pgvector コサイン類似度検索（HNSW: メモリ効率 × 速度のバランス）
CREATE INDEX idx_episodic_memories_embedding
  ON student_episodic_memories
  USING hnsw (embedding vector_cosine_ops);

-- RLS
ALTER TABLE student_episodic_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON student_episodic_memories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
