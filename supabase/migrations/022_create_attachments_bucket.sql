-- FR-06: 添付画像用の非公開 Storage バケット。
-- 保存/取得は Service Role（サーバー）経由のみ（RLS をバイパス）。公開はしない。
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;
