-- FR-10 RAG: レポートチャンクのコサイン類似検索関数。
-- person_id でフィルタ（BR-10-03）、is_ai_reference=true のみ（BR-10-04）、
-- status は approved/sent のみ（draft/ai_draft を除外, BR-10-05）、
-- similarity >= 閾値（BR-10-06）、上位 top_k 件。
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
    AND rc.embedding IS NOT NULL
    AND r.is_ai_reference = true
    AND r.status IN ('approved', 'sent')
    AND (1 - (rc.embedding <=> p_query_embedding)) >= p_threshold
  ORDER BY rc.embedding <=> p_query_embedding ASC
  LIMIT p_top_k;
$$;
