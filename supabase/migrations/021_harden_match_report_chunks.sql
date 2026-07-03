-- 多層防御: match_report_chunks を再定義し、
--  (1) reports.person_id も照合して越境を SQL レベルで強制（rc.person_id との不変条件の二重化）
--  (2) anon/authenticated からの EXECUTE を剥奪（Service Role のみ実行）
CREATE OR REPLACE FUNCTION match_report_chunks(
  p_person_id       UUID,
  p_query_embedding vector(1536),
  p_top_k           INTEGER DEFAULT 5,
  p_threshold       FLOAT8  DEFAULT 0.7
)
RETURNS TABLE (
  id         UUID,
  report_id  UUID,
  content    TEXT,
  similarity FLOAT8
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rc.id,
    rc.report_id,
    rc.content,
    1 - (rc.embedding <=> p_query_embedding) AS similarity
  FROM report_chunks rc
  JOIN reports r ON r.id = rc.report_id
  WHERE rc.person_id = p_person_id
    AND r.person_id = p_person_id
    AND rc.embedding IS NOT NULL
    AND r.is_ai_reference = true
    AND r.status IN ('approved', 'sent')
    AND (1 - (rc.embedding <=> p_query_embedding)) >= p_threshold
  ORDER BY rc.embedding <=> p_query_embedding ASC
  LIMIT p_top_k;
$$;

REVOKE EXECUTE ON FUNCTION match_report_chunks(UUID, vector, INTEGER, FLOAT8) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION match_report_chunks(UUID, vector, INTEGER, FLOAT8) FROM anon, authenticated;
