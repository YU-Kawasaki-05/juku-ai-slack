# **LLMベースのチュータリングアプリケーションにおけるマルチセッションメモリアーキテクチャの包括的分析：プライバシー保護とセルフホスト環境に向けた最適化戦略**

教育分野における大規模言語モデル（LLM）の応用は、単一セッションの応答生成から、学習者の認知状態や過去の対話を長期的に記憶し適応する「継続的学習伴走者（Continuous Learning Companion）」への移行という重要な転換点にある。しかしながら、未成年者を対象とする教育テクノロジー（EdTech）において、対話内容や学習進捗などの機密データを外部のAIプロバイダーに依存するメモリアーキテクチャは、プライバシーやコンプライアンス上の重大なリスクを伴う。本レポートでは、学習者約50名、1人あたり月間約100メッセージという小規模なシステムを前提とし、VercelとSupabase（PostgreSQL \+ pgvector）のみをインフラストラクチャの基盤とする制約下で、2024年から2026年にかけて発展した最新のクロスセッションメモリアーキテクチャを網羅的かつ批判的に分析する。

## **1\. クロスセッション学生メモリの主要なアプローチと比較分析**

LLMを自律的なチューターとして機能させるためには、無記憶（Stateless）のモデルに対し、過去の経験や文脈を保存・検索・更新するメモリ層を統合する必要がある。この課題は、部分観測マルコフ決定過程（POMDP）におけるエージェントの内部状態（Belief State）の構築として理論化されており、情報をどのように物理的に保存し、論理的に管理するかに応じて4つの主要なアプローチに分類される1。

### **(a) ローリング・スレッド・サマリー (Rolling Thread Summaries)**

ローリング・スレッド・サマリーは、対話履歴がLLMのコンテキストウィンドウの限界に達する前に、古い対話履歴を反復的に要約し、最新の対話と結合して新たなコンテキストを形成するアプローチである。  
この手法は外部のデータベース層を必要とせず、LLMのインコンテキスト（Working Memory）内で完結するため、インフラストラクチャの複雑性が極めて低いという利点がある2。一方で、長期にわたるチュータリングにおいては致命的な欠陥を露呈する。要約プロセスを経るたびに情報が圧縮・欠落する「要約のドリフト（Summarization drift）」や、特定の詳細が二度と想起できなくなる「メモリの盲点（Memory blindness）」が発生する2。例えば、学習者が数週間前に「分数の足し算で通分を忘れる」という特有の誤答をした事実は、度重なる要約によって「数学に苦戦している」という抽象的な記述に退化してしまう。したがって、長期間にわたる精密な教育的介入には不十分な手法である。

### **(b) 構造化された知識状態テーブル (Structured Knowledge State Tables / Learner Models)**

学習者の対話履歴をそのまま保存するのではなく、LLMの推論を用いて対話から「学習者の現在の理解度」「誤概念（Misconceptions）」「習熟度スコア」を抽出し、リレーショナルデータベースやJSON形式で構造化して保持するアプローチである。  
IntelliCodeのような最先端のシステムでは、このアプローチが高度に洗練されている。IntelliCodeは、ベイズ知識追跡（BKT）に触発されたメカニズムを使用し、スキル評価、学習者プロファイリング、カリキュラム選択などを行う6つの特化型エージェントが、中央の「学習者状態（Learner State）」を共有・更新する4。データ競合を防ぐため、StateGraph Orchestratorと呼ばれるコンポーネントが単一の書き込み権限を持ち、検証された状態のみをアトミックに更新する4。このアプローチは教育工学において最も解釈可能性が高く、認知エージェントのコンパイル（Cognitive Agent Compilation）という枠組みを通じて、LLMの潜在的な知識に頼るのではなく、明示的なルールと状態に基づく堅牢なチュータリングを実現する5。しかしながら、学習者の趣味嗜好やエピソード的な記憶（例：「昨日のサッカーの試合が楽しかった」）を捉える柔軟性には欠けるという課題がある。

### **(c) ベクターストア型エピソード記憶 (Vector Store Episodic Memory)**

過去の対話や出来事をLLMが自律的にチャンク化し、ベクトル埋め込み（Embeddings）に変換してベクトルデータベースに保存・検索する手法である。Mem0やZepのベースライン機能、Hindsightなどがこれに該当する7。  
エピソード記憶は、特定の出来事（When, Where, What）をコンテキストと共に保存するものであり、「自律的意識（Autonoetic consciousness）」をAIエージェントに疑似的に付与する10。この手法の最大の強みは、「まるでAIが私のことを熟知している（AI feels like it knows me）」という強力なパーソナライゼーション体験を提供できる点にある11。Mem0のようなシステムは、ユーザーの入力から事実（Fact）や嗜好（Preference）をシングルパスで抽出し、意味的類似性（セマンティック検索）に基づいてプロンプトに動的に注入する11。一方、ベクトル検索の性質上、「以前はプログラミングが嫌いだったが今は好き」というような時間的変化を伴う矛盾を解決するのが難しく、古い事実が誤って検索されるリスク（Memory staleness）が存在する13。

### **(d) ナレッジグラフ (Knowledge Graphs)**

事実をノードとし、関係性や時間的メタデータをエッジとしてモデリングするアプローチである。ZepのGraphitiエンジンや、Mem0のグラフ機能拡張（Mem0g）が代表例である8。  
この手法は、事実がいつ真であったかという有効期間（Validity window）を追跡する双時間的モデリング（Bi-temporal modeling）を可能にし、複数ステップの推論や時間的なクエリに圧倒的な強みを持つ8。しかしながら、Neo4jやFalkorDBなどの専用グラフデータベースを運用する必要があり、セルフホスト環境におけるインフラストラクチャの複雑性とコストが指数関数的に増大する8。Mem0の場合、グラフ機能は月額249ドルのProティアに制限されている8。

| アーキテクチャのアプローチ | 主要な保存メカニズム | 教育的利点 | インフラストラクチャの要件 | 検索の特性と制約 |
| :---- | :---- | :---- | :---- | :---- |
| **(a) ローリング・スレッド・サマリー** | コンテキスト内の非構造化テキスト | 実装が容易でコンテキストを維持しやすい | 極めて低（外部DB不要） | 時間経過による致命的な情報の消失（ドリフト現象） |
| **(b) 構造化された知識状態テーブル** | PostgreSQL等のRDB、JSONB | 習熟度・誤概念の正確な追跡と論理的な指導 | 低〜中（RDBのみ） | エピソードや雑談の文脈を捉えることが困難 |
| **(c) ベクターストア型エピソード記憶** | pgvector等のベクトルデータベース | 過去の具体的なエピソードの想起による親密性の向上 | 中（RDB \+ ベクトル拡張） | 時間的な変化や矛盾の解決に課題が残る |
| **(d) ナレッジグラフ** | Neo4j等のグラフデータベース | 複雑な論理推論、時間的妥当性の追跡 | 極めて高（専用DBと運用保守が必要） | 小規模な運用ではコストと運用負荷が見合わない |

## **2\. 小規模システムにおけるコストとメリットの評価および最適アーキテクチャ**

学習者約50名、1人あたり月間約100メッセージ（システム全体で月間約5,000メッセージ）という小規模な要件下において、各アプローチのインフラ複雑性とコストパフォーマンスを評価する。  
この規模のデータ量では、独立したマネージド型のベクトルデータベース（PineconeやQdrantなど）や専用のグラフデータベース（Neo4jなど）を導入することは、運用上のオーバーヘッドがメリットを大きく上回る17。月間5,000メッセージから生成されるベクトルの数は最大でも数千から数万チャンクの範囲であり、これはPostgreSQLのpgvector拡張機能において、パフォーマンスの低下を全く起こさずに処理できる規模である。一般に、100万チャンクまでは単一のPostgreSQLとpgvectorの構成で本番環境レベルの十分な性能（HNSWインデックスによる50ms以下の検索レイテンシ）を発揮することが実証されている17。

### **「Open Brain」パターンによるエピソード記憶と構造化データの融合**

インフラの複雑性を最小限に抑えつつ、「AIが私を熟知している」という強力なパーソナライズ効果を生み出す最適解は、Supabase（PostgreSQL \+ pgvector）を単一のデータストアとして活用する「Open Brain」と呼ばれるコロケーションアーキテクチャの採用である19。  
このアーキテクチャでは、抽出された記憶に対して1から10までの「重要度スコア（Importance level）」を動的に付与する19。 学習者のコアなプロファイル（アイデンティティ、学習目標、根本的な特性）は「重要度10」、重要な教育的出来事やセッションの総括は「重要度7〜8」、日常的な雑談や一時的な観察は「重要度1〜4」としてデータベースに保存される19。さらに、過去の記憶が新たな事実によって更新された場合、物理的にデータを削除するのではなく、新しい行を挿入しparent\_idを用いて古い記憶を上書き（Supersede）することで、学習者の変容の軌跡を維持する19。  
セッションが開始されると、エージェントは「ブートシーケンス（Boot sequence）」を実行し、APIの1回の呼び出しで重要度7以上のすべての記憶をロードしてコンテキストに注入する19。対象者が50名規模であれば、重要度7以上の記憶は15〜20件程度に収まり、LLMのコンテキストウィンドウを圧迫することはない19。セッション中は、必要に応じて特定のトピックについてpgvectorのベクトル類似度検索（Cosine Distance）と、GINインデックスを用いたキーワード検索のハイブリッド検索を実行する19。この手法は、Zepのような高コストなグラフデータベースを使用せずに、時間的推論とセマンティック検索の利点を両立させることができる。

## **3\. Mem0 (v0.x) のセルフホスト環境における本番稼働評価**

Mem0はAIエージェントに長期的な記憶を提供するオープンソースフレームワークとして広く認知されているが、VercelとSupabaseのスタック上でセルフホストの本番環境（特に未成年者のデータを取り扱う環境）を構築するにあたっては、いくつかの技術的制限とアーキテクチャ上の非互換性が存在する。

### **VercelとNext.jsサーバーレスアーキテクチャとの非互換性**

Mem0のオープンソース版（v0.x）の公式リファレンス実装は、FastAPIによるREST APIサーバーを中心に、PostgreSQL（pgvector）とNeo4jの3つのDockerコンテナを常駐させるアーキテクチャを前提としている20。しかし、Vercelはステートレスなサーバーレス関数の実行環境であり、WebSocketsのサポート欠如や、長時間のバックグラウンドプロセスを実行できないという制限（通常10秒から最大60秒のタイムアウト）がある22。Mem0のデフォルトの記憶抽出パイプラインは、「ユーザー入力の受け取り」→「LLMによる事実の抽出」→「ベクトル埋め込みの生成」→「データベースへの書き込み」という一連の処理を同期的に行うため、Vercelのタイムアウト制限に抵触するリスクが極めて高い22。  
したがって、Vercel環境でMem0を利用する場合、Dockerによるフルスタックのホスティングは不可能であり、Vercel AI SDK用のプロバイダー（@mem0/vercel-ai-provider）やPython SDKをアプリケーションコードに直接インポートし、バックエンドのベクトルストアとして外部のSupabaseを直接参照する「ライブラリモード」での実装が必須となる25。

### **Supabaseハードウェア要件とインデックス設計**

Supabaseをベクトルストアとして利用する場合、インフラストラクチャのセットアップ自体は極めてシンプルである。SQLエディタからvector拡張を有効化し、1536次元（OpenAIの埋め込みモデルを利用する場合）のembeddingカラムを持つテーブルを作成するだけで完了する25。インデックス手法については、メモリ消費が少ない段階では、速度とメモリのバランスが良いivfflatか、検索速度に特化したhnsw（Hierarchical Navigable Small World）を選択し、距離計算にはcosine\_distanceを使用する設計が推奨される25。対象者が50名程度であれば、Supabaseの無料枠（Free tier）のコンピュートリソースでも十分なレスポンスタイムを維持できる27。

### **学生データにおける重大な既知の制限とプライバシーリスク**

セルフホスト版のMem0には本番環境レベルの認証システムやユーザーログイン機能が内蔵されていない29。Mem0のマルチテナント分離は、データベースのクエリ実行時にPythonレイヤーでuser\_idというメタデータをフィルタリングすることによってのみ実現されている11。 CrewAIなどのコミュニティフォーラムでも頻繁に報告されている通り、アプリケーションコード側でこのuser\_idのスコープ設定に少しでも不備があれば、別のユーザーの記憶コンテキストが別のユーザーに漏洩する（Context bleeding）という致命的なバグを引き起こす30。未成年者の機密データを扱う教育アプリケーションにおいて、この設計はFERPA（家族教育の権利とプライバシー法）などのコンプライアンス要件を満たさない可能性が高い。  
この問題を解決するためには、Mem0のアプリケーション層のフィルタリングに依存するのではなく、Supabaseの行レベルセキュリティ（RLS: Row Level Security）を直接適用する必要がある。データベース層で認証されたユーザーのJWTトークンに基づいて行へのアクセスを物理的に遮断することで、アーキテクチャの安全性を担保できる17。

## **4\. セッションサマリーアプローチの実践的運用メカニズム**

ローリング・スレッド・サマリーの欠点を補いつつ、コンテキストの維持とコスト削減を両立させるためには、プロンプトエンジニアリングと実行タイミングを高度に制御した「セッションメモリ圧縮（Session Memory Compaction）」の実装が不可欠である。

### **LLMが要約を生成するタイミングとバックグラウンド処理**

コンテキストウィンドウが限界に達した瞬間に同期的に要約を生成する反応的（Reactive）な手法は、ユーザーに長時間の待機レイテンシを強制するため実用的ではない32。本番環境における最適解は「プロアクティブなインスタント圧縮（Instant Compaction）」である。一定のトークン数（例：約10,000トークン）に到達した時点、または特定のタスクが完了した自然な区切りにおいて、バックグラウンドの非同期処理（Pythonのthreading.ThreadやVercelのバックグラウンド関数）として要約タスクを起動する32。これにより、メインの対話ループを阻害することなく、コンテキストが限界に達した瞬間に、即座に事前構築された要約メモリと履歴をスワップすることが可能となる32。

### **要約フォーマットの構造とプロンプト設計**

教育的文脈において、LLMに自由記述の要約を許可すると、重要な学習プロセスの詳細が欠落する。そのため、厳格なMarkdownフォーマットと分析指示を与える必要がある。具体的には、LLMに対して\<think\>タグ内での事前の論理分析を強制し、以下の構造で出力を生成させる32。

* **\#\# User Intent**: 学習者の当初の目標や、途中で変化した意図の正確な引用。  
* **\#\# Completed Work**: 完了した学習内容や習得した概念。  
* **\#\# Errors & Corrections**: これが最も重要なセクションである。遭遇したエラー、失敗したアプローチ、学習者による自己訂正やチューターからの指導内容をそのまま保存する。これにより、次回以降のセッションで同じ誤った指導を繰り返す事態を防ぐ。  
* **\#\# Active Work & Pending Tasks**: 現在進行中で未完了の課題やタスク。

### **次回セッションでのシステムプロンプトへの注入とコスト最適化**

生成された要約は、次回セッションの開始時にシステムプロンプトの先頭に注入される。  
一般的な注入フォーマットは以下の通りである。  
*"This session is being continued from a previous conversation. Here is the session memory: {session\_memory}. Continue from where we left off."*  
32  
この手法の最大の懸念は、毎回巨大な要約テキストをシステムプロンプトに含めることで発生するトークンコストの増大である。これを解決するために、Anthropic Claudeなどで提供されている「プロンプトキャッシング（Prompt Caching）」を利用する32。要約を含むシステムプロンプトのブロックに一時的なキャッシュ制御マーカー（cache\_control: {"type": "ephemeral"}）を付与することで、バックグラウンドでのメモリ更新にかかるコストを約80%削減し、推論のレイテンシを劇的に改善できる32。

## **5\. 主要EdTech製品におけるパーソナライゼーションとメモリアーキテクチャ事例**

教育業界の先駆的製品が、LLMのパーソナライゼーションとメモリアーキテクチャをどのように本番環境に統合しているかを分析することは、小規模システム設計においても極めて有益な洞察をもたらす。

### **Duolingo Max (Lilyのメモリ機能)**

DuolingoのGPT-4を搭載した「Video Call with Lily」機能は、エピソード記憶の統合において、ベクトルデータベースの複雑な検索パラダイムを回避する洗練された設計を採用している33。  
Duolingoのシステムは、プロンプトを「System（システムの指示・学習デザイナーの意図）」「Assistant（Lilyのペルソナ）」「User（学習者）」の3つの明確な役割に分割して管理している35。対話中に行われるメモリ検索の遅延を防ぐため、Lilyはリアルタイムでデータベースを検索することはない。その代わり、セッションが終了した直後に、トランスクリプト全体をLLMに解析させ、「学習者について学んだ重要な情報は何か？」という問いに基づいて事実を非同期で抽出する35。 抽出された情報は「事実のリスト（List of Facts）」として保存され（例：「犬を2匹飼っている」「建築を学んでいる」「タコスが好き」）、次回の通話が始まる際に、このリスト全体がSystemプロンプトに直接注入される35。これにより、Lilyは過去の会話を踏まえた自然な質問を生成し、学習者に高い親密性と継続性を感じさせることができる12。また、動的評価（Dynamic evaluation）と呼ばれる仕組みにより、会話中であっても学習者の混乱や不適切な発言を検知し、安全性を維持しつつ応答を調整している35。

### **Khan Academy (Khanmigo)**

Khanmigoは、GPT-4アーキテクチャの上に構築されたAIチューターであり、単に答えを教えるのではなく、ソクラテス式問答法を通じて学習者に思考を促すよう設計されている37。パーソナライゼーションの側面では、「Khanmigo Interests」と呼ばれる機能を導入しており、チャット履歴から学習者の趣味や関心を抽出し、それを数学の文章題や学習の文脈に織り込むことでエンゲージメントを高めている40。  
しかしながら、Learning Engineeringの専門家からは、Khanmigoのような「純粋なニューラル（連想的）アプローチ」に基づく会話型AIの構造的限界も指摘されている42。LLMはパターン認識や言語生成には優れているが、学習者の状態モデリング、誤概念の診断、カリキュラムの計画といった「構造的・論理的プロセス」の保持には適していない42。会話から抽出された興味関心のベクトル記憶だけでは、学習者が数学的スキルをどの程度習得したかという精緻な追跡は不可能である。これを解決するためには、前述のIntelliCodeのような、ニューラルネットワークの生成能力と、シンボリックな（論理的・数学的に基礎付けられた）学習者状態モデルを統合するハイブリッドアーキテクチャが今後の教育AIの必須要件となることが示唆されている4。

## **結論**

学習者50名規模、未成年者のプライバシー保護要件、そしてVercelとSupabase (pgvector) に依存するという制約のもとでは、複雑なグラフデータベース（Zep/Neo4j）やMem0のフルDockerスタックの導入は、システムに不要な技術的負債をもたらす。  
推奨される最適なアーキテクチャは以下の通りである：

1. **ハイブリッドデータストアの構築:** Supabaseの単一のPostgreSQL内で、スキルや単元ごとの習熟度を管理する構造化された「学習者状態テーブル」と、pgvectorを用いた「エピソード記憶テーブル」を共存させる。  
2. **非同期の抽出と重要度スコアリング:** Duolingoの「事実のリスト」アプローチやOpen Brainパターンに倣い、セッション終了後にバックグラウンドタスク（Vercel非同期処理）でLLMを用いて事実を抽出し、1〜10の重要度スコアと共にSupabaseに保存する。  
3. **RLSによる厳格なプライバシー保護:** Mem0のアプリケーション層のuser\_idフィルタリングに依存せず、Supabaseの行レベルセキュリティ（RLS）を適用し、データベース層で他者のデータへのアクセスを物理的に遮断することで、機密データを保護する。  
4. **プロアクティブなコンテキスト注入:** セッション開始時に重要度が高い事実や、過去のセッションの構造化要約をシステムプロンプトに一括でロードし、プロンプトキャッシングを活用することで、検索レイテンシを排除しつつ、連続性のある高度なチュータリング体験を実現する。

#### **引用文献**

1. Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers, [https://arxiv.org/html/2603.07670v1](https://arxiv.org/html/2603.07670v1)  
2. A Practical Guide to Memory for Autonomous LLM Agents | Towards Data Science, [https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/](https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/)  
3. Swift Context Management: A Package to efficiently handle LLM token limits and history, [https://forums.swift.org/t/swift-context-management-a-package-to-efficiently-handle-llm-token-limits-and-history/84326](https://forums.swift.org/t/swift-context-management-a-package-to-efficiently-handle-llm-token-limits-and-history/84326)  
4. IntelliCode: A Multi-Agent LLM Tutoring System with Centralized Learner Modeling \- ACL Anthology, [https://aclanthology.org/2026.eacl-demo.10.pdf](https://aclanthology.org/2026.eacl-demo.10.pdf)  
5. Cognitive Agent Compilation for Explicit Problem Solver Modeling \- arXiv, [https://arxiv.org/html/2605.07040v1](https://arxiv.org/html/2605.07040v1)  
6. Why Large Language Models Alone Fall Short for Responsible Learner Modelling in K–12 Tutoring: A Case Study \- ResearchGate, [https://www.researchgate.net/publication/406450586\_Why\_Large\_Language\_Models\_Alone\_Fall\_Short\_for\_Responsible\_Learner\_Modelling\_in\_K-12\_Tutoring\_A\_Case\_Study](https://www.researchgate.net/publication/406450586_Why_Large_Language_Models_Alone_Fall_Short_for_Responsible_Learner_Modelling_in_K-12_Tutoring_A_Case_Study)  
7. Agent Memory Infrastructure on GPU Cloud: Deploy Mem0, Zep, and Persistent Vector Memory for Production AI Agents (2026) | Spheron Blog, [https://www.spheron.network/blog/agent-memory-gpu-cloud-mem0-zep-guide/](https://www.spheron.network/blog/agent-memory-gpu-cloud-mem0-zep-guide/)  
8. Zep vs Mem0: Which AI Memory Layer Fits Your Stack? \- Atlan, [https://atlan.com/know/zep-vs-mem0/](https://atlan.com/know/zep-vs-mem0/)  
9. GBrain vs Hindsight vs Mem0 vs Zep: Memory Compared \- Vectorize, [https://vectorize.io/articles/gbrain-vs-hindsight-vs-mem0-vs-zep](https://vectorize.io/articles/gbrain-vs-hindsight-vs-mem0-vs-zep)  
10. Episodic Memory for AI Agents: How It Works and Why It Matters \- Atlan, [https://atlan.com/know/episodic-memory-ai-agents/](https://atlan.com/know/episodic-memory-ai-agents/)  
11. AI Memory Management for LLMs and Agents \- Mem0, [https://mem0.ai/blog/ai-memory-management-for-llms-and-agents](https://mem0.ai/blog/ai-memory-management-for-llms-and-agents)  
12. Revolutionary Duolingo AI Features 2025: Video Calls And Immersive Adventures Transform Language Learning \- FireXCore, [https://firexcore.com/blog/duolingo-ai-features/](https://firexcore.com/blog/duolingo-ai-features/)  
13. State of AI Agent Memory 2026: Benchmarks, Architectures & Production Gaps \- Mem0, [https://mem0.ai/blog/state-of-ai-agent-memory-2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)  
14. Solving Memory in LLMs. Thinking in human terms, the way we… | by Ayush Kapri | Medium, [https://medium.com/@ayushkapri.richard/solving-memory-in-llms-9485239b7195](https://medium.com/@ayushkapri.richard/solving-memory-in-llms-9485239b7195)  
15. Hindsight vs Zep (Graphiti): Agent Memory Compared (2026) \- Vectorize.io, [https://vectorize.io/articles/hindsight-vs-zep](https://vectorize.io/articles/hindsight-vs-zep)  
16. Zep vs RetainDB: Which AI Memory Solution Should You Choose? \- Gamgee, [https://gamgee.ai/vs/zep-vs-retaindb/](https://gamgee.ai/vs/zep-vs-retaindb/)  
17. Build a Self-Hosted RAG with Postgres pgvector: 2026 Guide \- Digital Applied, [https://www.digitalapplied.com/blog/build-self-hosted-rag-postgres-pgvector-tutorial-2026](https://www.digitalapplied.com/blog/build-self-hosted-rag-postgres-pgvector-tutorial-2026)  
18. Vector Memory for AI Agents in 2026: The Honest Comparison \- VEKTOR, [https://vektormemory.com/blog/vector-memory-for-ai-agents-2026](https://vektormemory.com/blog/vector-memory-for-ai-agents-2026)  
19. Building Persistent Memory for AI Agents: A pgvector \+ Supabase Architecture, [https://dev.to/moneylab\_ai/building-persistent-memory-for-ai-agents-a-pgvector-supabase-architecture-558n](https://dev.to/moneylab_ai/building-persistent-memory-for-ai-agents-a-pgvector-supabase-architecture-558n)  
20. AGENTS.md \- mem0ai/mem0 \- GitHub, [https://github.com/mem0ai/mem0/blob/main/AGENTS.md](https://github.com/mem0ai/mem0/blob/main/AGENTS.md)  
21. Self-Hosting Mem0: A Complete Docker Deployment Guide, [https://mem0.ai/blog/self-host-mem0-docker](https://mem0.ai/blog/self-host-mem0-docker)  
22. HippocampAI — Enterprise Memory Engine for Intelligent AI Systems, [https://hippocampai.vercel.app/](https://hippocampai.vercel.app/)  
23. Agents vs n8n \- Reddit, [https://www.reddit.com/r/n8n/comments/1rfjsmc/agents\_vs\_n8n/](https://www.reddit.com/r/n8n/comments/1rfjsmc/agents_vs_n8n/)  
24. Cortex Code \+ mem0: Self-Hosted Semantic Memory for AI Agents | by Adrian Lee Xinhan, [https://adrianleexinhan.medium.com/cortex-code-mem0-self-hosted-semantic-memory-for-ai-agents-f7ad196b3d23](https://adrianleexinhan.medium.com/cortex-code-mem0-self-hosted-semantic-memory-for-ai-agents-f7ad196b3d23)  
25. Supabase \- Mem0 Documentation, [https://docs.mem0.ai/components/vectordbs/dbs/supabase](https://docs.mem0.ai/components/vectordbs/dbs/supabase)  
26. Agents: Memory \- AI SDK, [https://ai-sdk.dev/docs/agents/memory](https://ai-sdk.dev/docs/agents/memory)  
27. pinkpixel/mem0-mcp MCP Server \- GitHub, [https://github.com/pinkpixel-dev/mem0-mcp](https://github.com/pinkpixel-dev/mem0-mcp)  
28. Why I Built My Own AI Memory Infrastructure \- Medium, [https://medium.com/@danielschwartzer/why-i-built-my-own-ai-memory-infrastructure-a7fe6bb962e9](https://medium.com/@danielschwartzer/why-i-built-my-own-ai-memory-infrastructure-a7fe6bb962e9)  
29. What are the main differences between the self-host version and the official cloud version? · mem0ai mem0 · Discussion \#3112 \- GitHub, [https://github.com/mem0ai/mem0/discussions/3112](https://github.com/mem0ai/mem0/discussions/3112)  
30. How to Fix CrewAI Memory in Production with Mem0, [https://mem0.ai/blog/crewai-memory-production-setup-with-mem0](https://mem0.ai/blog/crewai-memory-production-setup-with-mem0)  
31. omprakashnahak9/IQ: Smart campus system with AI study assistant, face recognition attendance, student/teacher portals, and admin dashboard \- GitHub, [https://github.com/omprakashnahak9/IQ](https://github.com/omprakashnahak9/IQ)  
32. Session memory compaction | Claude Cookbook, [https://platform.claude.com/cookbook/misc-session-memory-compaction](https://platform.claude.com/cookbook/misc-session-memory-compaction)  
33. Duolingo \- Filling crucial language learning gaps \- OpenAI, [https://openai.com/index/duolingo/](https://openai.com/index/duolingo/)  
34. Introducing Duolingo Max, a learning experience powered by GPT-4, [https://blog.duolingo.com/duolingo-max/](https://blog.duolingo.com/duolingo-max/)  
35. Get to know the AI behind every Video Call with Lily \- Duolingo Blog, [https://blog.duolingo.com/ai-and-video-call/](https://blog.duolingo.com/ai-and-video-call/)  
36. Duolingo: Structured LLM Conversations for Language Learning Video Calls \- ZenML, [https://www.zenml.io/llmops-database/structured-llm-conversations-for-language-learning-video-calls](https://www.zenml.io/llmops-database/structured-llm-conversations-for-language-learning-video-calls)  
37. Scaling AI in the Classroom: A Khan Academy Case Study with Khanmigo \- Origins AI, [https://originshq.com/blog/scaling-ai-at-khan-academy-case-study/](https://originshq.com/blog/scaling-ai-at-khan-academy-case-study/)  
38. How Khan Academy Leveraged AI to Change Education \- Cut The SaaS, [https://cut-the-saas.com/ai/how-khan-academy-leveraged-ai-to-change-education](https://cut-the-saas.com/ai/how-khan-academy-leveraged-ai-to-change-education)  
39. Learning nonprofit Khan Academy is piloting a version of GPT called Khanmigo, [https://www.fastcompany.com/90891522/the-learning-nonprofit-khan-academy-piloting-a-version-of-gpt-called-khanmigo](https://www.fastcompany.com/90891522/the-learning-nonprofit-khan-academy-piloting-a-version-of-gpt-called-khanmigo)  
40. You help make Khanmigo better: how we enhanced our AI tutor with your feedback, [https://blog.khanacademy.org/you-help-make-khanmigo-better-how-we-enhanced-our-ai-tutor-with-your-feedback/](https://blog.khanacademy.org/you-help-make-khanmigo-better-how-we-enhanced-our-ai-tutor-with-your-feedback/)  
41. New\! Personalized AI Learning with Khanmigo Interests \- Khan Academy Blog, [https://blog.khanacademy.org/new-khanmigo-interests/](https://blog.khanacademy.org/new-khanmigo-interests/)  
42. Blog \- The New Wave of AI Tutoring \- iTutorSoft, [https://www.itutorsoft.com/post-page/](https://www.itutorsoft.com/post-page/)