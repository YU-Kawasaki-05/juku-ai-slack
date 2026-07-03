-- TBL-student_knowledge_states
-- 関連機能: FR-23 (BKT知識状態追跡)
-- DEC-20: 簡略化BKT (P(T)=0.15, P(G)=0.2, P(S)=0.1, P(L0)=0.2)

CREATE TABLE student_knowledge_states (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id            UUID         NOT NULL REFERENCES persons(id),
  topic                VARCHAR(100) NOT NULL,
  subject              VARCHAR(50)  NOT NULL,
  p_mastery            FLOAT8       NOT NULL DEFAULT 0.2
                         CHECK (p_mastery >= 0.0 AND p_mastery <= 1.0),
  attempt_count        INTEGER      NOT NULL DEFAULT 0,
  consecutive_correct  INTEGER      NOT NULL DEFAULT 0,
  last_seen_at         TIMESTAMPTZ,
  forgetting_applied_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_knowledge_states_person_topic UNIQUE (person_id, topic)
);

CREATE INDEX idx_knowledge_states_person_id    ON student_knowledge_states (person_id);
CREATE UNIQUE INDEX idx_knowledge_states_person_topic
  ON student_knowledge_states (person_id, topic);

-- RLS
ALTER TABLE student_knowledge_states ENABLE ROW LEVEL SECURITY;

-- Service Role は全操作可
CREATE POLICY "service_role_all" ON student_knowledge_states
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at 自動更新トリガー（016 のトリガー関数を流用）
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON student_knowledge_states
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
