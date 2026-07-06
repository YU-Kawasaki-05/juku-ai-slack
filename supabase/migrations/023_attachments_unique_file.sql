-- FR-06: ジョブ再試行時の attachments 二重挿入を防ぐ。
-- slack_file_id は Slack 上グローバル一意なので upsert のキーにできる。
ALTER TABLE attachments
  ADD CONSTRAINT uq_attachments_slack_file_id UNIQUE (slack_file_id);
