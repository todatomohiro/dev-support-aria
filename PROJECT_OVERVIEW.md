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
| 永久記憶 | DynamoDB `PERMANENT_FACTS` | 無期限 | ユーザーの好み・事実（最大50件×50文字） |
| 中期記憶 | Amazon Bedrock AgentCore Memory | 30日 | 会話トピック・コンテキスト（セマンティック検索） |
| 短期記憶 | DynamoDB `SESSION#` + `MSG#` | 7日（TTL） | セッション内会話履歴・ローリング要約・チェックポイント |

#### 3-1. 永久記憶（Permanent Facts）

**保存先**: DynamoDB `PK=USER#{userId}`, `SK=PERMANENT_FACTS`
**形式**: `facts` フィールドに文字列配列（List型）、最大50件、各50文字以内

**抽出タイミング**: セッション終了時に自動抽出
- EventBridge `rate(15 minutes)` → `sessionFinalizer` Lambda
- `ACTIVE_SESSION` レコードの `updatedAt` が30分以上前 → セッション終了と判定
- `extractFacts` Lambda を非同期起動（`InvocationType: 'Event'`）

**抽出ロジック** (`extractFacts.ts`):
1. 対象セッションの全メッセージを DynamoDB から取得
2. 既存の永久記憶を取得（重複排除のため）
3. Haiku 4.5 に「既に記録済みの事実 + 会話テキスト」を送信
4. 48カテゴリの抽出対象（基本属性/家族/仕事/健康/嗜好等）に該当する事実のみ抽出
5. 1回最大10個、1行1事実、ユーザーが明言した事実のみ（推測は含めない）
6. 既存事実とマージし、上限50個を超えたら古いものから押し出し
7. `ACTIVE_SESSION` レコードを削除

**抽出しない情報**: 一時的な興味、その場限りの希望、相談内容そのもの

**プロンプト注入**: `<permanent_profile>` タグでシステムプロンプトのキャッシュブロック2（ユーザー固有）に含める
```
<permanent_profile>
ユーザーについて知っている事実：
- 東京都在住
- 妻と2人暮らし
- ソフトウェアエンジニア
</permanent_profile>
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
- 永久記憶との重複排除: 空白除去した部分文字列一致で判定（`deduplicateRecords`）

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
  <user_profile>       ← ユーザー名・性別等（DynamoDB SETTINGS）
  <permanent_profile>  ← 永久記憶（DynamoDB PERMANENT_FACTS）
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
  2. DynamoDB PERMANENT_FACTS（永久記憶）
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
  <user_profile>       ユーザー名・性別・AI名
  <permanent_profile>  永久記憶（事実）
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
