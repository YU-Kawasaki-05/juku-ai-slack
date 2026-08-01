-- Fixer-A2b: コアジョブ処理の冪等化（A-2 / A-3 / A-4）
--
-- A-3: 生成（リトライ可）と配信（1回限り）の分離。
--   LLM 生成結果を jobs 行に保存し、リトライ時は再生成せず配信から再開する。
--   これにより「投稿後の失敗 → 再試行で二重返信 + 二重課金」を防ぐ。
-- A-4: slack_messages の upsert 化。
--   質問の保存を回答生成の前に移す（並行時の文脈欠落対策）ため、
--   リトライで同じ行を再挿入しても重複しないよう自然キーに UNIQUE を張る。
-- A-2: slack_event_receipts.status に 'failed' を追加。
--   after() 内の処理が失敗したイベントを可視化し、再処理対象として識別できるようにする。

-- --- A-3: 生成結果の保存先 ---
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS result_text TEXT;

COMMENT ON COLUMN jobs.result_text IS
  'LLM が生成した回答本文（Slack 投稿前に保存）。リトライ時はこれを再利用し再生成しない（A-3）';

-- --- A-4: (channel, thread, message, role) の重複排除 ---
-- 既存の重複行を最古の1行に寄せてから UNIQUE を張る（制約追加が失敗しないように）
DELETE FROM slack_messages a
  USING slack_messages b
 WHERE a.ctid > b.ctid
   AND a.slack_channel_id = b.slack_channel_id
   AND a.thread_ts        = b.thread_ts
   AND a.message_ts       = b.message_ts
   AND a.role             = b.role;

ALTER TABLE slack_messages
  ADD CONSTRAINT uq_slack_messages_natural_key
  UNIQUE (slack_channel_id, thread_ts, message_ts, role);

-- --- A-2: receipt の終了状態に 'failed' を追加 ---
-- 012 の CHECK は列定義に埋め込まれており名前が自動生成のため、
-- 名前決め打ちで DROP すると取りこぼして「古い CHECK が残ったまま新 CHECK を足す」事故になる。
-- status を参照する CHECK を実際に走査して落とす。
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'slack_event_receipts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE slack_event_receipts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE slack_event_receipts
  ADD CONSTRAINT slack_event_receipts_status_check
  CHECK (status IN ('received', 'processed', 'skipped', 'failed'));
