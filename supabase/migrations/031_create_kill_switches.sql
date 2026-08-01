-- F-1 / DEC-15: 緊急停止スイッチ（kill_switch）。
--
-- 目的:
--   AI 応答の暴走（コスト超過・不適切応答・プロバイダ障害）を、デプロイなしで即座に止める手段。
--   これまで停止手段は「環境変数を消して再デプロイ」しかなく、数分の空白が生まれていた。
--
-- 設計:
--   - 1 行 1 スイッチ。name が主キー（初期行は 'ai_responses' のみ）。
--     運用設計 3.2 のスケッチは `service` 列だったが、対象は「サービス」ではなく
--     「アプリ内の機能」なので name とする（将来 'embedding' 等を足せる）。
--   - disabled_at は持たない。停止・再開のどちらでも updated_at / updated_by を更新するため、
--     停止時刻専用の列を別に持つと二重管理になる（停止中かは enabled で判別できる）。
--   - 読み取りは isAIEnabled() が「行が無い / 読めない」場合に enabled=true へフォールバックする。
--     kill_switch 自体の障害で全生徒の質問が止まる方が事故として重いため（fail-open）。
--     したがって本テーブルの行が消えても Bot は動き続ける。
--
-- RLS:
--   書き込みは Service Role のみ（管理画面の Server Action は requireAdmin を通してから
--   Service Role クライアントで書く）。authenticated には 026 と同じ staff/admin の SELECT だけ許す。

CREATE TABLE IF NOT EXISTS kill_switches (
  name       TEXT        NOT NULL PRIMARY KEY,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  reason     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

COMMENT ON TABLE kill_switches IS
  'DEC-15: 機能単位の緊急停止スイッチ。enabled=false の間は該当機能を実行しない';
COMMENT ON COLUMN kill_switches.reason IS '停止／再開の理由（管理画面で入力し #alerts 通知に載せる）';
COMMENT ON COLUMN kill_switches.updated_by IS '操作者（管理画面ログインユーザーのメールアドレス）';

-- 初期行。ON CONFLICT で再実行しても既存の状態（停止中かもしれない）を壊さない
INSERT INTO kill_switches (name, enabled, reason)
VALUES ('ai_responses', true, NULL)
ON CONFLICT (name) DO NOTHING;

-- updated_at は setAIEnabled が明示的に渡すが、Studio からの直接更新でも進むようにする
CREATE TRIGGER trg_kill_switches_updated_at
  BEFORE UPDATE ON kill_switches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE kill_switches ENABLE ROW LEVEL SECURITY;

-- 026 と同じ方針: 書き込みは Service Role のみ、authenticated は staff/admin の参照のみ
CREATE POLICY "staff_admin_select" ON kill_switches
  FOR SELECT TO authenticated USING (public.is_staff_or_admin());
