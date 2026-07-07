-- 修正: service_role に public スキーマの一部テーブル権限が欠落していた（SQLSTATE 42501）。
-- 症状: 管理画面（Service Role 経由）から ai_error_logs への SELECT が
--       "permission denied for table ai_error_logs"（HTTP 403）で失敗。
--       ai_usage_logs など他テーブルにも同様の欠落がある可能性があるため一括で再適用する。
-- 原因: テーブル作成時に default privileges による自動 GRANT が付与されなかったため。
--       service_role は RLS はバイパスするが GRANT はバイパスしない。
-- 備考: アクセス制御は引き続き RLS（014/015）とアプリ層の requireStaff/requireAdmin が担う。
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
-- match_report_chunks 等の RPC 実行権限
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 今後 migration（postgres ロール）で作成されるオブジェクトにも自動付与する
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
