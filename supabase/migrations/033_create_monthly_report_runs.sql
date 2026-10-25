-- FR-08: 月次レポートの自動作成・メール送付の「月ごとの実行記録」。
--
-- 目的:
--   同じ月のレポートメールを二重に送らない。cron は毎月 1〜3 日に動き、管理画面のボタンからも
--   同じ処理を呼べるため、「その月のメールを送ったか」を DB に残して判定する。
--
-- 列:
--   report_month     対象月の月初日（reports.report_month と同じ形式）。主キー
--   generated_at     その月の対象生徒全員のレポートが揃った時刻（途中は NULL）
--   emailed_at       メール送信に成功した時刻。NULL でなければ二度と送らない
--   email_error      直近のメール送信失敗の理由（成功したら NULL に戻す）
--   email_claimed_at メール送信の「実行中」の目印。cron と手動ボタンが同時に動いても
--                    送信が 1 回になるよう、送る前に NULL → 現在時刻へ条件付き更新で取る。
--                    送信が失敗したら NULL に戻す。異常終了で残った場合は、
--                    アプリ側が一定時間（10 分）を過ぎたものを引き継ぐ
--
-- RLS:
--   書き込みは Service Role のみ（cron と管理画面の Server Action が Service Role で書く）。
--   authenticated には 026 と同じ staff/admin の SELECT だけ許す。anon は RLS の既定拒否。

CREATE TABLE IF NOT EXISTS monthly_report_runs (
  report_month     DATE        NOT NULL PRIMARY KEY,
  generated_at     TIMESTAMPTZ,
  emailed_at       TIMESTAMPTZ,
  email_error      TEXT,
  email_claimed_at TIMESTAMPTZ
);

COMMENT ON TABLE monthly_report_runs IS
  'FR-08: 月次レポートの月ごとの実行記録。emailed_at が入った月はメールを再送しない';

ALTER TABLE monthly_report_runs ENABLE ROW LEVEL SECURITY;

-- 再実行しても失敗しないよう、先に消してから作る
DROP POLICY IF EXISTS "staff_admin_select" ON monthly_report_runs;
CREATE POLICY "staff_admin_select" ON monthly_report_runs
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());
