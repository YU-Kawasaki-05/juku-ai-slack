-- 受入テスト・ローカル開発用のシードデータ
-- 本番では実行しない。`supabase db reset`（ローカル）時に投入される。
--
-- 実機で Slack メンションを試す場合は、下の <REPLACE_...> を
-- 実際の Slack ワークスペース/チャンネルの値に置き換えてから投入すること。
-- channel_id が信頼の基点（FR-07 BR-07-01）。channel_name は表示用。

-- サンプル生徒
INSERT INTO persons (id, name, display_name, grade, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'テスト太郎', 'たろう', '中2', 'active')
ON CONFLICT (id) DO NOTHING;

-- サンプルのチャンネル紐付け（実チャンネルIDに差し替えて使う）
INSERT INTO slack_channel_bindings (
  slack_team_id, slack_channel_id, slack_channel_name, person_id, status
)
VALUES (
  '<REPLACE_TEAM_ID>',        -- 例: T0XXXXXXX
  '<REPLACE_CHANNEL_ID>',     -- 例: C0XXXXXXX（生徒専用チャンネル）
  'test-taro',
  '00000000-0000-0000-0000-000000000001',
  'active'
)
ON CONFLICT (slack_channel_id) DO NOTHING;
