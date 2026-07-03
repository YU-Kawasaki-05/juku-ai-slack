-- TBL-learning_concepts
-- 関連機能: FR-25 (FSRSスペース反復リマインダー) — Phase 2
-- DEC-22: ts-fsrs npm, レビュー単位=知識マイクロ概念

CREATE TABLE learning_concepts (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id            UUID         NOT NULL REFERENCES persons(id),
  concept              VARCHAR(200) NOT NULL,
  subject              VARCHAR(50),

  -- ts-fsrs が管理するフィールド
  due                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  stability            FLOAT8       NOT NULL DEFAULT 0.0,
  difficulty           FLOAT8       NOT NULL DEFAULT 5.0,
  elapsed_days         INTEGER      NOT NULL DEFAULT 0,
  scheduled_days       INTEGER      NOT NULL DEFAULT 0,
  reps                 INTEGER      NOT NULL DEFAULT 0,
  lapses               INTEGER      NOT NULL DEFAULT 0,
  -- 0:New 1:Learning 2:Review 3:Relearning
  state                INTEGER      NOT NULL DEFAULT 0 CHECK (state IN (0, 1, 2, 3)),
  last_review          TIMESTAMPTZ,

  -- 誤概念ソース（FR-23 EvaluationSchema.identified_misconception から生成）
  source_misconception TEXT,

  -- mastered 後のアーカイブ（論理削除相当）
  archived_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 本日 due の未アーカイブ概念を高速取得（日次リマインダー用）
CREATE INDEX idx_learning_concepts_due
  ON learning_concepts (person_id, due)
  WHERE archived_at IS NULL;

CREATE INDEX idx_learning_concepts_person_id
  ON learning_concepts (person_id);

-- RLS
ALTER TABLE learning_concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON learning_concepts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at 自動更新トリガー
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON learning_concepts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
