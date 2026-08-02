-- A-1（後半）/ A-14: 滞留ジョブのスイープと保持期間掃除に効くインデックス。
--
-- 背景:
--   013 の jobs には (status, scheduled_at) WHERE status='pending' と (created_at) しかなく、
--   スイーパ・一覧・掃除が使うアクセスパターンを覆えていない。
--     - 回収(a): status='processing' AND started_at < cutoff
--     - 回収(b): status='pending'    AND created_at < cutoff
--     - 一覧  : status IN (...) ORDER BY created_at DESC
--     - 集計  : status=? ORDER BY created_at|started_at ASC LIMIT 1（+ exact count）
--     - 掃除  : status IN ('completed','skipped','failed') AND created_at < cutoff
--   いずれも「status + 時刻」の複合なので、seq scan にならないよう明示的に張る。
--
-- スケジューリング方針:
--   DEC-13 のとおり定期実行は使わない（Vercel Cron も pg_cron も入れない）。
--   スイープ・掃除はアプリ側（/admin/jobs の表示時 + 手動ボタン）から呼ぶ。
--   将来 pg_cron が使える契約になったら、sweepStaleJobs / cleanupOldRows と同じ条件の
--   DELETE / UPDATE をジョブ化して移行できる（ここに新しい列は必要ない）。
--
-- slack_event_receipts は 012 の idx_event_receipts_received_at が
-- 掃除条件（received_at < cutoff）にそのまま効くため追加しない。

-- 一覧・集計・pending の回収・掃除（status で絞ってから時刻で範囲/整列）
CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
  ON jobs (status, created_at DESC);

-- processing の回収と「処理中の最古」集計。processing 行は常に少ないので部分インデックスで足りる
CREATE INDEX IF NOT EXISTS idx_jobs_processing_started_at
  ON jobs (started_at)
  WHERE status = 'processing';

COMMENT ON INDEX idx_jobs_status_created_at IS
  'A-1/A-14: ジョブ一覧・キュー集計・保持期間掃除（status + created_at）用';
COMMENT ON INDEX idx_jobs_processing_started_at IS
  'A-1: processing のまま滞留したジョブの回収（started_at 超過判定）用';
