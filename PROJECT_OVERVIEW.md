# Ai-Ba（アイバ）プロジェクト概要

## プロジェクト名・コンセプト

**Ai-Ba（アイバ）**— 「AI」＋「相棒（Aibou）」の造語。Live2D キャラクターと会話できるクロスプラットフォーム対応の AI チャットアシスタントアプリ。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 19 + TypeScript + Vite 7 + Tailwind CSS 4 |
| 状態管理 | Zustand |
| Live2D 描画 | PixiJS 7 + pixi-live2d-display |
| LLM | Amazon Bedrock（Claude Haiku 4.5）Converse API + Tool Use |
| 音声合成 | Amazon Polly |
| 音声認識 | Web Speech API + VAD（Voice Activity Detection） |
| 認証 | Amazon Cognito + AWS Amplify（SRP 認証フロー） |
| バックエンド | AWS Lambda (Node.js 22) x 35関数 + API Gateway (REST + WebSocket) |
| DB | DynamoDB（GSI×2、TTL、ポイントインタイム復旧） |
| インフラ管理 | AWS CDK (TypeScript) |
| マルチプラットフォーム | Web / Tauri 2（デスクトップ）/ Capacitor 8（iOS） |
| テスト | Vitest + jsdom（719テスト / 48ファイル）+ fast-check（プロパティベーステスト） |

## 主要機能

### 1. AI チャット（コア機能）
- Live2D キャラクターが感情表現（表情）とモーション（体の動き）付きで応答
- emotion（表情）は毎回必須、motion（モーション）は省略可 — モデルの設定に応じて動的に決定
- LLM レスポンスは JSON 構造化（text, emotion, motion?, suggestedReplies, mapData）
- 音声入力（VAD 対応・自動送信）→ AI 応答 → 音声読み上げ（Polly）の一連のフロー
- Markdown レンダリング対応の応答表示

### 2. スキル（Tool Use）
LLM がユーザーの意図に応じて自動的にツールを呼び出す:
- **Google カレンダー**（予定の確認・作成）— Google OAuth 連携
- **場所検索**（Google Places API）— 地図表示付き
- **Web 検索**（Brave Search API）
- **天気予報**（Open-Meteo API）— API キー不要
- **メモ管理**（保存・検索・一覧・削除）

### 3. 3層記憶モデル

| 層 | 保存先 | 保持期間 | 用途 |
|----|--------|---------|------|
| 永久記憶 | DynamoDB `PERMANENT_FACTS` | 無期限 | FACTS（客観的事実 最大40件）+ PREFERENCES（対話設定 最大15件）各50文字 |
| 中期記憶 | Amazon Bedrock AgentCore Memory | 30日 | 会話トピック・コンテキスト（セマンティック検索） |
| 短期記憶 | DynamoDB `SESSION#` + `MSG#` | 7日（TTL） | セッション内会話履歴・ローリング要約・チェックポイント |

#### 3-1. 永久記憶（Permanent Memory）

**保存先**: DynamoDB `PK=USER#{userId}`, `SK=PERMANENT_FACTS`
**形式**: 2カテゴリに分離して保存

| カテゴリ | DynamoDB属性 | 上限 | 統合閾値 | 内容 |
|---------|-------------|------|---------|------|
| FACTS | `facts` (List型) | 40件 | 30件 | ユーザーの客観的事実（48カテゴリ） |
| PREFERENCES | `preferences` (List型) | 15件 | 12件 | AIとの対話スタイル設定 |

各項目は50文字以内の文字列。

**FACTS 抽出対象（48カテゴリ）**:
- 基本属性（生年月日/年齢/血液型/国籍/出身地）
- 居住（居住地/住居形態/最寄り駅/同居人）
- 家族（婚姻/配偶者/子供/両親/兄弟/ペット/記念日）
- 仕事（勤務先/職種/業界/勤務形態/通勤/副業）
- 学歴・資格（学歴/資格/学習中スキル）
- 健康（アレルギー/持病/服薬/食事制限/視力/身体的制約）
- 生活（生活リズム/喫煙飲酒/運動/車両/交通手段/宗教）
- 嗜好・価値観（食の好み/音楽/趣味/苦手/価値観）
- 経済（家計方針/経済目標）
- その他（言語/行きつけ/人生イベント/利き手）

**PREFERENCES 抽出対象**:
- 呼び方の希望（「○○と呼んで」「敬語で話して」「タメ口でいい」）
- 応答スタイルの好み（「詳しく説明して」「簡潔に」「例を多く」）
- 話題の好み（「政治の話はしないで」「毎朝天気を教えて」）
- AIへの要望（「褒めて」「厳しく」「冗談を入れて」）

**関連人物の抽出**: ユーザー自身だけでなく、会話に登場する重要な他者（家族、恋人、友人、ペットなど）の名前・関係性・好み・状況も積極的に抽出
- 例: 「妻の花子はガーデニングが趣味」「柴犬のポチを飼っている」

**状況変化の検出**: 記録済み内容から状況が変化・進展している場合は、最新の事実として抽出
- 例: 「転職活動中」→「株式会社○○に就職」

**抽出しない情報**: 一時的な興味、その場限りの希望、相談内容そのもの

**抽出タイミング**: セッション終了時に自動抽出
- EventBridge `rate(15 minutes)` → `sessionFinalizer` Lambda
- `ACTIVE_SESSION` レコードの `updatedAt` が30分以上前 → セッション終了と判定
- `extractFacts` Lambda を非同期起動（`InvocationType: 'Event'`）

**抽出ロジック** (`extractFacts.ts`):
1. 対象セッションの全メッセージを DynamoDB から取得
2. 既存の永久記憶を取得（facts + preferences、重複排除のため）
3. Haiku 4.5 に「既に記録済みの FACTS/PREFERENCES + 会話テキスト」を送信
4. **JSON出力**: `{"facts":["事実1","事実2"],"preferences":["設定1","設定2"]}` 形式で抽出
5. 1回最大: FACTS 10個、PREFERENCES 5個。ユーザーが明言した内容のみ（推測は含めない）
6. 既存とマージ、カテゴリ別に統合閾値チェック → LLM で自動統合（60〜70%に圧縮）
7. 上限を超えたら古いものから押し出し（統合後のフォールバック）
8. `ACTIVE_SESSION` レコードを削除

**JSONパースのフォールバック**: LLM が JSON を出力できなかった場合、旧フォーマット（1行1事実）として全て FACTS 扱いで取り込む

**マージ時の重複排除**: `Set` による完全一致の重複排除を実施（LLM統合の無駄な発動を防止）

**自動統合（consolidation）**:
- カテゴリ別に独立して実行（FACTS: 30件以上、PREFERENCES: 12件以上で発動）
- Haiku 4.5 に統合プロンプトを送信し、意味的に関連する項目をマージ
- リストは時系列順（末尾が最新）で提供され、以下のルールで統合:
  - **表現揺れの統合**: 同じ内容の異なる表現（例: "東京在住" と "東京に住んでいる"）→ より具体的で簡潔な1表現にマージ
  - **矛盾・時間的変化の解決**: 最新（リスト末尾側）の情報を正として古い情報を破棄・更新
  - **関連情報の統合**: 意味的に関連する複数の事実を1つの論理的な文に統合
- コアアイデンティティ情報（家族/健康/仕事）は統合時も削除しない
- Few-shot 例示で出力安定性を確保
- 統合結果が不正（0件 or 元の件数超過）の場合はフォールバック（元のリスト維持）

**プロンプト注入**: キャッシュブロック2（ユーザー固有）に2タグで注入
```
<permanent_profile>
ユーザーについて知っている事実：
- 東京都在住
- 妻と2人暮らし
- ソフトウェアエンジニア
</permanent_profile>

<user_preferences>
ユーザーが希望するAIとの対話スタイル：
- タメ口で話してほしい
- 返事は簡潔に
</user_preferences>
```

#### 3-2. 中期記憶（AgentCore Memory）

**保存先**: Amazon Bedrock AgentCore Memory（`MEMORY_ID` で識別）
**名前空間**: `user/{userId}`
**保持期間**: 30日（AgentCore のデフォルト）
**ストラテジー**: `SEMANTIC` + `USER_PREFERENCE`

**書き込み**: フロントエンドから fire-and-forget で `POST /memory/events`
- 各会話ターン（user + assistant メッセージ）を `CreateEventCommand` で送信
- `conversational` 形式（role: USER/ASSISTANT, content: text）
- AgentCore が内部で自動要約・セマンティックインデックスを構築

**読み出し**: LLM Lambda 内で `RetrieveMemoryRecordsCommand` を使用
- ユーザーの最新メッセージを `searchQuery` としてセマンティック検索
- `maxResults: 10` 件取得
- 永久記憶との重複排除: FACTS + PREFERENCES 両方に対して空白除去した部分文字列一致で判定（`deduplicateRecords`）

**プロンプト注入**: `<user_context>` タグで動的コンテキスト（キャッシュ対象外）に含める
```
<user_context>
あなたが過去の会話から覚えていること：
- ユーザーは最近転職活動をしている
- 来月の旅行で京都に行く予定
</user_context>
```

#### 3-3. 短期記憶（Session Context）

**保存先**: DynamoDB（7日 TTL）
**構成要素**:

| 要素 | DynamoDB キー | 内容 |
|------|-------------|------|
| セッションレコード | `PK=USER#{userId}`, `SK=SESSION#{sessionId}` | `summary`（ローリング要約）、`turnsSinceSummary`、`totalTurns` |
| メッセージ | `PK=USER#{userId}#SESSION#{sessionId}`, `SK=MSG#{timestamp}#{role}` | `role`, `content`, `createdAt` |
| チェックポイント | `PK=USER#{userId}#SESSION#{sessionId}`, `SK=SUMMARY_CP#{timestamp}` | `summary`, `keywords[]` |
| テーマメッセージ | `PK=USER#{userId}#THEME#{themeId}`, `SK=MSG#{timestamp}#{role}` | 同上（テーマ別名前空間） |

**ローリング要約** (`summarize.ts`):
- **トリガー**: 5ターンごとに chat Lambda が非同期起動（`InvocationType: 'Event'`）
- **処理**: Haiku 4.5 に「前回の要約 + 新しい会話」を送信 → 500文字以内の統合要約を生成
- **セグメント要約**: 同時に当該区間のみのキーワード（2〜3個）+ 300文字以内の要約を生成 → チェックポイントとして保存
- **セッションレコード更新**: `summary`, `turnsSinceSummary=0`, `lastSummarizedAt` を書き戻し

**LLM への提供**:
- 直近10メッセージ: `getSessionContext()` で `MSG#` をソートキー降順で取得 → Converse API の messages に含める
- ローリング要約: `<current_session_summary>` タグで動的コンテキストに含める
- チェックポイント: `<session_checkpoints>` タグで時系列表示（`[MM/DD HH:MM キーワード] 要約`）

**過去セッション要約** (`getRecentSessionSummaries`):
- 直近7日間の他セッションの要約を日付グループ化して `<past_sessions>` タグに含める
- 今日/昨日/日付ラベルを付与、日付降順・日内は時系列順

#### 3-4. セッション終了検出

```
EventBridge rate(15 minutes) → sessionFinalizer Lambda
  ↓ ACTIVE_SESSION レコードを全件 Query
  ↓ updatedAt が30分以上前のセッションを検出
  ↓ extractFacts Lambda を非同期起動（userId, sessionId, themeId?）
  ↓ ACTIVE_SESSION レコードは extractFacts 完了後に削除
```

**ACTIVE_SESSION レコード**: `PK=ACTIVE_SESSION`, `SK={userId}#{sessionId}` or `{userId}#theme:{themeId}`
- chat Lambda が各ターンで upsert（TTL: 24時間）
- sessionFinalizer が走査して30分非アクティブなものを検出

#### 3-5. 記憶のシステムプロンプト内配置

```
[キャッシュブロック2: ユーザー固有]
  <user_profile>        ← ユーザー名・性別等（DynamoDB SETTINGS）
  <permanent_profile>   ← 永久記憶 FACTS（DynamoDB PERMANENT_FACTS.facts）
  <user_preferences>    ← 永久記憶 PREFERENCES（DynamoDB PERMANENT_FACTS.preferences）
  ── cachePoint ──

[動的コンテキスト: キャッシュなし]
  <current_datetime>         ← 現在日時
  <user_location>            ← GPS 位置情報
  <user_context>             ← 中期記憶（AgentCore Memory セマンティック検索結果）
  <past_sessions>            ← 過去セッション要約（直近7日、日付グループ化）
  <current_session_summary>  ← 現セッションのローリング要約
  <session_checkpoints>      ← チェックポイント（キーワード付き区間要約）
```

#### 3-6. フロントエンド→バックエンド間のデータフロー（記憶関連）

```
フロントエンド送信: { message, sessionId }  ← コンテキスト情報なし（バックエンドが全て構築）

バックエンドの並列取得（Promise.all）:
  1. AgentCore Memory 検索（中期記憶）← ユーザーメッセージを searchQuery に使用
  2. DynamoDB PERMANENT_FACTS（永久記憶: facts + preferences）
  3. DynamoDB SETTINGS → UserProfile
  4. DynamoDB GLOBAL_MODEL#{modelId} → ModelMeta

逐次取得:
  5. getSessionContext（セッション要約 + 直近10メッセージ + チェックポイント）
  6. getRecentSessionSummaries（過去7日のセッション要約）

レスポンス後の非同期処理:
  - メッセージ保存（DynamoDB MSG#）
  - ターンカウント更新 → 5ターンで要約 Lambda 非同期起動
  - ACTIVE_SESSION upsert
  - フロントエンドから fire-and-forget: POST /memory/events（AgentCore Memory 書き込み）
```

### 4. トピック管理
- 会話をトピック別に整理・保存
- LLM による自動トピック命名
- メッセージ履歴の閲覧・手動リネーム

### 5. グループチャット
- フレンドコードによるフレンド追加
- グループ作成・メンバー管理
- WebSocket によるリアルタイムメッセージング

### 6. マルチモデル管理・キャラクター設定反映
- 管理画面から Live2D モデルのアップロード・キャラクター設定・マッピング設定が可能
- **キャラクター設定**: 構造化フィールド（名前/性格/話し方）→ LLM システムプロンプトに自動反映
- **感情マッピング**: emotion → 表情名。LLM の emotion 候補リスト + フロントエンド表情変更に使用
- **モーションマッピング**: モーションタグ → group/index。LLM が motion を返すとモーション再生（省略可）
- 開発者モードのモーション/表情ボタンも管理画面設定を反映
- アイドル自律行動: motion1〜motion6 の設定済みモーションからランダム再生（15秒後初回→100秒後30秒間隔ループ）
- S3 + CloudFront CDN 配信

### 7. MCP（Model Context Protocol）連携
- 外部 MCP サーバーとの接続
- LLM が MCP ツールを動的に利用可能

### 8. プロアクティブ・ブリーフィング
- アプリ起動時・バックグラウンド復帰時に AI がカレンダー・天気・記憶をもとに自発的に話しかける
- フロントエンド駆動: `useBriefing` hook（認証完了後3秒 / visibilitychange / 30分ポーリング）
- バックエンド: `__briefing__` センチネルメッセージ検出 → カレンダー＋天気を事前自動取得 → 専用プロンプトで応答生成
- ブリーフィングメッセージは DynamoDB に保存しない（揮発的な挨拶）
- トリガー条件: JST 6:00〜23:00、前回から3時間以上経過

### 9. 天気アイコン表示
- ユーザーの現在地に基づき、Live2D キャンバス左上に天気アイコン + 気温を常時表示
- LLM 不使用: フロントエンドから Open-Meteo API を直接呼び出し（APIキー不要）
- SVG 線画スタイルのアイコン（WMO 天気コード対応: 晴/曇/雨/雪/雷等 + 昼夜判定）
- 30分ポーリングで自動更新

### 10. セキュリティ設計
- システムプロンプトはバックエンド（Lambda）で完全生成。フロントエンドに漏洩しない
- API キーは SSM Parameter Store で管理
- Prompt Caching（cachePoint 2箇所）でコスト最適化
- デバッグ情報は管理者のみ閲覧可能

## アプリケーション構成

```
butler-assistant-app/     ← メインアプリ（React + Vite）
├── コンポーネント 34個 / サービス 20個 / フック 10個 / ストア 3個
├── プラットフォーム抽象化（Web / Tauri / Capacitor）
├── Live2D レンダリング + フェイストラッキング（MediaPipe + Kalidokit）
└── PoC（音声認識、GPS、感情分析、フェイストラッキング等）

butler-admin-app/         ← 管理画面（React + Cognito TOTP MFA）
├── ユーザー管理（一覧・詳細・ロール制御）
├── Live2D モデル管理（アップロード・マッピング・プレビュー）
└── CloudFront + S3 ホスティング

infra/                    ← AWS インフラ（CDK）
├── Lambda 35関数（LLM, スキル, テーマ, 会話, フレンド, グループ, 管理等）
├── DynamoDB / Cognito / API Gateway / EventBridge / AgentCore Memory
└── CloudFront + S3（管理画面 + モデル CDN）

aiba-extension/           ← Chrome 拡張機能（Manifest V3）
├── Meeting Noter（会議の自動文字起こし + AI 議事録 + トピック保存）
├── 仮想カメラ（フェイストラッキング → Live2D → カメラ配信）
└── Ai-Ba アプリとの認証連携（Cognito トークン共有）
```

## ディレクトリ構造（詳細）

```
butler-assistant-app/          # フロントエンド（React + Vite + TypeScript）
├── src/
│   ├── auth/               # 認証（Cognito + AWS Amplify）
│   ├── components/         # React コンポーネント 34個（PascalCase.tsx）
│   │   ├── ChatUI.tsx          # メインチャットUI
│   │   ├── ThemeChat.tsx       # トピック別チャット
│   │   ├── GroupChat.tsx       # グループチャット
│   │   ├── Live2DCanvas.tsx    # Live2D モデル描画
│   │   ├── ModelSelector.tsx   # モデル選択
│   │   ├── StudioCamera.tsx    # スタジオカメラ（フェイストラッキング）
│   │   ├── AibaScreen.tsx      # メイン画面
│   │   ├── ThemeScreen.tsx     # トピック画面
│   │   ├── MemoScreen.tsx      # メモ画面（展開時Markdownレンダリング）
│   │   ├── MapView.tsx         # 地図表示（Leaflet）
│   │   ├── Settings.tsx        # 設定画面
│   │   ├── WorkBadge.tsx       # MCP接続バッジ
│   │   ├── WeatherOverlay.tsx  # 天気アイコン+気温オーバーレイ
│   │   └── ...                 # モーダル、ナビゲーション等
│   ├── hooks/              # カスタムフック 10個
│   │   ├── useSpeechRecognition.ts  # 音声認識（Web Speech API）
│   │   ├── useVAD.ts               # Voice Activity Detection
│   │   ├── useCamera.ts            # カメラ制御
│   │   ├── useGeolocation.ts       # 位置情報取得
│   │   ├── useWebSocket.ts         # WebSocket 通信
│   │   ├── useGroupPolling.ts      # グループチャット ポーリング
│   │   ├── useThemePolling.ts      # トピック ポーリング
│   │   ├── useQRScanner.ts         # QR コード読み込み
│   │   ├── useBriefing.ts          # プロアクティブ・ブリーフィング
│   │   └── useWeatherIcon.ts       # 天気アイコン表示（Open-Meteo API）
│   ├── services/           # ビジネスロジック 19個（camelCase.ts）
│   │   ├── llmClient.ts        # LLM (Bedrock Claude) 通信
│   │   ├── chatController.ts   # チャットコントローラー
│   │   ├── responseParser.ts   # LLM レスポンスパーサー
│   │   ├── live2dRenderer.ts   # Live2D レンダリング
│   │   ├── modelLoader.ts      # Live2D モデル読み込み
│   │   ├── motionController.ts # モーション制御
│   │   ├── ttsService.ts       # 音声合成 (Amazon Polly)
│   │   ├── themeService.ts     # トピック管理
│   │   ├── memoService.ts      # メモ管理
│   │   ├── friendService.ts    # フレンド管理
│   │   ├── groupService.ts     # グループ管理
│   │   ├── workService.ts      # MCP接続管理
│   │   ├── briefingService.ts  # ブリーフィングトリガー管理
│   │   └── ...
│   ├── stores/             # Zustand 状態管理 3個
│   │   ├── appStore.ts         # メッセージ、モーション、設定（persist有）
│   │   ├── themeStore.ts       # トピック一覧、アクティブトピック
│   │   └── groupChatStore.ts   # フレンド、グループ、WS接続状態
│   ├── types/              # 型定義 10ファイル（エラークラス、サービスIF等）
│   ├── platform/           # プラットフォーム抽象化（Web / Tauri / Capacitor）
│   ├── lib/live2d/         # Live2D Cubism SDK ラッパー
│   ├── utils/              # ユーティリティ（performance, dateFormat）
│   └── poc/                # 実験・検証ページ（フェイストラッキング、GPS、STT等）
├── public/models/          # Live2D モデルファイル
├── src-tauri/              # Tauri 2 デスクトップ設定
└── ios/                    # Capacitor 8 iOS

butler-admin-app/              # 管理画面（React + Cognito TOTP MFA）
├── src/components/         # コンポーネント 12個
│   ├── UserTable.tsx           # ユーザー一覧
│   ├── UserDetail.tsx          # ユーザー詳細
│   ├── ModelManagement.tsx     # Live2Dモデル管理
│   ├── ModelCharacterEditor.tsx # キャラクター編集
│   ├── ModelMappingEditor.tsx  # 感情・モーション マッピング
│   ├── ModelPreview.tsx        # モデルプレビュー
│   └── ...
├── src/auth/               # 認証（Cognito TOTP MFA）
└── src/services/           # 管理API クライアント

infra/
├── lib/butler-stack.ts     # AWS インフラ定義（CDK）
└── lambda/
    ├── llm/                # LLM チャット
    │   ├── chat.ts             # メインハンドラー（システムプロンプト生成・Prompt Caching）
    │   ├── skills/             # スキル実装 7ファイル
    │   │   ├── toolDefinitions.ts  # ツール定義
    │   │   ├── index.ts            # スキルルーティング
    │   │   ├── googleCalendar.ts   # Googleカレンダー
    │   │   ├── places.ts           # 場所検索（Google Places）
    │   │   ├── webSearch.ts        # Web検索（Brave Search）
    │   │   ├── weather.ts          # 天気予報（Open-Meteo）
    │   │   └── tokenManager.ts     # Google OAuth トークン管理
    │   ├── summarize.ts        # ローリング要約（Haiku 4.5）
    │   ├── extractFacts.ts     # 永久事実抽出（Haiku 4.5）
    │   └── sessionFinalizer.ts # セッション終了検出（EventBridge 15分）
    ├── themes/             # トピック管理（create, list, delete, update, messages）
    ├── friends/            # フレンド管理（generateCode, getCode, link, list, unfriend）
    ├── groups/             # グループ管理（create, addMember, leave, members）
    ├── conversations/      # グループチャット会話（list, messagesList, messagesSend, messagesPoll, messagesRead）
    ├── ws/                 # WebSocket（authorizer, connect, disconnect）
    ├── mcp/                # MCP管理（connect, disconnect, status, registry）
    ├── skills/             # OAuth 管理（callback, connections, disconnect）
    ├── memory/             # 中期記憶イベント保存（AgentCore Memory）
    ├── memos/              # メモ管理（save, list, delete）
    ├── settings/           # 設定 get/put
    ├── messages/           # メッセージ list/put
    ├── tts/                # 音声合成（Amazon Polly）
    ├── admin/              # 管理機能（me, usersList, usersDetail, usersRole, models/*)
    ├── models/             # モデル一覧（ユーザー向け）
    ├── meeting-noter/      # ミーティングノート
    └── transcribe/         # 音声ストリームURL

aiba-extension/            # Chrome 拡張機能（Manifest V3）
├── manifest.json           # 拡張マニフェスト
├── background.js           # バックグラウンドスクリプト
├── popup.html/js           # ポップアップUI（自動セットアップ）
├── tool-noter.js           # ミーティングノーター（文字起こし + AI議事録 + トピック保存）
├── tool-camera.js          # 仮想カメラ（フェイストラッキング → Live2D）
├── toolbar.js/css          # ツールバー
└── offscreen.html/js       # オフスクリーン処理（音声）
```

## システムプロンプト構造（XML タグ + Prompt Caching）

```
[キャッシュブロック1: 全ユーザー共通（モデル設定反映済み）]
  <ai_config>       キャラクター設定（モデルメタ or デフォルト）・共通ルール・感情選択基準
  <skills>          ツール使用ルール（カレンダー、天気、検索、メモ等）
  <response_format>  JSON 出力形式指示（motion はモデル設定時のみ含む）
  ── cachePoint ──

[キャッシュブロック2: ユーザー固有]
  <user_profile>        ユーザー名・性別・AI名
  <permanent_profile>   永久記憶 FACTS（客観的事実）
  <user_preferences>    永久記憶 PREFERENCES（対話スタイル設定）
  ── cachePoint ──

[動的コンテキスト: キャッシュなし]
  <current_datetime>         現在日時
  <user_location>            GPS 位置情報
  <user_context>             中期記憶（AgentCore Memory）
  <past_sessions>            過去セッション要約
  <current_session_summary>  現セッション要約
  <session_checkpoints>      チェックポイント
  <theme_context>            トピック情報
  <category_context>         カテゴリ別プロンプト
  <work_context>             MCP 接続情報
```

## クライアント・サーバー通信仕様

### チャット API（メイン通信）

**エンドポイント**: `POST /llm/chat`
**認証**: Cognito JWT（`Authorization: Bearer {idToken}`）
**Lambda タイムアウト**: 90秒
**通信方式**: 同期 HTTP（非ストリーミング）— フロントエンドは fetch でリクエストし、レスポンス全体を待つ

#### リクエストボディ

```json
{
  "message": "ユーザーのメッセージ（必須）",
  "sessionId": "セッションID（フロントエンド生成UUID）",
  "imageBase64": "画像のBase64文字列（任意、上限5MB）",
  "themeId": "トピックID（トピックチャット時のみ）",
  "userLocation": { "lat": 35.68, "lng": 139.76 },
  "modelKey": "haiku|sonnet|opus（デフォルト: haiku）",
  "selectedModelId": "Live2DモデルID（キャラ設定取得用）",
  "includeDebug": true
}
```

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `message` | ○ | ユーザーメッセージ。ブリーフィング時は `__briefing__` |
| `sessionId` | △ | フロントで生成した UUID。未指定時はセッション管理なし |
| `imageBase64` | × | 画像添付（Bedrock に画像として送信） |
| `themeId` | × | トピック別チャット時。メッセージの名前空間が変わる |
| `userLocation` | × | GPS座標。場所検索・天気のコンテキストに使用 |
| `modelKey` | × | LLMモデル選択（haiku/sonnet/opus）。未指定=haiku |
| `selectedModelId` | × | DynamoDB `GLOBAL_MODEL#{id}` からキャラ設定を取得 |
| `includeDebug` | × | `true` でシステムプロンプトをレスポンスに含める（管理者のみ） |

#### レスポンスボディ

```json
{
  "content": "{\"text\":\"回答テキスト\",\"emotion\":\"happy\",\"motion\":\"happy\",\"suggestedReplies\":[\"はい\",\"いいえ\"]}",
  "enhancedSystemPrompt": "（includeDebug時のみ）",
  "sessionSummary": "セッション要約テキスト",
  "permanentFacts": ["事実1", "事実2"],
  "permanentPreferences": ["設定1"],
  "themeName": "自動生成トピック名",
  "workStatus": { "active": true, "expiresAt": "ISO8601", "toolCount": 3 }
}
```

| フィールド | 常時 | 説明 |
|-----------|------|------|
| `content` | ○ | LLM の生出力（JSON文字列）。フロントでパースする |
| `enhancedSystemPrompt` | × | デバッグ用の完全システムプロンプト |
| `sessionSummary` | × | 要約が存在する場合のセッション要約 |
| `permanentFacts` | × | 永久記憶 FACTS（存在する場合） |
| `permanentPreferences` | × | 永久記憶 PREFERENCES（存在する場合） |
| `themeName` | × | 新規トピック時の自動命名結果 |
| `workStatus` | × | MCP接続状態 |

#### `content` 内部の JSON 構造（LLM 出力）

```json
{
  "text": "回答テキスト（Markdown可）",
  "emotion": "happy",
  "motion": "happy",
  "mapData": { "center": { "lat": 35.68, "lng": 139.76 }, "zoom": 15, "markers": [...] },
  "suggestedTheme": { "themeName": "テーマ名" },
  "suggestedReplies": ["はい", "いいえ"],
  "topicName": "トピック名"
}
```

| フィールド | 常時 | 説明 |
|-----------|------|------|
| `text` | ○ | 応答テキスト。Markdown記法対応 |
| `emotion` | ○ | 表情タグ。モデルの emotionMapping に応じて動的決定 |
| `motion` | × | モーションタグ。motionMapping 設定時のみ LLM が出力可能 |
| `mapData` | × | 場所検索結果の地図データ（search_places 使用時） |
| `suggestedTheme` | × | メイン会話でのトピック提案（トピックチャット時は不含） |
| `suggestedReplies` | × | クイックリプライ候補（2〜4個、各10文字以内） |
| `topicName` | × | 新規トピック時の LLM 生成名 |

#### フロントエンドでのレスポンスパース処理

```
1. content からマークダウンコードブロック（```json ... ```）を除去
2. extractBalancedJson() でネスト対応の JSON 抽出（貪欲正規表現ではなくブレース深度カウント）
3. JSON.parse → StructuredResponse 型にキャスト
4. motion/emotion のデフォルト値補完（motion='idle', emotion='neutral'）
5. text 内に混入した suggestedReplies JSON を検出・除去して parsed に移動
6. Lambda レスポンスのメタデータ（enhancedSystemPrompt, sessionSummary 等）を統合
7. パース失敗時: content 全体を text として扱うフォールバック
```

### バックエンドの処理フロー（Tool Use ループ）

```
1. リクエストパース + バリデーション
2. 並列取得（Promise.all）:
   - AgentCore Memory セマンティック検索（中期記憶）
   - DynamoDB PERMANENT_FACTS（永久記憶: facts + preferences）
   - DynamoDB SETTINGS（ユーザープロフィール）
   - DynamoDB GLOBAL_MODEL#{id}（モデルメタ: キャラ設定/感情/モーション）
3. システムプロンプト構築（3ブロック + cachePoint 2箇所）
4. セッションコンテキスト取得（要約 + 直近10メッセージ + チェックポイント）
5. Bedrock Converse API 呼び出し（Tool Use ループ、最大5回）
   ↓ stopReason === 'tool_use' の場合:
     - ツール実行（カレンダー/場所検索/Web検索/天気/メモ/MCP）
     - ツール結果を messages に追加して再呼び出し
   ↓ stopReason === 'end_turn' の場合:
     - テキストレスポンスを抽出
6. 後処理:
   - メッセージ保存（DynamoDB MSG#）
   - ターンカウント更新 → 5ターンで要約 Lambda 非同期起動
   - ACTIVE_SESSION upsert（TTL: 24時間）
   - 新規トピック時の自動命名
7. レスポンス返却
```

### Bedrock 推論設定

| モデル | モデルID | maxTokens | maxTokens(画像) | temperature |
|--------|---------|-----------|----------------|-------------|
| haiku | `jp.anthropic.claude-haiku-4-5-20251001-v1:0` | 1024 | 2048 | 0.7 |
| sonnet | `jp.anthropic.claude-sonnet-4-6` | 2048 | 4096 | 0.7 |
| opus | `global.anthropic.claude-opus-4-6-v1` | 4096 | 4096 | 0.7 |

### TTS API

**エンドポイント**: `POST /tts/synthesize`
**通信方式**: 同期 HTTP
**処理**: フロントエンドから fire-and-forget で呼び出し（chatController から非同期実行）

```json
// リクエスト
{ "text": "読み上げテキスト", "voiceId": "Tomoko", "engine": "neural" }

// レスポンス
{ "audioContent": "base64エンコードされた音声データ" }
```

- URL を除去してから送信（`stripUrls()`）
- 前の再生を停止してから新しい音声を再生
- base64 → Uint8Array → AudioBuffer → AudioContext で再生

### メモリイベント API

**エンドポイント**: `POST /memory/events`
**通信方式**: fire-and-forget（chatController から非同期、エラーは無視）

```json
{
  "messages": [
    { "role": "user", "content": "ユーザーメッセージ" },
    { "role": "assistant", "content": "アシスタントメッセージ" }
  ]
}
```

- 各会話ターンを AgentCore Memory に送信
- AgentCore が自動で要約・セマンティックインデックスを構築

### メッセージ同期 API

**エンドポイント**: `PUT /messages`
**通信方式**: fire-and-forget（syncService から非同期）
- ユーザー/アシスタント両方のメッセージをサーバーに保存
- BroadcastChannel で他タブにも即時通知
- ID ベースの重複排除 + timestamp 順ソート

### フロントエンドの通信全体像

```
ユーザー発言
  ├─ [同期] POST /llm/chat → LLM応答待ち（最大90秒）
  │    └─ レスポンス受信後:
  │         ├─ emotion → Live2D 表情変更
  │         ├─ motion → Live2D モーション再生
  │         ├─ mapData → MapView 表示
  │         ├─ suggestedReplies → クイックリプライボタン表示
  │         └─ suggestedTheme → トピック提案バナー表示
  ├─ [非同期] POST /tts/synthesize → 音声再生（fire-and-forget）
  ├─ [非同期] PUT /messages → メッセージ保存（fire-and-forget）
  └─ [非同期] POST /memory/events → 中期記憶保存（fire-and-forget）
```

### エラーハンドリング

| HTTP | フロント側エラー型 | ユーザー表示 |
|------|-------------------|-------------|
| ネットワーク断 | `NetworkError` | 「ネットがつながらないみたい…」 |
| 429 | `RateLimitError` | 「混み合ってるみたい。少し待って…」 |
| 401/403 | `APIError` | 「認証エラーです。再ログインしてください。」 |
| 500+ | `APIError` | 「うまくいかなかった…時間をおいて…」 |
| JSONパース失敗 | `ParseError` | 「うまく返事できなかった…もう一回聞いて？」 |

- エラー時は対応する表情モーション（troubled/sad/surprised）を再生
- エラーメッセージをアシスタントメッセージとしてチャットに表示
- TTS が有効ならエラーメッセージも読み上げ

### 現在の課題（レスポンス改善の観点）

1. **同期 HTTP 方式**: レスポンス全体を待つため、ユーザーは LLM 生成完了まで何も表示されない
2. **Tool Use ループ**: ツール使用時は複数回の Bedrock 呼び出しが直列で発生し、待ち時間が増加
3. **TTS の直列化**: LLM レスポンス受信後に TTS API を呼び出すため、音声再生開始がさらに遅れる
4. **JSON パース依存**: LLM が JSON 形式で応答する必要があり、パース失敗時はフォールバックで情報が欠落

## データフロー

```
ユーザー発言（テキスト/音声）
  → chatController → Lambda /llm/chat（selectedModelId 付き）
    → DynamoDB からプロフィール・永久記憶・モデルメタデータを並列取得
    → モデルメタデータからキャラクター設定・感情/モーション候補を動的生成
    → システムプロンプト構築 + Prompt Caching
    → Bedrock Claude Haiku 4.5（Converse API + Tool Use）
    → ツール実行（カレンダー / 天気 / 検索 / メモ等）
    → レスポンス返却（text, emotion, motion?, mapData...）
  → emotion → 表情変更 / motion → モーション再生 + Polly TTS 音声再生
  → fire-and-forget: AgentCore Memory に中期記憶保存
  → 5ターンごと: ローリング要約 Lambda 非同期起動
  → 15分無操作: EventBridge → 永久事実自動抽出

プロアクティブ・ブリーフィング（起動時/復帰時）:
  useBriefing hook → chatController.requestBriefing()
    → Lambda /llm/chat（'__briefing__'）
    → カレンダー + 天気を事前自動取得 → 専用プロンプトで応答生成
    → Live2D アニメーション + TTS（DynamoDB 保存なし）

天気アイコン（LLM 不使用）:
  useWeatherIcon hook → Open-Meteo API（30分ポーリング）
    → WeatherOverlay → Live2D キャンバス左上に SVG アイコン + 気温
```

## AWS インフラ構成

| リソース | 説明 |
|---------|------|
| DynamoDB | `butler-assistant`（PK/SK + GSI×2、ポイントインタイム復旧、TTL） |
| Cognito | ユーザープール + SPA クライアント（SRP）+ 管理画面用（TOTP MFA） |
| API Gateway | REST（Cognito 認可）+ WebSocket（JWT 認証） |
| Lambda x 35 | Node.js 22 / ARM_64（デフォルト 10秒、LLM: 90秒） |
| EventBridge | `rate(15 minutes)` → sessionFinalizer |
| AgentCore Memory | 中期記憶（SEMANTIC + USER_PREFERENCE） |
| CloudFront + S3 | 管理画面ホスティング + モデル CDN |
| Bedrock | Claude Haiku 4.5（推論プロファイル: `jp.anthropic.claude-haiku-4-5-20251001-v1:0`） |

## 規模

| 項目 | 数量 |
|------|------|
| フロントエンド コンポーネント | 34個 |
| カスタムフック | 10個 |
| サービス | 20個 |
| Zustand ストア | 3個 |
| Lambda 関数 | 35個 |
| LLM スキル | 7種（カレンダー×2、場所検索、Web検索、天気、メモ×4） |
| テスト | 719テスト / 48ファイル |
| 管理画面 コンポーネント | 12個 |
| Chrome 拡張 | 10ファイル |
| 型定義ファイル | 10個 |
| 対応プラットフォーム | 3種（Web / Tauri / Capacitor iOS） |
