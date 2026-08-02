-- D-1: RLS の authenticated ポリシーを USING(true) から「staff/admin ロール限定の SELECT のみ」へ差し替える。
--
-- 問題（015_create_rls_policies.sql）:
--   authenticated 向けポリシーが全て USING(true) / WITH CHECK(true) だったため、
--   Supabase Auth にサインアップできた任意のユーザーが anon key + 自分の JWT だけで
--   PostgREST 経由で全生徒の PII を読み取り、persons / reports / slack_channel_bindings を
--   書き換えられた（channel_id は「誰の質問か」を決める信頼の基点 BR-07-01）。
--
-- 方針:
--   1. アプリ本体は必ず Service Role（RLS バイパス）で DB にアクセスする。
--      ブラウザ側の anon key クライアントは Supabase Auth の signIn/signOut にしか使っておらず、
--      テーブルへの直接アクセスは 1 件も無い（src/ 全体を確認済み）。
--      → authenticated からの INSERT/UPDATE/DELETE は不要なので全て剥奪する。
--   2. 運用時の目視確認（Supabase Studio / REST）のため SELECT だけは残すが、
--      app_metadata.role が 'staff' または 'admin' の場合に限る。
--      app_metadata は Service Role / Admin API でしか書けないため自己昇格できない
--      （user_metadata は本人が書き換えられるので判定に使わない。02_外部設計/03_権限設計 参照）。
--   3. anon 向けポリシーは 1 件も作らない = RLS のデフォルト拒否で全面遮断。
--
-- 運用上の必須手順（これをやらないと本 migration の効果が薄れる）:
--   Supabase Dashboard > Authentication > Sign In / Providers で
--   「Allow new users to sign up」を OFF にすること。
--   管理画面ユーザーは Admin API / Dashboard から個別に招待し、
--   app_metadata.role に 'staff' か 'admin' を必ず設定する。

-- role 判定ヘルパ。JWT の app_metadata.role のみを見る。
--   SECURITY DEFINER : auth スキーマへの EXECUTE 権限が呼び出しロールに無くても評価できるようにする。
--                      引数を取らず、参照するのはセッション自身の JWT クレームだけなので昇格経路にならない。
--   SET search_path='': 関数内の名前解決を固定する（検索パス経由の乗っ取り防止）。
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('staff', 'admin'),
    false
  )
$$;

COMMENT ON FUNCTION public.is_staff_or_admin() IS
  'RLS 用: JWT の app_metadata.role が staff/admin かを返す。user_metadata は自己書き換え可能なため参照しない';

-- ポリシー式は接続ロール権限で評価されるため、EXECUTE を明示付与する（既定の PUBLIC 付与に依存しない）
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, service_role;

-- --- 015 で作成した authenticated ポリシーを全て撤去 ---

DROP POLICY IF EXISTS "staff can read persons"            ON persons;
DROP POLICY IF EXISTS "staff can insert persons"          ON persons;
DROP POLICY IF EXISTS "staff can update persons"          ON persons;

DROP POLICY IF EXISTS "staff can read student_profiles"   ON student_profiles;
DROP POLICY IF EXISTS "staff can insert student_profiles" ON student_profiles;
DROP POLICY IF EXISTS "staff can update student_profiles" ON student_profiles;

DROP POLICY IF EXISTS "staff can read reports"            ON reports;
DROP POLICY IF EXISTS "staff can insert reports"          ON reports;
DROP POLICY IF EXISTS "staff can update reports"          ON reports;

DROP POLICY IF EXISTS "staff can read report_chunks"      ON report_chunks;

DROP POLICY IF EXISTS "staff can read channel_bindings"   ON slack_channel_bindings;
DROP POLICY IF EXISTS "staff can insert channel_bindings" ON slack_channel_bindings;
DROP POLICY IF EXISTS "staff can update channel_bindings" ON slack_channel_bindings;

DROP POLICY IF EXISTS "staff can read thread_sessions"    ON slack_thread_sessions;
DROP POLICY IF EXISTS "staff can read slack_messages"     ON slack_messages;
DROP POLICY IF EXISTS "staff can read attachments"        ON attachments;
DROP POLICY IF EXISTS "staff can read ai_usage_logs"      ON ai_usage_logs;

DROP POLICY IF EXISTS "staff can read ai_error_logs"      ON ai_error_logs;
DROP POLICY IF EXISTS "staff can update ai_error_logs"    ON ai_error_logs;

DROP POLICY IF EXISTS "staff can read event_receipts"     ON slack_event_receipts;

DROP POLICY IF EXISTS "staff can read jobs"               ON jobs;
DROP POLICY IF EXISTS "staff can update jobs"             ON jobs;

-- --- staff/admin の SELECT のみを再作成（書き込みは Service Role 専用）---

CREATE POLICY "staff_admin_select" ON persons
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON student_profiles
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON reports
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON report_chunks
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON slack_channel_bindings
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON slack_thread_sessions
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON slack_messages
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON attachments
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON ai_usage_logs
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON ai_error_logs
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON slack_event_receipts
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

CREATE POLICY "staff_admin_select" ON jobs
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());

-- 017/018/019（student_knowledge_states / student_episodic_memories / learning_concepts）は
-- 元から service_role ポリシーのみで authenticated には開いていない。RLS デフォルト拒否のまま据え置く。
