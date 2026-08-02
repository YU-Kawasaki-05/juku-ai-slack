-- report_chunks の再生成を「1トランザクション + 直列化」にする。
--
-- 背景（バグ台帳 B-5 / B-6）:
--   1. rebuildReportEmbeddings は DELETE → INSERT → reports UPDATE を別々の HTTP 往復で実行していた。
--      DEC-14 の自動再生成と管理画面の手動ボタンが並行すると v1/v2 のチャンクが混在し、
--      途中で失敗すると「チャンク 0 件のまま」になる。
--   2. UNIQUE 制約が無いため、重複した chunk_index が黙って共存できてしまう。
--   3. ivfflat インデックスを空テーブルに lists=100 で作成していた（低リコール）。

-- --- 1. 重複チャンクの掃除（UNIQUE 追加の前提。過去の並行実行で発生しうる） ---
DELETE FROM report_chunks
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY report_id, chunk_index
             ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM report_chunks
  ) dup
  WHERE dup.rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_chunks_report_id_chunk_index_key'
  ) THEN
    ALTER TABLE report_chunks
      ADD CONSTRAINT report_chunks_report_id_chunk_index_key UNIQUE (report_id, chunk_index);
  END IF;
END $$;

-- --- 2. ivfflat インデックスを外す ---
-- 空テーブルに構築した ivfflat は probes=1 では大半のベクトルが探索対象外になり、
-- 再現率が黙って落ちる。数百件規模では seq scan のほうが十分速く、かつ常に正確。
-- データが数万件規模まで増えたら HNSW（ivfflat と違い事前学習不要）の導入を検討すること。
DROP INDEX IF EXISTS idx_report_chunks_embedding;

-- --- 3. 再生成 RPC ---
-- p_chunks: [{ "chunk_index": 0, "content": "...", "embedding": "[0.1,0.2,...]" }, ...]
-- person_id はクライアントを信用せず reports から引く（BR-10-03 の越境防止）。
CREATE OR REPLACE FUNCTION rebuild_report_chunks(
  p_report_id  UUID,
  p_chunks     JSONB,
  p_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
-- Supabase では pgvector が extensions スキーマに入っていることがあるため両方を通す。
-- pg_temp を最後に置き、一時テーブルによる名前解決の乗っ取りを防ぐ。
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_person_id UUID;
  v_count     INTEGER;
BEGIN
  -- 同一レポートの再生成を直列化する（自動再生成 × 手動ボタンの競合）。
  -- トランザクション終了で自動解放されるため明示的な unlock は不要。
  PERFORM pg_advisory_xact_lock(hashtext(p_report_id::text));

  SELECT person_id INTO v_person_id FROM reports WHERE id = p_report_id;
  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'rebuild_report_chunks: report % not found', p_report_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- embedding 欠損を無言で INSERT すると match_report_chunks の IS NOT NULL で
  -- 永久に検索対象外になる（成功扱いのまま）。ここで止める。
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_chunks, '[]'::jsonb)) AS c
    WHERE c->>'embedding' IS NULL
       OR c->>'content'   IS NULL
       OR c->>'chunk_index' IS NULL
  ) THEN
    RAISE EXCEPTION 'rebuild_report_chunks: chunk with NULL content/embedding/chunk_index'
      USING ERRCODE = 'not_null_violation';
  END IF;

  DELETE FROM report_chunks WHERE report_id = p_report_id;

  INSERT INTO report_chunks (report_id, person_id, chunk_index, content, embedding)
  SELECT
    p_report_id,
    v_person_id,
    (c->>'chunk_index')::INTEGER,
    c->>'content',
    (c->>'embedding')::vector
  FROM jsonb_array_elements(COALESCE(p_chunks, '[]'::jsonb)) AS c;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE reports
     SET embeddings_updated_at = COALESCE(p_updated_at, now())
   WHERE id = p_report_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION rebuild_report_chunks(UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rebuild_report_chunks(UUID, JSONB, TIMESTAMPTZ) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION rebuild_report_chunks(UUID, JSONB, TIMESTAMPTZ) TO service_role;
