/** @file
 * 機能: Slack に投稿するテキストの特殊文字エスケープ（C-3）
 * 入力: 生テキスト（主に LLM 生成文）
 * 出力: Slack mrkdwn として安全なテキスト
 * 例外: なし
 * 依存: なし（純粋関数）
 * セキュリティ: LLM 出力に `<!channel>` `<!here>` `<@U…>` が現れると Slack が制御シーケンスとして
 *   解釈し、生徒の誘導で Bot にチャンネル全員通知を撒かせられる。投稿前に必ず通す。
 * @implements FR-05, C-3
 */

/**
 * Slack が要求する 3 文字のエスケープ。
 * `&` を最初に置換すること（後にすると `<` → `&lt;` の `&` を二重エスケープしてしまう）。
 *
 * 受信側の復号（eventFacts.stripBotMention）と対になる:
 * 受信 `x &lt; 5` → 復号 `x < 5` → LLM → 本関数 → 投稿 `x &lt; 5` → Slack 表示 `x < 5`。
 */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
