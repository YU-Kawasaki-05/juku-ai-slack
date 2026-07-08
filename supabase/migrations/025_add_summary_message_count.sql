-- FR-20: スレッド長期要約のカバレッジ状態を永続化する。
-- summary_message_count = thread_summary に既に畳み込んだ「古い方から数えたメッセージ件数」。
-- これにより「要約済み接頭辞 + 未要約のしっぽ」を欠落なく再構成でき（穴が空かない）、
-- トリガー判定を「総数 − summary_message_count ≥ 閾値」の単調条件にできる（件数のパリティずれに強い）。
ALTER TABLE slack_thread_sessions
  ADD COLUMN IF NOT EXISTS summary_message_count INTEGER NOT NULL DEFAULT 0;
