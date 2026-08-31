export const USER_FACING_MESSAGES: Record<string, string> = {
  CHANNEL_NOT_BOUND:
    'このチャンネルにはまだBotの設定が完了していないみたい。管理者に確認してもらえると助かります！',
  PERSON_NOT_FOUND: '対応する生徒情報が見つからなかったよ。管理者に確認してもらうね。',
  SLACK_FILE_DOWNLOAD_FAILED:
    '画像の取得に失敗しちゃった :sweat_smile: 少し時間を置いてもう一度送ってみてね。',
  UNSUPPORTED_FILE_TYPE:
    'ごめん、そのファイル形式にはまだ対応してないんだ。画像（jpg / png）で送ってもらえる？',
  IMAGE_TOO_LARGE: '画像が少し大きすぎたみたい。圧縮してもう一度送ってみてね！',
  IMAGE_PROCESSING_FAILED:
    '画像の処理がうまくいかなかったけど、テキストの内容で回答するね。',
  // #1: Vision 対応モデル未設定 + 画像だけの質問（文章が無いと回答の材料が残らない）
  IMAGE_MODEL_NOT_CONFIGURED:
    'ごめん、いまは画像を読み取れないんだ :bow: 聞きたいことを文章でも送ってくれたら答えるよ！',
  AI_RATE_LIMITED:
    'いま少し混み合ってるみたいで、すぐ答えられないや :sweat: 1〜2分後にもう一度送ってみてね！',
  AI_TIMEOUT:
    '回答の生成に時間がかかりすぎてしまった。質問を少し短くしてもう一度送ってみてね。',
  AI_RESPONSE_FAILED:
    'うまく処理できなかったみたい :sweat_smile: もう一度試してみて。続くようなら先生に教えてね。',
  TOKEN_BUDGET_EXCEEDED: '質問が少し長すぎて処理できなかったよ。短くして送ってみてね！',
  JOB_TIMEOUT: '処理がタイムアウトしちゃった。もう一度質問を送ってみてね！',
  // F-1 / DEC-15: kill_switch で AI 応答を停止している間の返信（障害・コスト対応中）
  AI_PAUSED:
    'いまメンテナンス中でお返事ができないんだ :bow: しばらく経ってからもう一度質問してね。',
  // F-2 / 運用設計 3.4: person 単位 10回/時の上限に達したときの返信
  RATE_LIMITED:
    '今日はたくさん質問してくれてありがとう！ちょっと休憩して、1時間ほどしてからまた質問してね :relaxed:',
  UNKNOWN_ERROR:
    'うまく処理できなかったみたい :sweat_smile: もう一度試してみて。続くようなら先生に教えてね。',
}

export const SILENT_ERROR_CODES = new Set([
  'REPORT_NOT_FOUND',
  'REPORT_CHUNK_SEARCH_FAILED',
  'SLACK_SIGNATURE_INVALID',
  'SLACK_EVENT_DUPLICATE',
  'SLACK_POST_FAILED',
  'LOW_CONFIDENCE_SKIP',
  // H-6: 退塾生（persons.status=inactive）のチャンネルには何も投稿しない
  'PERSON_INACTIVE',
])

/**
 * 読めなかった画像について、回答本文の末尾に添える1行（#5 / IMAGE_MODEL_NOT_CONFIGURED）。
 *
 * 回答自体は必ず返すので「止める」文言にはしない。別メッセージにせず本文に足すのは、
 * 1ジョブ1配信（A-3）を崩さず、会話ログにも「画像を読めなかった」証跡が残るため。
 * 添えるのは常に1行だけ: Vision 未設定なら個別の失敗理由を並べても生徒が取れる行動は変わらない。
 * visionModelMissing のとき呼び出し側は画像を LLM に渡さないので、「文章の内容から答えた」は実態どおり。
 */
export function buildImageNotice(params: {
  /** 読み込めなかった枚数（DL/形式/サイズ失敗 + 枚数上限で捨てた分） */
  unreadCount: number
  /** LLM に渡せた枚数 */
  readCount: number
  /** Vision 対応モデル未設定で、渡した画像が事実上無視される状態か */
  visionModelMissing: boolean
}): string {
  if (params.visionModelMissing) {
    // 生徒に内部事情（環境変数）は出さない。運用者向けの詳細は ai_error_logs 側に残す
    return '\n\n（ごめん、いまは画像を読み取れないみたい。文章の内容から答えたよ。図や式が大事なときは文章でも教えてくれると助かる！）'
  }
  if (params.unreadCount <= 0) return ''
  const rest =
    params.readCount > 0 ? '読めた画像と文章の内容で答えたよ。' : '文章の内容から答えたよ。'
  return `\n\n（送ってくれた画像のうち ${params.unreadCount} 枚は読み込めなかったんだ。${rest}もう一度送るときは jpg / png で、サイズを小さめにしてみてね）`
}

export function getUserFacingMessage(code: string): string {
  return USER_FACING_MESSAGES[code] ?? USER_FACING_MESSAGES['UNKNOWN_ERROR']
}

export function isSilentError(code: string): boolean {
  return SILENT_ERROR_CODES.has(code)
}
