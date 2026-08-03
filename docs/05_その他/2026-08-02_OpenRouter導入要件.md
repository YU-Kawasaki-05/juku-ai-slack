<!-- 調査記録。実施 2026-08-02。参照元: docs/05_その他/2026-08-02_本番移行_決定事項と制約.md §2 -->
# OpenRouter 導入要件（調査記録・2026-08-02）

> **この文書の位置づけ**
>
> 本番の LLM プロバイダ選定にあたり、OpenRouter を採用する場合に必要な準備・設定・制約を
> 公式ドキュメントの一次情報から洗い出した記録。**採用を決めた文書ではない。**
>
> **現在の方針は OpenAI 直への一本化**（理由は
> `docs/05_その他/2026-08-02_本番移行_決定事項と制約.md` §2）。
> 本書は「後で OpenRouter を再検討するとき、調査をやり直さないため」に残している。
>
> **調査方法**: 6 観点（キー / 課金 / データポリシー / API 互換 / 制限 / モデル）を並行調査し、
> 抽出した主張を出典 URL に当たり直して検証した。**主張 115 件のうち 107 件は裏が取れ、8 件は取れなかった。**
> 裏の取れなかったものは §6「確認できなかったこと」に分離してある。
>
> ⚠️ **単価・仕様は 2026-08-02 時点の値**。特に以下は時間で変わるため、再利用時は必ず取り直すこと。
> - モデルの単価とプロモーション（terra の「50% off」など）
> - モデルの実在（`~...-latest` エイリアスは無告知で中身が変わる）
> - 手数料率・最低チャージ額
> - 設定画面のパスと文言（docs の URL 体系が改編中）
>
> ⚠️ **本文中の `sk-or-v1-xxxxxxxx` 等はすべてプレースホルダ**。実キーは `.env.local` と
> Vercel の環境変数にのみ置き、この repo には絶対に書かない。

---

## 結論（1行）

**API キーを貰うだけでは足りない。** 未成年の個人情報を送る前提では、キーの前に「Organization の作成」「クレジット購入」「Privacy 設定（学習利用オプトアウト / ZDR）」「Guardrail（予算＋モデル allowlist）」の 4 つを済ませ、さらにリクエスト毎に `provider.data_collection: "deny"` を明示送信する実装が必要。

追加で必要なもの（詳細は後述）:

| # | 必要なもの | 理由 |
|---|---|---|
| 1 | **Organization を最初に作る** | 個人アカウントは組織に変換できない（「organizations are separate entities. You'll need to create a new organization and transfer resources as needed.」）。後から移すとキー再発行＋クレジット移管が発生 |
| 2 | **クレジット前払い（$10 以上）** | 残高 0 / マイナスで 402。残高が single digit dollars だとレイテンシも劣化（公式推奨最低残高 $10-20） |
| 3 | **Privacy 設定の確認と変更** | 「学習するプロバイダへのルーティング許可」のデフォルトが**公式ドキュメントに明記されていない**。DeepSeek 一次プロバイダは `training: true` / `retainsPrompts: true` |
| 4 | **Guardrail（日次予算＋モデル allowlist＋ZDR）** | キー漏洩・暴走時の被害限定。アプリ側のパラメータ漏れでも安全側に倒れる |
| 5 | **キー単位 credit limit** | 402 で止まる上限を持たせる |
| 6 | **アプリ側の実装追加** | `provider` オブジェクト送信、`finish_reason` 検査、`error.metadata.error_type` によるエラー分類、reasoning 制御、temperature のモデル別分岐 |
| 7 | **残高・ZDR 監視** | `GET /api/v1/key` の `limit_remaining`、`/api/v1/endpoints/zdr` の日次差分、status.openrouter.ai 購読 |

---

## 1. やることリスト（順番どおりに）

### Step 1. サインアップ（会社ドメインのメールで）

- https://openrouter.ai/sign-up
- **サインアップ方式（メール / Google / GitHub / SSO）は公式ドキュメントに記載がなく未確認。** 実画面で目視確認する。個人 Google アカウントではなく会社ドメインのメールを使う
- メールアドレスの verify を必ず完了させる（次の Organization 作成に必須）
- 出典: https://openrouter.ai/docs/faq（記載は「To get started, create an account and add credits on the Credits page.」のみ）

### Step 2. Organization を作る（**キー発行より先**）

1. https://openrouter.ai/settings/preferences を開く
2. **Organization** セクションの **Create Organization** をクリック
3. セットアップに従って組織詳細を設定
4. 必要ならメンバーを招待（上限 10 名）

- 「You must have a verified email address to create an organization.」
- ロールは Admin / Member の 2 種。クレジット購入・請求情報閲覧・全キー閲覧は Admin のみ。Member は自分が作ったキーしか管理できないが、**誰が作ったキーでも全メンバーが使える**
- 出典: https://openrouter.ai/docs/cookbook/administration/organization-management.md

### Step 3. クレジットをチャージ

1. https://openrouter.ai/settings/credits
2. **$15 以上**を 1 回でチャージ（理由は下記）

- 1 トランザクションあたり最低 $5 / 最大 $25,000（https://openrouter.ai/terms）
- プラットフォーム手数料: カード等 **5.5%（最低 $0.80）** / 暗号通貨 5.0%（最低なし）。$14.55 未満のチャージは 5.5% より $0.80 が上回るので**少額の細かいチャージは損**
- `:free` モデルの日次上限が 50 → 1,000 req/day に上がる境界は「**生涯購入額 $10 以上**」（残高ではない）
- クレジットは購入から **365 日で失効**しうる。返金は購入から 24 時間以内のみ、手数料は返金対象外、暗号通貨は返金不可 → **年間消費見込みを超える一括チャージはしない**
- 推論トークン単価にマージンはない（「We pass through the pricing of the underlying providers without any markup」）が、**実効コスト = プロバイダ単価 × 1.055** として試算する
- Auto Recharge（閾値を下回ると自動課金）は使ってよいが、**Guardrail の日次予算上限と必ず併用する**（併用しないと暴走ループで請求が無限に伸びる）
- 出典: https://openrouter.ai/blog/announcements/simplifying-our-platform-fee/, https://openrouter.ai/docs/faq, https://openrouter.ai/pricing, https://openrouter.ai/docs/api_reference/limits

> 請求書払い・銀行振込は Pay-as-you-go では公開情報上サポートなし（カード / AliPay / USDC）。必要なら Enterprise 問い合わせ（https://openrouter.ai/enterprise/form）。Enterprise の請求形態は「Invoiced Billing」「Invoicing options」と表記されており、**「月次」とは明記されていない**。

### Step 4. Privacy 設定（**ここが最重要**）

1. https://openrouter.ai/settings/privacy（docs 側は https://openrouter.ai/workspaces/default/settings も Privacy 設定として案内）
2. **「学習する可能性のあるプロバイダへのルーティング許可」を有料モデル・無料モデルの両方で OFF にする**
   - 「There are separate settings for paid and free models.」— 有料と無料は**別設定**。片方だけ切っても意味がない
   - **デフォルト値は公式ドキュメントに明記がない**（FAQ は OFF を示唆、Provider Logging ページは「自分でオプトアウトする」書き方で ON を示唆。公式内で不整合）→ 必ず実画面で確認する
3. **アカウントレベル ZDR を model group 別に ON にする**
   - 単一トグルではなく Anthropic / OpenAI / Google / xAI / **Non-frontier** の 5 グループ別
   - 今回必要なのは **OpenAI**（画像用 GPT-5 系）と **Non-frontier**（DeepSeek 系はここ）
4. **設定画面のスクリーンショットを保存**（塾への説明資料の証跡）
5. **OpenRouter Use of Inputs/Outputs が OFF であることを確認**（Off by default。ON にすると製品改善に使われる代わりに 1% 割引）
- 出典: https://openrouter.ai/docs/guides/privacy/provider-logging, https://openrouter.ai/docs/guides/features/zdr, https://openrouter.ai/docs/guides/privacy/data-collection

### Step 5. Observability のログ設定が OFF か確認

1. https://openrouter.ai/workspaces/default/observability
2. **Private Input & Output Logging が OFF** であることを確認（Off by default）

ON にすると、プロンプトと出力が「a minimum of 3 months」保持され、**3 か月超も OpenRouter の裁量で保持されうる**（削除依頼をしない限り）。デバッグで一時的に ON にするのも本番では避け、Supabase 側のマスキング済み自前ログで代替する。
出典: https://openrouter.ai/docs/guides/features/input-output-logging

### Step 6. Workspace を分ける（任意だが推奨）

- 「Workspaces let you organize your OpenRouter projects into separate environments, each with its own API keys, routing defaults, guardrails, and observability.」
- **production** と **preview/staging** を分けると、キー・予算・guardrail を独立管理できる
- Workspace の作成・削除は **org admin のみ**。既存構成は自動で「Default workspace」に入る
- 注: **Workspace budgets（workspace 単位の予算上限、超過時 403）は Enterprise プラン限定**。Pay-as-you-go ではキー単位 `limit` と Guardrail の `limit_usd` で代替する
- 出典: https://openrouter.ai/docs/guides/features/workspaces.md, https://openrouter.ai/docs/guides/features/workspaces/workspace-budgets.md

### Step 7. Guardrail を作る

1. **Settings > Privacy > New Guardrail**
2. 設定内容:
   - `limit_usd` = 日次予算（例 $3）、`reset_interval` = `daily`
   - **モデル allowlist**: 使う 2〜3 モデルだけ（「Restrict to specific models. Leave empty to allow all」= 空欄だと全許可）
   - **プロバイダ allowlist**（任意）
   - **ZDR 強制**: `enforce_zdr_openai` と `enforce_zdr_other` を ON
3. **本番 API キーに割り当てる**（適用スコープは Workspace / Member / API Key の 3 種。「Layers on top of member guardrails」「stricter rules always win」）

- 「Guardrail budgets are enforced per-user and per-key, not shared across all users with that guardrail.」→ **キーを複数配ると合計上限が N 倍になる**。本番キーは 1 本に絞る
- 予算超過時は **403**（キー単位 `limit` 超過の 402 とは別コード）
- 組織アカウントでは org admin 権限が必要
- BYOK 分はデフォルトで予算に計上されない（`include_byok_in_budgets: true` で計上）
- ⚠️ `enforce_zdr_*` の**既定値は公式に明記なし**（SDK ドキュメントの false/true は Default 列ではなく Example 列の値）→ 明示的に ON にする
- 出典: https://openrouter.ai/docs/guides/features/guardrails.md, https://openrouter.ai/blog/announcements/guardrails/

### Step 8. API キーを発行

1. https://openrouter.ai/keys（実体は https://openrouter.ai/settings/keys）
2. **Production 用 / Preview 用 / ローカル開発用を別キーで発行**
3. 各キーに名前と **credit limit** を設定（キー作成時に任意設定できる）
4. Preview / 開発用は低い credit limit を付ける

- キー形式は `sk-or-v1-...`（Management API のレスポンス例 `"label": "sk-or-v1-abc...123"` から確認。**authentication ページは prefix を仕様として宣言していない**ので、prefix バリデーションは「参考程度の簡易チェック」に留める）
- `limit_reset`（daily / weekly / monthly）は **API（`PATCH /api/v1/keys/{keyHash}`）でのみ確認できている**。UI で設定できるかは未確認 → UI で上限だけ設定 → 必要なら PATCH で周期を付ける 2 段構え
- 将来 API でローテーションするなら、作成レスポンスの **key hash を控える**（削除は `DELETE /api/v1/keys/{key_hash}`、キー文字列では消せない）。UI からは hash なしでも削除可
- ローテーション手順: 新キー作成 → アプリを新キーへ切替 → 旧キー削除。「Both keys remain valid during this transition period」
- 出典: https://openrouter.ai/docs/api_reference/authentication.md, https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md, https://openrouter.ai/docs/cookbook/administration/api-key-rotation.md

### Step 9. Management API Key は作らない

- 発行画面は https://openrouter.ai/settings/management-keys（旧称 Provisioning API Keys）
- 「Management keys cannot be used to make API calls to OpenRouter's completion endpoints - they are exclusively for administrative operations.」
- **全キーを作成・削除できる強権限。Vercel の環境変数には置かない。** 今回の構成（chat/completions を呼ぶだけ、キー 1〜2 本を手動管理）では不要
- 残高確認に `GET /api/v1/credits` を使うと Management キーが必要になる（通常キーは 403）→ **`GET /api/v1/key` を使えば通常キーで `limit_remaining` が取れる**ので、そちらで済ませる
- 出典: https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md, https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits

### Step 10. Vercel 環境変数を設定

Production / Preview / Development で**別キー**を入れる（§3 参照）。

### Step 11. アプリ実装（既存コードから変える点）

```ts
// クライアントは 1 インスタンスで足りる。分岐は model 文字列のみ
const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,   // https://openrouter.ai/api/v1
  timeout: 60_000,                      // 既定は 10 分。Vercel の maxDuration より短くする
  maxRetries: 1,                        // 既定は 2
});
```

`provider` / `models` は openai SDK の型定義に無い追加フィールド。**`// @ts-expect-error` は使わない**（SDK が型を付けた瞬間に「エラーが無いのにディレクティブがある」で CI が落ちる）。独自型を定義して `as unknown as ChatCompletionCreateParams` でキャストするか、fetch の薄いラッパを自作するほうが壊れにくい。

必ず送るもの:

```ts
const provider = {
  data_collection: 'deny',   // 既定は "allow"（= 保存・学習しうるプロバイダに流れる）
  zdr: true,                 // 未指定だと routing に影響しない（明示オプトイン）
  allow_fallbacks: true,     // 既定 true。ZDR で候補が減るので落とさない
};
```

モデル別の分岐:

| | テキスト（DeepSeek） | 画像（GPT-5.6 系） |
|---|---|---|
| `temperature` | 送ってよい | **キーごと落とす**（supported_parameters に無い） |
| reasoning | `reasoning: { enabled: false }`（※後述の未確認事項あり） | `reasoning: { effort: 'none' }` |
| 出力上限 | `max_tokens` | **§5 の落とし穴 2 を参照**（プロバイダ単位で `max_tokens` / `max_completion_tokens` が排他） |

レスポンス検査（必須）:

```ts
const choice = res.choices[0];
if (!choice || choice.finish_reason === 'error' || !choice.message?.content) {
  throw new LlmError('incomplete', choice);   // HTTP 200 でも失敗しているケース
}
if (choice.finish_reason === 'length') { /* max_tokens 到達として別扱い */ }
```

エラー分類（`error.code` は数値の HTTP ステータス。`error.metadata.error_type` を見る）:

| error_type | HTTP | 扱い |
|---|---|---|
| `rate_limit_exceeded` | 429 | Retry-After を尊重してリトライ |
| `provider_overloaded` / `provider_unavailable` | 503 / 502 | リトライ or フォールバックモデル |
| `timeout` | 504 | リトライ |
| `payment_required` | 402 | **即 Slack #alerts。残高/キー上限切れ＝全断** |
| （Guardrail 予算超過） | 403 | **即 Slack #alerts。429 と混同してリトライしない** |
| `image_too_large` / `unsupported_image_format` / `payload_too_large` | 400 / 413 | 生徒向けに「画像を小さくして再送」 |
| `content_policy_violation` / `refusal` | 400 | 定型文で返す |

出典: https://openrouter.ai/docs/api_reference/errors-and-debugging, https://openrouter.ai/docs/guides/routing/provider-selection, https://openrouter.ai/docs/api_reference/limits

### Step 12. 監視を仕込む

- `GET https://openrouter.ai/api/v1/key`（通常キーで叩ける）を定期実行し、`limit_remaining` / `usage_daily` が閾値を割ったら Slack #alerts（既存の kill_switch 通知経路に載せる）
- 各レスポンスの `usage.cost` を jobs / conversation ログに保存 → 生徒単位のコスト按分ができる（`cost` は openai SDK の型に無いのでキャストが必要）
- `GET https://openrouter.ai/api/v1/endpoints/zdr` を日次取得し、**使用中モデル×プロバイダが ZDR 一覧から消えたらアラート**（「automatically updated when there are changes to a provider's data policy」）
- https://status.openrouter.ai/ の **Subscribe to updates** を運用チャンネルに登録
- `support@openrouter.ai` に subprocessor 通知の購読を依頼（ただし **Model Providers の追加は 30 日前通知の対象外**）

---

## 2. データポリシー（個人情報）

### 前提の整理

生徒（未成年）の質問文・氏名・学年が通る経路は 2 段:

1. **OpenRouter 自身** — プロンプトは保存されない（「Any prompt retention on OpenRouter is always opt-in.」「OpenRouter itself has a ZDR policy」）。ただしメタデータ（トークン数・レイテンシ）は常に保存される
2. **上流モデルプロバイダ** — ここが実質のリスク。OpenRouter の設定でどこに流すかを絞る

### デフォルトのままだと危ない 2 点

| 設定 | デフォルト | 危険 |
|---|---|---|
| `provider.data_collection`（リクエスト単位） | **`"allow"`** =「保存し学習しうるプロバイダを許可」 | 何も送らないと DeepSeek 一次プロバイダに流れうる |
| アカウント Privacy の「学習許可トグル」 | **不明**（公式内で記述が不整合） | 実画面で確認するまで「不明」として扱う |

**DeepSeek 一次プロバイダ（slug `deepseek`）は OpenRouter 自身のデータで `training: true` / `retainsPrompts: true`**（保持期間は未設定＝「unknown period」表示）。80 プロバイダ中 `training: true` は DeepSeek と NVIDIA の 2 社のみ。ZDR エンドポイント一覧にも含まれない。
出典: https://openrouter.ai/api/frontend/v1/all-providers, https://openrouter.ai/api/v1/endpoints/zdr

### 三重掛けで守る

1. **アカウント Privacy 設定** — 有料・無料両方の training opt-out ＋ model group 別 ZDR（OpenAI / Non-frontier）
2. **本番キーに Guardrail** — `enforce_zdr_openai` / `enforce_zdr_other` ＋ モデル allowlist
3. **リクエスト毎に** `provider: { data_collection: 'deny', zdr: true }`

公式ブログも「For regulated workloads, set these explicitly rather than relying on defaults.」と述べている（https://openrouter.ai/blog/insights/ai-data-residency/）。

Guardrail は「アカウント設定を継承し、より厳しくすることしかできない」（「Guardrails can only be _more_ restrictive.」「stricter rules always win」）ので、アプリ側でパラメータを送り忘れても安全側に倒れる。

⚠️ リクエスト単位 `zdr` は account / guardrail 設定との **OR** で、「can only be used to ensure ZDR is enabled for a specific request, not to override or disable」。緩める方向には使えない。
一方 **`data_collection` については「アカウント設定とマージされ緩め方向に働かない」という明文が公式に無い**（「merged with your account-wide」と書かれているのは `only` / `ignore` だけ）。ワークスペース側に「The account-level policy is the ceiling; individual workspaces can only be more restrictive.」の記述はあるので実質は同じだが、根拠としては弱い。

### ZDR 強制の副作用

| モデル | ZDR 強制後の経路 |
|---|---|
| DeepSeek 系 | 第三者プロバイダ経由の ZDR エンドポイントが多数（V4 Pro = BaseTen / Parasail / Novita / DeepInfra / SiliconFlow / Fireworks / Together / CoreWeave / Venice / DigitalOcean / Ionstream。V3.2 = Novita / SiliconFlow / DeepInfra / Google / Venice / SambaNova / Phala / DigitalOcean）。**一次プロバイダは落ちるので価格・レイテンシの前提が変わる** |
| GPT-5 / GPT-5.6 系 | **Azure 固定**（ZDR 一覧の GPT-5 系 23 モデル、5.6 Luna / Sol / Terra 系を含め全て `provider_name = Azure`）。→ §5 の `max_completion_tokens` 問題に直結 |

「アカウントのプライバシー設定を満たすプロバイダが存在しない場合、**サイレントに緩和されずエラーになる**」（FAQ: 「you will get an error and your request will not complete.」）。503 = 「There is no available model provider that meets your routing requirements」。**エラー時に `data_collection` を緩めてリトライする実装は絶対に作らない。**

### 塾に説明できる形（そのまま使える文言）

> - AI ゲートウェイ（OpenRouter）は質問文・回答を**保存しません**（保存はオプトイン方式で、当社は無効に設定）。学習利用も行いません
> - 実際に推論を行うモデルプロバイダは、**Zero Data Retention（データを一切保持しない）方針のエンドポイントに限定**しています。あわせて「データを学習に利用しうるプロバイダ」へのルーティングをアカウント設定・API キー単位のポリシー・リクエスト単位の指定の 3 段で禁止しています
> - 処理中のインメモリキャッシュは ZDR の対象外です（OpenRouter は「in-memory caching of prompts is *not* considered retaining data」との立場）
> - 統計目的で、匿名化された「質問カテゴリの分類処理」が少数のリクエストに対して行われます。分類は ZDR 方針のモデルで実施され、**本文は保存されず、アカウント / ユーザー ID にも紐付きません**
> - 画像（ノート写真など）は「ルーティングに必要な時間を超えて保持しない」と定められていますが、**不正利用検知・セキュリティ・課金・法令遵守は例外**とされています
> - OpenRouter は GDPR 準拠の DPA（Controller = 当社 / Processor = OpenRouter）を締結済み、SOC 2 Type II 取得済み。再委託先一覧は https://trust.openrouter.ai/ で公開されています
> - ゲートウェイ側のプロバイダポリシー表示は**保証ではありません**（利用規約に「OPENROUTER MAKES NO REPRESENTATION OR WARRANTY REGARDING ANY MODEL PROVIDER'S DATA HANDLING...」と明記）。そのため当社は技術的担保（ZDR 強制＋氏名を送らない設計）で対応します
> - **生徒本人・保護者からの同意取得は当社（および塾）の責任範囲**です

### 設計上の強い推奨: 氏名を送らない

DPA 2.5 は「Sensitive Data」の処理を原則対象外とし、必要なら Schedule 1 の修正合意が必要と定めている。定義 1.14(f) は「other information that falls within the definition of ... personal information as defined in applicable data breach notification laws」という包括条項で、**氏名＋学年＋質問内容がこれに当たると解釈されると、修正合意なしの処理は DPA の前提から外れる**。質問文に健康・家庭事情が混ざれば (c)(d) に触れる可能性もある。

→ **プロフィール要約から氏名を外し、生徒 ID ＋ 学年に置換する。** これで
- DPA 1.14(f) の解釈リスクが下がる
- 匿名カテゴリ分類の経路（ログ全 OFF でも残る唯一の経路）でも氏名が渡らない
- 画像に写り込む氏名は別問題なので、送信前のトリミング・リサイズを運用に入れる

出典: https://openrouter.ai/data-processing-agreement, https://openrouter.ai/terms, https://openrouter.ai/privacy

### 国内リージョンは不可

EU 内処理（`https://eu.openrouter.ai`）は **Enterprise 顧客のみ**。**日本国内リージョン処理に相当する仕組みは公式ドキュメントに存在しない**。塾から「データ保存場所は国内限定」という要件が出た場合、OpenRouter 経由は成立しない。契約前に確認すること。

### 年齢要件

ToS / Privacy Policy の「13 歳以上」「18 歳未満は保護者の許可」は **OpenRouter のアカウント保有者に対する要件**。生徒は Slack 経由でしか触らずアカウントを持たないため直接の対象外。**未成年の第三者データ送信を制限する条項は ToS / Privacy Policy / DPA のいずれにも見つからなかった**が、これは「規約上禁止されていない」だけで、保護者同意の取得は Controller 側（塾＋当社）の責任。

---

## 3. 環境変数の最終形

```bash
# ── OpenRouter（chat/completions のみ）
LLM_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx   # Production / Preview / Development で別キー
LLM_BASE_URL=https://openrouter.ai/api/v1        # 末尾 /v1 まで含める。障害時に切替できるよう env 化を維持
LLM_MODEL_DEFAULT=deepseek/deepseek-v4-flash-0731
LLM_MODEL_COMPLEX=openai/gpt-5.6-luna            # 画像（Vision）用

# ── Embedding は OpenAI 直（変数名を必ず分ける）
OPENAI_API_KEY=sk-proj-xxxxxxxx                  # sk-or-v1- と混同すると 401 の原因になる
```

- **`LLM_API_KEY` と `OPENAI_API_KEY` を絶対に共用しない。** キー形式が違う（`sk-or-v1-` vs `sk-`）ため取り違えると 401
- **`X-Title` / `HTTP-Referer` は設定しない。** 任意ヘッダで、設定すると自社アプリが OpenRouter の公開リーダーボード / マーケットプレイスに掲載される。クライアント（実在する学習塾）向けの非公開サービスなので、案件の存在が外部に露出しうる
  - なお正式名は `X-OpenRouter-Title` に変わっているが `X-Title` も「also accepted」で、旧名が無効になったわけではない
- **Management API Key は Vercel に置かない**（作らないのが最善）
- モデル ID は上の 2 変数に集約し、コードに散らさない（`expiration_date` / `pricing` の変化に対応するため）
- timeout / maxRetries はコード側で明示（既定は 10 分 / 2 回でどちらも Vercel と相性が悪い）

---

## 4. モデル選択（実在確認済みのみ）

すべて `GET https://openrouter.ai/api/v1/models` の生 JSON を 2026-08-02 に取得して確認した値。
⚠️ **`/api/v1/models` を要約系フェッチで読むと内容が欠落する**（DeepSeek 13 件のうち 2 件、GPT-5 系 29 件のうち 6 件しか返らず、総件数も確定できない事例を再現）。存在確認は必ず curl ＋ JSON パースで行う。

### テキスト用（第一候補）

| 項目 | 値 |
|---|---|
| model ID | **`deepseek/deepseek-v4-flash-0731`** |
| 単価 | $0.09 / $0.18 per 1M（実効は ×1.055） |
| context | 1,048,576 |
| max_completion_tokens | **65,536**（旧 `deepseek-v4-flash` は 393,216 なので混同しないこと） |
| temperature | 対応 |
| is_moderated | false |
| reasoning | **default_enabled: true / default_effort: "high"**、supported_efforts = `["max","high","low"]`（**`"none"` が無い**） |
| Vision | **非対応**（DeepSeek 系 13 件すべて `input_modalities: ["text"]`） |

`~deepseek/deepseek-v4-flash-latest` は浮動エイリアス（`alias_target` が 0731 を指す）。**本番では使わない** — 新版公開時に無告知でモデル・単価・トークン数が変わる。

### 画像（Vision）用

| model ID | 単価 /1M | context | temperature | is_moderated | reasoning 既定 |
|---|---|---|---|---|---|
| **`openai/gpt-5.6-luna`**（推奨起点） | $0.10 / $0.60 | 1,050,000 | 非対応 | true | enabled: true, effort "medium"、`"none"` 可 |
| `openai/gpt-5.6-terra` | $1 / $6（**「50% off」表記あり**） | 1,050,000 | 非対応 | true | 同上 |
| `openai/gpt-5-nano` | $0.05 / $0.40 | 400,000 | 非対応 | true | — |
| `qwen/qwen3.7-flash` | $0.03 / $0.13 | 1,000,000 | **対応** | false | enabled: true |

- **`gpt-5.6-luna` 起点を推奨。** Terra は Luna の入力単価 10 倍で、生徒の質問画像を読む用途には過剰。品質不足を実測で確認してから Terra に上げる
- **Terra の $1/$6 は 50% 割引後の値。割引前定価と終了日は公式に記載がなく未確認。** プロモ終了で $2/$12 相当になっても成立するか試算しておく
- `gpt-5.6-luna` / `terra` には **272,000 プロンプトトークン超で単価が上がる `pricing.overrides`** がある（luna: $0.10→$0.20 / $0.60→$0.90、terra: $1→$2 / $6→$9）
- GPT-5.6 系は 6 モデル（sol / sol-pro / terra / terra-pro / luna / luna-pro）。`-pro` は per-token 単価は同一だが「typically consumes more tokens」なので実費は上がる。`reasoning.mode: "pro"` を標準モデルに送ると `-pro` へ自動ルートされる
- **画像用に GPT-5 系を選んでも OpenRouter 経由で可用性は上がらない。** `openai/gpt-5.4-mini` のエンドポイントは 4 件で提供元は OpenAI と Azure のみ（DeepSeek V3.2 は 14 エンドポイント）。ZDR 強制なら Azure 1 社に固定される → **画像だけ OpenAI 直、テキストだけ OpenRouter という分割も比較検討の余地あり**

### 使わないもの

- **`:free` サフィックス付きモデル** — 20 req/min ＋ 50〜1,000 req/day。「Making additional accounts or API keys will not affect your rate limits, as we govern capacity globally.」で回避不能。20 req/min は生徒が同時に質問する塾の用途で容易に飽和。加えて `:free` 14 件のうち 8 件が NVIDIA nemotron 系で、**NVIDIA プロバイダは `training: true` / `retainsPrompts: true`**。ZDR エンドポイント 703 件中 `:free` は 2 件のみ
  - なお free variant のドキュメント自体には「rate limits or availability の差異」しか書かれておらず、**データ利用ポリシーの差は同ページからは読み取れない**（上記の判断根拠はプロバイダ実データ側）
- **`openrouter/auto` / `openrouter/auto-beta`** — pricing が `-1`（動的ルーティングのセンチネル値）で、**単価が事前に確定せず、どの上流に個人情報が渡るかも実行時まで不定**
- **`~...-latest` エイリアス**（前述）

### 日本語品質

**OpenRouter は日本語ベンチマークを公開していない**（掲載指標は artificial_analysis の intelligence / coding / agentic index と design_arena のみ）。安価候補（`mistralai/mistral-nemo` $0.019/$0.030、`qwen/qwen3-30b-a3b-instruct-2507` $0.04815/$0.19305）の日本語品質を公式情報で裏付ける材料は、mistral-nemo の description に Japanese が列挙されていること以外にない。**単価だけで落とさず、実際の生徒の質問文で A/B 評価してから決める。**

### Embedding

**OpenAI 直（`api.openai.com`）を維持する**のが結論。理由:

- `openai/text-embedding-3-small` は OpenRouter でも $0.02/1M で **OpenAI 直と同額**。5.5% の入金手数料が乗るので実効はむしろ高い
- OpenRouter に寄せると、**OpenRouter 障害時に RAG 検索も同時に死ぬ**（障害ドメインが分離されなくなる）
- `POST https://openrouter.ai/api/v1/embeddings` は実在し、**`provider` パラメータで `order` / `allow_fallbacks` / `data_collection: "deny"` を指定できることが公式に例示されている**（用途に「Ensuring data privacy with specific providers」と明記）。ただし embeddings の例に `zdr` パラメータは登場せず、その点は未確認
- **OpenAI 公式 SDK の `client.embeddings.create()` で叩ける保証は公式にない**（ドキュメントの例は curl / fetch / requests / OpenRouter 独自 SDK の 4 種のみ）
- 寄せる場合はモデル ID を `text-embedding-3-small` → **`openai/text-embedding-3-small`**（`openai/` プレフィクス必須）に書き換える
- 注: 素の `GET /api/v1/models` には embedding モデルが含まれない。`?output_modalities=embeddings` が必須（31 件）

---

## 5. 踏みやすい落とし穴

### 落とし穴 1: `provider.data_collection` の既定が `"allow"`

送らなければ「データを非一時的に保存し学習しうるプロバイダ」にもルーティングされる。**明示しないと守られない。** → §2

### 落とし穴 2: GPT-5 系の `max_tokens` / `max_completion_tokens` がプロバイダ単位で排他

`GET /api/v1/models/openai/gpt-5/endpoints` の実データ:

- **OpenAI / Amazon Bedrock エンドポイント** → `supported_parameters` に **`max_tokens`** のみ
- **Azure エンドポイント** → **`max_completion_tokens`** のみ

モデル一覧 API はこれの和集合を返すので、モデルページだけ見ると両対応に見える。同じ分岐が `gpt-5-mini` / `gpt-5.1` / `gpt-5.4` でも一貫。

そして**非対応パラメータは既定でエラーにならず黙って無視される**:
> 「providers that don't support all the LLM parameters specified in your request can still receive the request, but will ignore unknown parameters.」

**つまり ZDR 強制で Azure に固定されると、`max_tokens` だけ送っている現行コードは出力上限が効かなくなる可能性がある。** 生徒への回答が想定外に長くなり課金が膨らむ / Slack 投稿が壊れる。しかも 400 が返らないので気付けない。

対策:
- 該当モデルの `/endpoints` を確認して `provider: { only: [...] }` でエンドポイントを固定する（provider slug は `/endpoints` の実データから取る。推測しない）
- または `provider: { require_parameters: true }`（上限を宣言しているプロバイダにのみルーティング）
- **導入前に「わざと小さい上限を投げて `finish_reason` が `length` になるか」を実測する**

⚠️ ただし `max_tokens` が Azure に振られた際に OpenRouter が `max_completion_tokens` へ内部変換するのか単に無視するのかは公式に記載がなく**未確認**。また `require_parameters: true` を付けたうえでそのモデルが宣言していないパラメータ（GPT-5 系の `temperature`）を送ると候補プロバイダが 0 件になる可能性がある（挙動は未確認）ので、**送るパラメータ集合をモデル別に組み立てる**こと。

### 落とし穴 3: reasoning が既定 ON で、思考トークンも出力として課金される

- `deepseek-v4-flash-0731`: **default_effort = "high"**
- `gpt-5.6-luna` / `terra`: default_effort = "medium"

「Reasoning tokens are considered output tokens and charged accordingly.」かつ effort は max_tokens の割合を消費する（`high` ≈ **80%**、`medium` ≈ 50%、`low` ≈ 20%、`none` = 無効）。

**Slack 返信用に `max_tokens: 1500` などと設定していると、DeepSeek V4 Flash 0731 では約 8 割が思考に消えて生徒に見える回答が途中で切れる／空になる。** かつ思考分も課金される。

→ 両モデルで reasoning を明示制御し、`max_tokens` は「reasoning 込みの上限」という前提で余裕を持たせる。

### 落とし穴 4: HTTP 200 でも失敗している

非ストリーミングでも、プロバイダ側エラーが成功レスポンスの `choices[0]` に埋め込まれて返る:

```json
{ "choices": [{ "message": { "content": "partial output..." },
  "finish_reason": "error",
  "error": { "code": 502, "metadata": { "error_type": "provider_unavailable" } } }] }
```

`try/catch` では検知できない。**`finish_reason` と `content` の空判定を必ず入れる。** また content が空でも「you may still be charged for the prompt processing cost by the upstream provider」。

（Zero completion insurance は自動有効で、出力トークン 0 ＋ blank/error finish_reason なら prompt / completion / reasoning トークンは課金されない。ただし対象は推論トークンのみで、web search / PDF OCR / web fetch は失敗しても課金される → **plugins / tools は使わない**）

### 落とし穴 5: `error.code` が数値、`error.type` が存在しない

Chat Completions スキンのエラー形式は **OpenAI 互換ではない**:

```json
{ "error": { "code": 429, "message": "Rate limit exceeded",
  "metadata": { "error_type": "rate_limit_exceeded", "provider_code": "rate_limited" } } }
```

`if (err.code === 'rate_limit_exceeded')` のような OpenAI 前提の分岐は**静かに全部 false になり、リトライ制御が効かなくなる**。分類は `error.metadata.error_type` で行う。
（`/api/v1/messages` の Anthropic スキンではネイティブ `error.type` が存在し `error.code` は文字列になる。**スキン横断で信頼できるのは `error_type` のみ**）

### 落とし穴 6: 402 と 403 と 429 は原因が全く違う

- **402** = クレジット残高 / キー単位 `limit` 切れ。マイナス残高では `:free` 含む全モデルが使えなくなる
- **403** = Guardrail 予算超過（Enterprise の workspace budget も 403）
- **429** = 2 系統ある。OpenRouter 側（`:free` 上限 or Cloudflare DDoS 保護）と上流プロバイダ側。後者は `provider_code` が付き、**あなたに 429 が届く時点で同一モデルの他プロバイダは既に試し尽くされている**
- **503** = ルーティング要件を満たすプロバイダが 0 件（ZDR 強制の副作用でここに来る）

403 を「一時的失敗」と誤判定してリトライすると無駄に叩き続ける。

### 落とし穴 7: `X-RateLimit-*` ヘッダは成功レスポンスに付かない

「Successful inference responses do not include X-RateLimit-* headers.」
**「レスポンスヘッダで残量を見て絞る」設計は成立しない。** 残量監視は `GET /api/v1/key` のポーリング（`limit_remaining` / `usage_daily`）で行う。

### 落とし穴 8: 有料モデルのレート制限は「残高を積めば上がる」ものではない

公式に定義された rate limit は「`:free` の上限」と「Cloudflare DDoS 保護」の 2 つだけで、有料バリアントは「no platform-level request cap」。**有料モデルで踏む 429 は実質上流プロバイダ由来。** 対策は残高ではなく `models` フォールバック配列 ＋ `provider` 設定。

### 落とし穴 9: 残高が減るとレイテンシが悪化する

「A user's credit balance is low (single digit dollars)」または「An API key is approaching its configured credit limit」で追加の DB チェックが走り、キャッシュが積極的に失効される。**402 で全断する前からレイテンシ劣化が始まるため、原因を推論側だと誤診断しやすい。** 推奨最低残高 $10-20。

### 落とし穴 10: 画像の上限が非公開

- **base64 データ URL のサイズ上限もリクエストボディ上限（413 の閾値）も公式に数値記載がない**
- base64 は元データの約 1.33 倍に膨らむ（これは base64 の一般則で、OpenRouter の記述ではない）
- Vercel の Serverless Function 側の制限も二重に効く
- 対応 content type は `image/png` / `image/jpeg` / `image/webp` / `image/gif` の 4 種。拡張子と MIME を一致させる
- **`content` 配列は text → image の順**（「we recommend sending the text prompt first, then the images」）
- 272,000 プロンプトトークンを超えると単価が上がる（落とし穴に直結）

→ アップロード時にサーバ側で長辺リサイズ＋JPEG 再エンコードし、**上限を自前で決める**（例 1.5MB 以下）。閾値は本番前に実測する。

### 落とし穴 11: OpenRouter は単一障害点

公式ポストモーテムより: **2026-02-17 に 38 分（5:27 AM UTC 開始）、2026-02-19 に 35 分（7:36 AM UTC 開始）の障害でピーク時 80-90% のリクエストが失敗**。原因は API キー参照用キャッシュ層の DB 接続喪失で、**当初タイムアウトが `401 "User not found"` としてユーザーに返っていた**（対策として現在は 503 を返すよう修正済み）。2025 年 8 月には約 50 分の DB 障害も。

→ **`LLM_BASE_URL` を env で切替可能にして OpenAI 直へ切り戻せる経路を用意する。401 を即「キー失効」と判断せずリトライ対象に含める。**

### 落とし穴 12: 数値 SLA はない

status.openrouter.ai は Chat / Data API / Homepage / Clerk を監視（2026-08-02 時点で全 operational）。Enterprise ページも「committed to being accretive to your uptime」「SOC-2 compliant partner with SLAs」という表現で**稼働率の数値保証はない**。標準プランに公開 SLA はなく、**クライアント（学習塾）に可用性を契約上約束できる裏付けはない**。

### 落とし穴 13: `is_moderated` は OpenAI = true と一般化できない

`openai/*` 60 件のうち **11 件は `is_moderated: false`**（`openai/gpt-5.4`、codex 系、gpt-oss 系など）。「OpenAI なら moderated」という前提でモデルを選ぶと実害になる。採用候補の `gpt-5.6-terra` / `terra-pro` / `luna` / `gpt-5-mini` / `gpt-5-nano` / `gpt-5.4-nano` は 6 件すべて true。DeepSeek 系 13 件はすべて false。

→ **個人情報の扱いは「OpenRouter に送るか」ではなく「どの上流に届くか」で整理する。** GPT-5 経路はモデレーション層を通り、DeepSeek 経路は通らない。同一 baseURL・同一キーでも実質のデータ経路は 2 系統。

### 落とし穴 14: docs の URL 体系が改編中

- `/docs/features/provisioning-api-keys` は現在「Management API Keys」の内容を返す
- `/docs/api-reference/authentication` と `/docs/api_reference/authentication.md` の両方が生きている
- `/docs/api/api-reference/api-keys/create-keys` と `/docs/guides/features/guardrails/overview` は **404**

→ 社内 Wiki や実装コメントに貼る URL は **`/docs/llms.txt`（全ページ索引）から取得した正規パス**を使う。

---

## 6. 確認できなかったこと（自分で確かめる項目）

### 実運用前に必ず確認（優先度高）

| # | 項目 | 確認方法 |
|---|---|---|
| 1 | **アカウント Privacy の「学習許可トグル」のデフォルト値**（有料・無料の両方） | https://openrouter.ai/settings/privacy を実画面で確認。docs / llms-full.txt / ToS / Privacy Policy に default の明記がなく、FAQ は OFF を示唆・Provider Logging ページは ON を示唆で**公式内が不整合** |
| 2 | **アカウントレベル ZDR トグル（model group 別）のデフォルト値** | 同上。Guardrail 側の `enforce_zdr_*` も、**SDK ドキュメントの false/true は Default 列ではなく Example 列の値**で、既定値を述べた公式記述は存在しない |
| 3 | **サインアップ方式**（メールのみ / Google・GitHub OAuth / SSO） | https://openrouter.ai/sign-up をブラウザで開く。docs にページがなく、JS レンダリングのため静的取得不可。※組織向け SSO は Enterprise 限定（Okta / Microsoft Entra ID / Google Workspace / custom SAML） |
| 4 | **`max_tokens` のみ送った request が Azure エンドポイントに振られた際、内部変換されるのか無視されるのか** | わざと小さい上限を投げて `finish_reason` が `length` になるか実測（落とし穴 2） |
| 5 | **GPT-5 系に `temperature` を送った場合、無視されるのか 400 が返るのか** | 実キーで 1 回叩く。docs は「明示送信値は上流へ転送される（is still forwarded）」と書いており、非対応パラメータを落とすとは書かれていない |
| 6 | **`deepseek-v4-flash-0731` で reasoning を完全に無効化できるか** | `supported_efforts` が `["max","high","low"]` で **`"none"` を含まない**。`mandatory: false` なので `reasoning: { enabled: false }` は通る想定だが公式に明記なし。実測必須（落とし穴 3） |
| 7 | **画像 1 枚あたりのサイズ上限とリクエストボディ上限（413 の閾値）** | 実測して自前の上限を決める。公式に数値記載なし（files API の 100MB は chat/completions とは別） |
| 8 | **画像入力のトークン換算・課金方法** | 記載なし。272k 境界に効くので実測でトークン数を測る |
| 9 | **塾の要件が「データ保存場所は国内限定」か** | 契約前に塾に確認。国内限定なら OpenRouter 経由は成立しない（EU リージョンは Enterprise 限定、日本リージョンの仕組みは存在しない） |
| 10 | **候補モデルの日本語出力品質** | 実際の生徒の質問文で A/B 評価。OpenRouter は日本語ベンチマークを公開していない |

### 判断が必要になったら確認

| # | 項目 | 補足 |
|---|---|---|
| 11 | **`gpt-5.6-terra` の「50% off」の割引前定価と終了日** | モデルページ・API のいずれにも記載なし。$2/$12 でも成立するか試算しておく |
| 12 | **UI（settings/keys）で `limit_reset`（daily/weekly/monthly）を直接設定できるか** | docs は UI について「optionally set a credit limit」までしか書いていない。できなければ `PATCH /api/v1/keys/{keyHash}` の 2 段構え |
| 13 | **`provider: { require_parameters: true }` で候補プロバイダ 0 件になった場合のエラー型** | 公式に明記なし |
| 14 | **OpenAI 公式 npm SDK の `embeddings.create()` が OpenRouter に対して動作するか** | 公式コード例は curl / fetch / requests / OpenRouter 独自 SDK のみ。寄せる判断をするなら 1 回疎通確認してから（通らなければ fetch 直叩き） |
| 15 | **embeddings で `provider.zdr` が効くか** | `data_collection: "deny"` は公式例に登場するが `zdr` は embeddings の例に出てこない |
| 16 | **Sensitive Info Guardrail の検出対象と挙動（block / mask / warn）** | https://openrouter.ai/docs/guides/features/guardrails/sensitive-info.md（HTTP 200 で実在確認済み、本文未読）。**氏名を送る前提と両立するか判定が必要**（誤検知で正当なリクエストがブロックされる可能性） |
| 17 | **生徒の氏名＋学年が DPA 1.14(f) の包括的「Sensitive Data」定義に該当するか** | OpenRouter 側の解釈は文書から不明。該当するなら Schedule 1 の修正合意が必要と DPA が定めている。氏名を送らない設計にすればリスクを下げられる |
| 18 | **請求書払い / 銀行振込の可否、日本の消費税・JCT の扱い** | Pay-as-you-go では公開情報上カード / AliPay / USDC のみ。Pricing ページに VAT/GST の FAQ 項目はあるが回答本文が静的取得できず未確認 |
| 19 | **Organization 作成後に個人アカウントのクレジット・キーを移管する具体手順** | 「transfer resources as needed」とあるだけ。**そもそも個人で先に走らせないのが正解** |
| 20 | **Anonymous Input Categorization のサンプリング率とオプトアウト手段** | 「a small number of prompts」以上の記述なし。オプトアウト手段の有無も不明 |
| 21 | **有料モデルのアカウント単位 RPM / RPD、Cloudflare DDoS 保護の発動閾値** | 前者は「no platform-level request cap」、後者は「dramatically exceed reasonable usage」という定性表現のみ |
| 22 | **非ストリーミングの OpenRouter 側既定タイムアウト秒数** | 504 は「within the allowed time」のみ。秒数非公開 |

### 採用しなかった情報（一次確認できず）

- **「ストリーミングで 30 秒間チャンクが来ない場合は即中断（従来は最大 5 分）」** — 出典とされる https://openrouter.ai/docs/changelog/2026/5/27 が curl / WebFetch ともに **404** で本文を確認できない。`/docs/changelog.md` にも該当記述なし。**この数値を運用判断の根拠にしない。** 一次確認できるのは「we may cancel with a fetch timeout and fallback to another provider」という定性的記述だけ。ストリーミング実装では 30 秒仕様の有無に依存せず `finish_reason: error` と途中切断のハンドリングを入れる
- **BYOK 無料枠の基準** — 「1M requests/month」（docs / 2025-10 ブログ / 2026-06 ブログ）と「$25,000 / $200,000 of list price inference / month」（Pricing ページ）の 2 系統が併存し、**金額とプランの紐付けは静的取得で確定できなかった**（同一ページの 2 回取得で列の対応が食い違った）。塾規模ならどちらでも無料枠内に収まる見込みだが、**BYOK 前提でコスト設計を確定させない**。採用判断に組み込むなら support@openrouter.ai に書面で確認する
- なお BYOK を使う場合は、キー単位で **「Always use for this provider」を ON にしないと自前キー失敗時に黙って OpenRouter 側の別プロバイダ経路に流れる**（個人情報が想定外プロバイダに渡る経路になる）。今回は BYOK を使わない前提。BYOK でも ZDR / `data_collection` の制限は免除されない（出典: https://openrouter.ai/docs/guides/overview/auth/byok）

---

### 主要出典

- Quickstart / OpenAI SDK: https://openrouter.ai/docs/quickstart, https://openrouter.ai/docs/guides/community/openai-sdk
- Provider Routing: https://openrouter.ai/docs/guides/routing/provider-selection
- ZDR: https://openrouter.ai/docs/guides/features/zdr
- Data Collection / Provider Logging: https://openrouter.ai/docs/guides/privacy/data-collection, https://openrouter.ai/docs/guides/privacy/provider-logging
- Guardrails: https://openrouter.ai/docs/guides/features/guardrails.md
- Errors: https://openrouter.ai/docs/api_reference/errors-and-debugging
- Limits: https://openrouter.ai/docs/api_reference/limits
- Organization: https://openrouter.ai/docs/cookbook/administration/organization-management.md
- Reasoning: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md
- Embeddings: https://openrouter.ai/docs/api_reference/embeddings
- DPA / ToS / Privacy: https://openrouter.ai/data-processing-agreement, https://openrouter.ai/terms, https://openrouter.ai/privacy
- 機械可読データ: https://openrouter.ai/api/v1/models, https://openrouter.ai/api/v1/endpoints/zdr, https://openrouter.ai/api/frontend/v1/all-providers, https://openrouter.ai/api/v1/models/{model}/endpoints
- 障害情報: https://openrouter.ai/blog/announcements/openrouter-outages-on-february-17-and-19-2026/, https://status.openrouter.ai/