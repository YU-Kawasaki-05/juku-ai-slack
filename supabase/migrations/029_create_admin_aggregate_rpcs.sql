-- H-3 / E-4: 管理画面の集計を DB 側へ寄せる。
--
-- 背景（実測された2つの破綻）:
--   (1) 会話ログ一覧は「セッションを最大 500 件取得 → その thread_ts を PostgREST の
--       .in() に 500 個並べる」構造だったため、スレッドが 300-400 件を超えると
--       クエリ URL が長大化し HTTP 414 で一覧そのものが 500 になる。
--   (2) 利用状況・ダッシュボードの合計は PostgREST 既定の 1000 行上限に当たると
--       黙って過少表示になる（エラーにならないので誰も気づけない）。
--
-- 対処: COUNT/SUM/GROUP BY と LATERAL 集計を SQL 側で行い、アプリには集計済みの
--   小さな結果だけを返す。行数上限にも URL 長にも依存しなくなる。
--
-- セキュリティ: 021（match_report_chunks hardening）と同じパターン。
--   SECURITY DEFINER + search_path 固定 + anon/authenticated から EXECUTE を剥奪し、
--   Service Role（サーバー専用クライアント）だけが実行できるようにする。
--   これらの関数は生徒 PII（氏名・会話メタ）を返すため、RLS 緩和状態でも
--   REST 経由で叩かれないことが前提。

-- ---------------------------------------------------------------------------
-- (a) 会話ログ一覧（SCR-13 / FR-19）
--     セッション一覧 + スレッドごとの メッセージ数 / 画像有無 / モデル / エラー有無 を
--     LATERAL で1発集計し、絞り込みとページングまで SQL 側で行う。
--     total_count はフィルタ適用後・LIMIT 前の総件数（ウィンドウ関数）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_thread_list(
  p_person_id UUID        DEFAULT NULL,
  p_from      TIMESTAMPTZ DEFAULT NULL,
  p_has_image BOOLEAN     DEFAULT NULL,
  p_has_error BOOLEAN     DEFAULT NULL,
  p_model     TEXT        DEFAULT NULL,
  p_limit     INTEGER     DEFAULT 100,
  p_offset    INTEGER     DEFAULT 0
)
RETURNS TABLE (
  id                    UUID,
  slack_team_id         TEXT,
  slack_channel_id      TEXT,
  root_message_ts       TEXT,
  thread_ts             TEXT,
  person_id             UUID,
  report_id             UUID,
  status                TEXT,
  thread_summary        TEXT,
  summary_message_count INTEGER,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ,
  last_message_at       TIMESTAMPTZ,
  person_name           TEXT,
  channel_name          TEXT,
  message_count         INTEGER,
  has_image             BOOLEAN,
  has_error             BOOLEAN,
  models                TEXT[],
  total_count           BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH enriched AS (
    SELECT
      s.id,
      s.slack_team_id::TEXT         AS slack_team_id,
      s.slack_channel_id::TEXT      AS slack_channel_id,
      s.root_message_ts::TEXT       AS root_message_ts,
      s.thread_ts::TEXT             AS thread_ts,
      s.person_id,
      s.report_id,
      s.status::TEXT                AS status,
      s.thread_summary,
      s.summary_message_count,
      s.created_at,
      s.updated_at,
      s.last_message_at,
      p.name::TEXT                  AS person_name,
      cb.slack_channel_name::TEXT   AS channel_name,
      COALESCE(msg.message_count, 0)::INTEGER AS message_count,
      COALESCE(msg.has_image, false)          AS has_image,
      (err.found IS NOT NULL)                 AS has_error,
      COALESCE(usg.models, ARRAY[]::TEXT[])   AS models
    FROM slack_thread_sessions s
    LEFT JOIN persons p ON p.id = s.person_id
    LEFT JOIN slack_channel_bindings cb ON cb.slack_channel_id = s.slack_channel_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS message_count, bool_or(m.has_attachments) AS has_image
      FROM slack_messages m
      WHERE m.slack_channel_id = s.slack_channel_id
        AND m.thread_ts = s.thread_ts
    ) msg ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT u.model::TEXT ORDER BY u.model::TEXT) AS models
      FROM ai_usage_logs u
      WHERE u.slack_channel_id = s.slack_channel_id
        AND u.thread_ts = s.thread_ts
    ) usg ON TRUE
    LEFT JOIN LATERAL (
      SELECT 1 AS found
      FROM ai_error_logs e
      WHERE e.slack_channel_id = s.slack_channel_id
        AND e.thread_ts = s.thread_ts
      LIMIT 1
    ) err ON TRUE
    WHERE (p_person_id IS NULL OR s.person_id = p_person_id)
      AND (p_from IS NULL OR s.last_message_at >= p_from)
  ),
  filtered AS (
    SELECT * FROM enriched e
    WHERE (p_has_image IS NOT TRUE OR e.has_image)
      AND (p_has_error IS NOT TRUE OR e.has_error)
      AND (p_model IS NULL OR p_model = ANY(e.models))
  )
  SELECT
    f.id,
    f.slack_team_id,
    f.slack_channel_id,
    f.root_message_ts,
    f.thread_ts,
    f.person_id,
    f.report_id,
    f.status,
    f.thread_summary,
    f.summary_message_count,
    f.created_at,
    f.updated_at,
    f.last_message_at,
    f.person_name,
    f.channel_name,
    f.message_count,
    f.has_image,
    f.has_error,
    f.models,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  -- created_at 単独ソートのタイブレーカ欠如（A-13 と同種）を避けるため id を第2キーにする
  ORDER BY f.last_message_at DESC NULLS LAST, f.id DESC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

-- 会話ログのモデル絞り込み選択肢。従来は ai_usage_logs を全行取得して JS で distinct
-- していたため、1000 行を超えると選択肢が黙って欠落した。
CREATE OR REPLACE FUNCTION admin_used_models()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(m ORDER BY m), ARRAY[]::TEXT[])
  FROM (SELECT DISTINCT model::TEXT AS m FROM ai_usage_logs WHERE model IS NOT NULL) t;
$$;

-- ---------------------------------------------------------------------------
-- (b-1) ダッシュボードのサマリー（SCR-02 / FR-18）
--       今日（JST）の質問数と今月（JST）の推定コスト合計。境界は呼び出し側が
--       UTC ISO で渡す（既存の jstDayStartIso / jstMonthStartIso と同じ契約）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_usage_summary(
  p_day_start   TIMESTAMPTZ,
  p_month_start TIMESTAMPTZ
)
RETURNS TABLE (
  today_question_count BIGINT,
  month_cost_usd       DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM ai_usage_logs WHERE created_at >= p_day_start),
    (SELECT COALESCE(SUM(estimated_cost), 0)::DOUBLE PRECISION
       FROM ai_usage_logs WHERE created_at >= p_month_start);
$$;

-- ---------------------------------------------------------------------------
-- (b-2) 利用状況ダッシュボード（SCR-10 / FR-18）
--       期間合計 + 日別 / モデル別 / 生徒別 / エラーコード別を1回で返す。
--       「日」は JST 暦日（AT TIME ZONE 'Asia/Tokyo' で切る）。
--       生徒別のキーは person_id（G-7: 同姓同名の合算を防ぐ）。表示名は別フィールド。
--       並べ替え・上位N件の絞り込み・0埋めはアプリ側の純関数で行う（テスト容易性のため）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_usage_analytics(p_from TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'question_count', COUNT(*),
        'cost_usd',       COALESCE(SUM(estimated_cost), 0)::DOUBLE PRECISION,
        'input_tokens',   COALESCE(SUM(input_tokens), 0),
        'output_tokens',  COALESCE(SUM(output_tokens), 0),
        'total_tokens',   COALESCE(SUM(total_tokens), 0),
        'image_count',    COUNT(*) FILTER (WHERE has_image)
      )
      FROM ai_usage_logs WHERE created_at >= p_from
    ),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',     to_char(t.day, 'YYYY-MM-DD'),
        'count',    t.cnt,
        'cost_usd', t.cost,
        'tokens',   t.tokens
      ))
      FROM (
        SELECT
          (created_at AT TIME ZONE 'Asia/Tokyo')::date        AS day,
          COUNT(*)                                            AS cnt,
          COALESCE(SUM(estimated_cost), 0)::DOUBLE PRECISION  AS cost,
          COALESCE(SUM(total_tokens), 0)                      AS tokens
        FROM ai_usage_logs
        WHERE created_at >= p_from
        GROUP BY 1
      ) t
    ), '[]'::jsonb),
    'by_model', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'model', t.model, 'count', t.cnt, 'cost_usd', t.cost
      ))
      FROM (
        SELECT
          model::TEXT                                         AS model,
          COUNT(*)                                            AS cnt,
          COALESCE(SUM(estimated_cost), 0)::DOUBLE PRECISION  AS cost
        FROM ai_usage_logs
        WHERE created_at >= p_from
        GROUP BY 1
      ) t
    ), '[]'::jsonb),
    'by_person', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'person_id', t.person_id, 'name', t.name, 'count', t.cnt
      ))
      FROM (
        SELECT
          u.person_id            AS person_id,
          MAX(p.name)::TEXT      AS name,
          COUNT(*)               AS cnt
        FROM ai_usage_logs u
        LEFT JOIN persons p ON p.id = u.person_id
        WHERE u.created_at >= p_from
        GROUP BY u.person_id
      ) t
    ), '[]'::jsonb),
    'errors_by_code', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', t.code, 'count', t.cnt))
      FROM (
        SELECT error_code::TEXT AS code, COUNT(*) AS cnt
        FROM ai_error_logs
        WHERE created_at >= p_from
        GROUP BY 1
      ) t
    ), '[]'::jsonb)
  );
$$;

-- 実行権限: Service Role のみ（021 と同じ多層防御）
REVOKE EXECUTE ON FUNCTION admin_thread_list(UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_thread_list(UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_thread_list(UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION admin_used_models() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_used_models() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_used_models() TO service_role;

REVOKE EXECUTE ON FUNCTION admin_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION admin_usage_analytics(TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_usage_analytics(TIMESTAMPTZ) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_usage_analytics(TIMESTAMPTZ) TO service_role;

-- 一覧の絞り込み・集計に効くインデックス（既存の idx_slack_messages_thread は複合で流用）
CREATE INDEX IF NOT EXISTS idx_thread_sessions_last_message_at
  ON slack_thread_sessions (last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_thread
  ON ai_usage_logs (slack_channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_error_logs_thread
  ON ai_error_logs (slack_channel_id, thread_ts);
