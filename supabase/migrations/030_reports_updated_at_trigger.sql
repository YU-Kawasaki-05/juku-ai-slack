-- reports.updated_at のトリガを条件付きにする。
--
-- 背景（バグ台帳 H-1 / E-10）:
--   embedding 再生成は `UPDATE reports SET embeddings_updated_at = ...` を実行するが、
--   016 の set_updated_at() が無条件に updated_at = now() へ進めてしまう。
--   その結果 updated_at > embeddings_updated_at が必ず成立し、
--   詳細ページの「Embedding 再生成が必要です」警告が何度押しても消えない
--   （押すたびに埋め込み課金だけ発生する）。
--
-- 対処: reports 専用のトリガ関数を用意し、
--   「embeddings_updated_at 以外に変化が無い UPDATE」では updated_at を進めない。
--   他テーブルは 016 の set_updated_at() のまま（挙動を変えない）。
CREATE OR REPLACE FUNCTION set_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- updated_at / embeddings_updated_at を除いた全カラムを比較する。
  -- jsonb 比較なので NULL 同士も正しく等価判定される。
  IF (to_jsonb(NEW) - 'updated_at' - 'embeddings_updated_at')
     = (to_jsonb(OLD) - 'updated_at' - 'embeddings_updated_at') THEN
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_reports_updated_at();
