# Ai-Ba（アイバ）システム概要

> **Ai-Ba**（アイバ）— 「AI」＋「相棒（Aibou）」の造語。
> Live2D + LLM（Bedrock Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.6）+ マルチ TTS を活用した、クロスプラットフォーム対応 AI チャットアシスタントアプリ。

---

## 1. 技術スタック

### フロントエンド（butler-assistant-app）

| 技術 | バージョン | 用途 |
|------|-----------|------|
| React | 19.2.0 | UI フレームワーク |
| TypeScript | ~5.9.3 | 型安全 |
| Vite | 7.3.1 | ビルドツール |
| Zustand | 5.0.11 | 状態管理（persist 対応） |
| Tailwind CSS | 4.2.0 | スタイリング |
| Pixi.js | 7.4.3 | 2D WebGL レンダリング |
| pixi-live2d-display | ~0.4.0 | Live2D プラグイン |
| Kalidokit | 1.1.5 | フェイストラッキング → Live2D パラメータ変換 |
| Leaflet | 1.9.4 | 地図レンダリング |
| AWS Amplify | 6.16.2 | Cognito 認証 |
| Capacitor | 8.1.0 | iOS ブリッジ |
| Vitest | 4.0.18 | テスト（jsdom 環境、793テスト / 52ファイル） |
| fast-check | 4.5.3 | プロパティベーステスト |

### 管理画面（butler-admin-app）

| 技術 | バージョン | 用途 |
|------|-----------|------|
| React | 19.2 | UI フレームワーク |
| Vite | 7.3 | ビルドツール（port: 5174） |
| Zustand | 5.0 | 状態管理 |
| AWS Amplify | 6.16 | Cognito 認証 + TOTP MFA |
| jszip | — | Live2D モデル ZIP 展開 |
| PixiJS + pixi-live2d-display | — | モデルプレビュー |

### バックエンド（infra）

| 技術 | 用途 |
|------|------|
| AWS CDK (TypeScript) | IaC（インフラ定義） |
| DynamoDB | メインデータストア（PK/SK + GSI×2、TTL） |
| Cognito | ユーザー認証（SRP + TOTP MFA） |
| API Gateway REST | Cognito 認可付き REST API |
| API Gateway WebSocket | JWT 認証、ストリーミング通信 |
| Lambda (Node.js 22.x / ARM64) | 35+ 関数、20 ディレクトリ |
| Bedrock (Converse API) | LLM 推論（Haiku 4.5 / Sonnet 4.6 / Opus 4.6） |
| Bedrock Guardrails | コンテンツモデレーション（6カテゴリ） |
| AgentCore Memory | 中期記憶（SEMANTIC + USER_PREFERENCE） |
| EventBridge | `rate(15 minutes)` → セッション終了検出 |
| S3 | Live2D モデルファイル + 管理画面ホスティング |
| CloudFront | モデル CDN + 管理画面配信 |
| Amazon Polly / Aivis Cloud | 音声合成（TTS） |

---

## 2. ディレクトリ構成

```
dev-support-aria-claude/
│
├── butler-assistant-app/           # メインアプリ（React + Vite + TypeScript）
│   ├── src/
│   │   ├── main.tsx                  # エントリポイント（React root + SW 登録）
│   │   ├── App.tsx                   # ルーティング & グローバル状態制御（735行）
│   │   ├── components/               # React コンポーネント（38ファイル, ~9,800行）
│   │   ├── hooks/                    # カスタムフック（12ファイル, ~1,600行）
│   │   ├── services/                 # ビジネスロジック（25ファイル, ~6,200行）
│   │   ├── stores/                   # Zustand ストア（3ファイル）
│   │   ├── types/                    # 型定義（10ファイル）
│   │   ├── auth/                     # Cognito 認証（6ファイル）
│   │   ├── platform/                 # プラットフォーム抽象化（Web / Capacitor）
│   │   ├── lib/live2d/               # Live2D SDK ラッパー
│   │   ├── utils/                    # ユーティリティ（performance, dateFormat）
│   │   ├── poc/                      # 実験・検証ページ
│   │   └── __tests__/                # テスト（52ファイル）
│   ├── public/models/                # デフォルト Live2D モデル
│   ├── ios/                          # Capacitor 8 iOS
│   └── package.json
│
├── butler-admin-app/               # 管理画面（React + Cognito TOTP MFA）
│   ├── src/
│   │   ├── auth/                     # 認証 + AdminGuard
│   │   ├── components/               # 14 コンポーネント
│   │   ├── services/adminApi.ts      # API クライアント
│   │   ├── stores/adminStore.ts      # Zustand ストア
│   │   └── types/admin.ts            # 型定義
│   └── package.json
│
├── infra/                          # AWS インフラ（CDK）
│   ├── lib/butler-stack.ts           # CDK スタック定義（1,245行）
│   └── lambda/
│       ├── llm/                      # LLM チャット（コアロジック）
│       │   ├── chat.ts                 # メインハンドラ（2,608行）★
│       │   ├── models.ts              # モデル ID 一元管理 ★
│       │   ├── extractFacts.ts        # 永久記憶抽出（347行）★
│       │   ├── summarize.ts           # ローリング要約（212行）★
│       │   ├── sessionFinalizer.ts    # セッション終了検出（98行）
│       │   ├── rateLimiter.ts         # レートリミット
│       │   └── skills/               # LLM スキル（9ファイル）
│       │       ├── index.ts            # スキルルーター ★
│       │       ├── toolDefinitions.ts  # ツール定義 ★
│       │       ├── googleCalendar.ts   # Google Calendar
│       │       ├── googleTasks.ts      # Google Tasks
│       │       ├── places.ts           # Google Places
│       │       ├── webSearch.ts        # Brave Search
│       │       ├── weather.ts          # Open-Meteo
│       │       └── tokenManager.ts     # OAuth トークン管理
│       ├── admin/                    # 管理 API（me, users, models）
│       ├── ws/                       # WebSocket（authorizer, connect, disconnect）
│       ├── themes/                   # トピック管理
│       ├── friends/                  # フレンド管理
│       ├── groups/                   # グループ管理
│       ├── conversations/            # グループチャット会話
│       ├── skills/                   # OAuth 管理
│       ├── mcp/                      # MCP クライアント
│       ├── memory/                   # AgentCore Memory イベント
│       ├── memos/                    # メモ管理
│       ├── tts/                      # 音声合成
│       ├── settings/                 # ユーザー設定
│       ├── messages/                 # メッセージ保存
│       ├── users/                    # ユーザー・行動分析
│       ├── models/                   # モデル一覧
│       ├── search/                   # 検索
│       ├── meeting/                  # ミーティング管理
│       ├── meeting-noter/            # ミーティングノート
│       ├── transcribe/               # 音声ストリーム URL
│       └── usage/                    # 利用量取得
│
└── docs/                           # ドキュメント & モックアップ
    ├── mockups/                      # UI モックアップ HTML
    └── *.md                          # 設計ドキュメント
```

**★ = コアロジックファイル**（後述の「コアロジック特定」で詳述）

---

## 3. 各モジュールの役割

### 3.1 butler-assistant-app（メインアプリ）

#### コンポーネント（38ファイル）

| ファイル | 行数 | 役割 |
|---------|------|------|
| **ChatUI.tsx** | 1,237 | メインチャット画面。メッセージ表示、TTS 再生、STT 入力、画像アップロード、Markdown レンダリング |
| **AibaScreen.tsx** | 894 | ダッシュボード。キャラクター表示、ブリーフィング、天気オーバーレイ |
| **Live2DCanvas.tsx** | 713 | PixiJS Live2D レンダラー。モデルロード、モーション/表情制御、リップシンク、アイドル自律行動 |
| **VoiceChatScreen.tsx** | 700 | 音声会話画面。STT → LLM → TTS リアルタイムパイプライン |
| **StudioCamera.tsx** | 484 | フェイストラッキングカメラ（MediaPipe + Kalidokit） |
| **GroupChat.tsx** | 425 | グループチャット UI |
| **ModelImporter.tsx** | 396 | Live2D モデルアップロード（S3 Presigned URL） |
| **WorkConnectModal.tsx** | 303 | MCP 接続 UI（QR スキャン） |
| **ErrorNotification.tsx** | 298 | エラートースト表示 |
| **SearchModal.tsx** | 297 | 全文検索（テーマ、フレンド、グループ） |
| **ThemeChat.tsx** | 268 | トピックチャット（カテゴリベース会話） |
| **GroupChatScreen.tsx** | 252 | グループチャットルーティング |
| **Settings.tsx** | 213 | アプリ設定（テーマ、フォント、TTS/カメラトグル） |
| **SkillsModal.tsx** | 232 | スキル一覧（Google Calendar, Places 等） |
| その他 24 ファイル | — | BottomNav, Sidebar, MapView, MemoScreen, ProfileModal 等 |

#### フック（12ファイル）

| フック | 行数 | 役割 |
|--------|------|------|
| **useVAD** | 242 | 音声活動検出（TensorFlow.js モデル） |
| **useVoiceEmotion** | 230 | 音声プロソディ分析（感情推定） |
| **useSpeechRecognition** | 215 | Web Speech API（STT） |
| **useCamera** | 187 | カメラストリーム管理 |
| **useQRScanner** | 134 | QR コードスキャン（jsQR） |
| **useActivityLogger** | 130 | 行動ログ記録（生活リズム分析） |
| **useGroupPolling** | 98 | グループメッセージポーリング（WS フォールバック） |
| **useThemePolling** | 94 | テーマメッセージポーリング（WS フォールバック） |
| **useWeatherIcon** | 89 | 天気データ取得（Open-Meteo, 30分間隔） |
| **useGeolocation** | 87 | GPS 位置情報取得 |
| **useBriefing** | 82 | ブリーフィング起動（起動3秒後 / visibility / 30分） |
| **useWebSocket** | 46 | WebSocket 管理（ストリーミングチャット） |

#### サービス（25ファイル）

| サービス | 行数 | 役割 |
|---------|------|------|
| **chatController** | 1,007 | チャットオーケストレーター。メッセージ送信、ストリーミング処理、JSON パース、モーション/感情抽出 |
| **aivisTtsService** | 598 | Aivis Cloud TTS（高品質音声合成 + ストリーミング） |
| **webSpeechTtsService** | 437 | Web Speech API TTS（ゼロレイテンシフォールバック） |
| **llmClient** | 426 | Lambda `/llm/chat` への REST 呼び出し、リトライ、エラーハンドリング |
| **ttsService** | 345 | TTS プロバイダーセレクター（Polly / Aivis / Web Speech） |
| **syncService** | 342 | サーバー同期（メッセージ履歴取得、ページネーション） |
| **wsService** | 326 | WebSocket イベント管理（chat_delta, chat_complete） |
| **live2dRenderer** | 278 | PixiJS 抽象化（モデル初期化、テクスチャロード） |
| **briefingService** | 270 | ブリーフィングコンテンツ生成 |
| **responseParser** | 218 | LLM JSON 出力パース（text / emotion / motion / mapData） |
| **modelLoader** | 208 | Live2D モデルファイルロード & バリデーション |
| **activityPatternService** | 201 | 行動パターン分析（日次/週次） |
| **greetingService** | 180 | 不在検出 & 挨拶トリガー |
| **groupService** | 162 | グループ CRUD |
| **skillClient** | 164 | OAuth スキル管理 |
| **motionController** | 152 | モーションキュー（優先度ベース再生） |
| **searchService** | 150 | 全文検索 |
| **sentimentService** | 147 | センチメント分析（日本語 NLP） |
| **themeService** | 133 | トピック CRUD |
| **friendService** | 107 | フレンド CRUD |
| **memoService** | 100 | メモ CRUD |
| **usageService** | 100 | レートリミット情報取得 |
| **workService** | 87 | MCP 接続状態管理 |
| **modelService** | 52 | モデルメタデータ取得 |

#### Zustand ストア（3ファイル）

| ストア | 行数 | 永続化 | 役割 |
|--------|------|--------|------|
| **appStore** | 292 | localStorage | メッセージ、モーション、設定、streamingText、activeModelMeta |
| **themeStore** | 128 | なし | トピック一覧、アクティブトピック（サーバーが信頼元） |
| **groupChatStore** | 141 | なし | フレンド、グループ、WS ステータス（サーバーが信頼元） |

#### プラットフォーム抽象化

| ファイル | 役割 |
|---------|------|
| **webAdapter.ts** | Web 実装（localStorage） |
| **capacitorAdapter.ts** | iOS 実装（Capacitor Preferences） |
| **index.ts** | 自動検出 + シングルトン `platformAdapter` エクスポート |

---

### 3.2 butler-admin-app（管理画面）

| コンポーネント | 行数 | 役割 |
|--------------|------|------|
| **ModelMappingEditor** | 300+ | 感情/モーションマッピング編集 + Live2D プレビュー |
| **ModelManagement** | 260 | モデルアップロード（ZIP → S3）、ステータス管理 |
| **UserDetail** | 208 | ユーザー詳細 + ロール/プラン変更 |
| **UserActivityViewer** | 200+ | 行動ヒートマップ（30日間） |
| **UserMemoryViewer** | 185 | 永久記憶の閲覧/削除（FACTS / PREFERENCES） |
| **MfaSettingsPage** | 178 | TOTP 設定（QR コード） |
| **LoginPage** | 138 | メール/パスワード + TOTP 2段階認証 |
| **ModelCharacterEditor** | 100+ | キャラクター性格設定編集 |
| **UserTable** | 105 | ユーザー一覧（ページネーション） |

**認証フロー**: Cognito SRP → TOTP チャレンジ → AdminGuard（admin ロール必須 + MFA 強制）

---

### 3.3 infra（AWS インフラ）

#### CDK スタック（butler-stack.ts, 1,245行）

| リソース | 設定 |
|---------|------|
| DynamoDB | `butler-assistant`（PK/SK + GSI×2、ポイントインタイム復旧、TTL） |
| Cognito | ユーザープール + SPA クライアント + 管理画面クライアント |
| API Gateway REST | Cognito Authorizer、CORS 全オリジン |
| API Gateway WebSocket | JWT カスタム Authorizer、prod ステージ |
| Lambda ×35+ | Node.js 22.x / ARM64（デフォルト 10秒、LLM: 90秒） |
| Bedrock Guardrails | 6カテゴリフィルタ（VIOLENCE/HATE/INSULTS/SEXUAL/MISCONDUCT/PROMPT_ATTACK） |
| S3 ×2 | モデルファイル（バージョニング + CORS）+ 管理画面 |
| CloudFront ×2 | モデル CDN + 管理画面（カスタムドメイン） |
| EventBridge | `rate(15 minutes)` → sessionFinalizer |

#### Lambda 一覧（20ディレクトリ）

| ディレクトリ | 関数群 | 主な役割 |
|------------|--------|---------|
| **llm/** | chat, extractFacts, summarize, sessionFinalizer, rateLimiter | LLM オーケストレーション・記憶管理 |
| **llm/skills/** | 9スキルファイル | ツール実行（Calendar, Tasks, Places, Search, Weather） |
| **admin/** | me, usersList, usersDetail, usersRole, models/* | 管理 API |
| **ws/** | authorizer, connect, disconnect, default | WebSocket ライフサイクル |
| **themes/** | create, list, delete, update, messages | トピック管理 |
| **friends/** | generateCode, getCode, link, list, unfriend | フレンド管理 |
| **groups/** | create, addMember, leave, members | グループ管理 |
| **conversations/** | list, messagesList, messagesSend, messagesPoll, messagesRead | グループ会話 |
| **skills/** | callback, connections, disconnect | OAuth トークン管理 |
| **mcp/** | connect, disconnect, mcpClient, registry*, status | MCP クライアント |
| **memory/** | events | AgentCore Memory イベント保存 |
| **tts/** | synthesize | Polly / Aivis 音声合成 |
| **settings/** | get, put | ユーザー設定 |
| **messages/** | list, put | メッセージ保存/取得 |
| **memos/** | save, list, delete | メモ CRUD |
| **users/** | activity, activityPatternAnalyzer | 行動ログ・パターン分析 |
| **models/** | list | モデル一覧（ユーザー向け） |
| **search/** | query | DynamoDB 検索 |
| **meeting/** | transcript | ミーティング文字起こし |
| **transcribe/** | getStreamUrl | Transcribe URL 発行 |
| **usage/** | get | 利用量取得 |

---

## 4. コアロジック特定

システム全体の動作を決定づける **最重要ファイル** を以下に特定する。

### 4.1 LLM チャットエンジン（最重要）

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `infra/lambda/llm/chat.ts` | **2,608** | ★★★ | **システムの心臓部**。システムプロンプト生成、Prompt Caching、Bedrock Converse API 呼び出し、Tool Use ループ、WebSocket ストリーミング、メッセージ保存、非同期要約起動 |
| `infra/lambda/llm/models.ts` | 30 | ★★★ | モデル ID 一元管理。全 Lambda が参照する Bedrock モデル定義の単一真実源 |
| `infra/lambda/llm/skills/index.ts` | — | ★★☆ | スキルルーター。`executeSkill()` でツール名→実装への分岐 |
| `infra/lambda/llm/skills/toolDefinitions.ts` | — | ★★☆ | 9ツールの入力スキーマ定義。LLM が使えるツールの仕様書 |

### 4.2 3層記憶システム

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `infra/lambda/llm/extractFacts.ts` | **347** | ★★★ | 永久記憶抽出。会話から FACTS/PREFERENCES を自動抽出・統合・上限管理 |
| `infra/lambda/llm/summarize.ts` | **212** | ★★☆ | ローリング要約。5ターンごとに非同期実行、セグメント要約 + チェックポイント |
| `infra/lambda/llm/sessionFinalizer.ts` | 98 | ★★☆ | セッション終了検出。EventBridge 15分ルール → 30分無操作で extractFacts 起動 |

### 4.3 フロントエンド チャットパイプライン

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `butler-assistant-app/src/services/chatController.ts` | **1,007** | ★★★ | **フロントエンドの心臓部**。メッセージ送信フロー制御、ストリーミングテキスト処理（`extractStreamingText`, `parseStreamedContent`）、ブリーフィング、モーション/感情抽出 |
| `butler-assistant-app/src/services/llmClient.ts` | 426 | ★★☆ | Lambda `/llm/chat` への REST 通信、リトライロジック |
| `butler-assistant-app/src/services/responseParser.ts` | 218 | ★★☆ | LLM JSON 出力の構造化パース |
| `butler-assistant-app/src/services/wsService.ts` | 326 | ★★☆ | WebSocket イベント管理（`chat_delta` / `chat_complete`） |

### 4.4 Live2D レンダリング

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `butler-assistant-app/src/components/Live2DCanvas.tsx` | **713** | ★★★ | Live2D キャラクター描画。PixiJS 統合、表情/モーション制御、リップシンク、アイドル自律行動 |
| `butler-assistant-app/src/services/live2dRenderer.ts` | 278 | ★★☆ | PixiJS 抽象化レイヤー |

### 4.5 音声パイプライン

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `butler-assistant-app/src/services/ttsService.ts` | 345 | ★★☆ | TTS プロバイダー統合（Polly / Aivis / Web Speech） |
| `butler-assistant-app/src/services/aivisTtsService.ts` | 598 | ★★☆ | 高品質 TTS（ストリーミング対応、感情制御） |
| `butler-assistant-app/src/components/VoiceChatScreen.tsx` | 700 | ★★☆ | 音声会話 UI（STT → LLM → TTS） |

### 4.6 状態管理

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `butler-assistant-app/src/stores/appStore.ts` | 292 | ★★★ | グローバル状態（メッセージ、設定、モーション、ストリーミング）。localStorage 永続化 |
| `butler-assistant-app/src/App.tsx` | 735 | ★★☆ | ルーティング & 全フック統合 |

### 4.7 インフラ定義

| ファイル | 行数 | 重要度 | 役割 |
|---------|------|--------|------|
| `infra/lib/butler-stack.ts` | **1,245** | ★★★ | AWS リソース全定義。DynamoDB / Cognito / API Gateway / Lambda / Bedrock / S3 / CloudFront |

---

## 5. データフロー

### 5.1 チャットメッセージフロー

```
ユーザー入力（テキスト / 音声 / 画像）
    │
    ▼
ChatUI / VoiceChatScreen
    │
    ▼
chatController.sendMessage()
    ├── llmClient.sendMessage() ─── REST POST ──→ Lambda /llm/chat
    │                                                 │
    │                                    ┌────────────┘
    │                                    ▼
    │                           buildSystemPrompt()
    │                           ├── DynamoDB: SETTINGS（プロフィール）
    │                           ├── DynamoDB: PERMANENT_FACTS（永久記憶）
    │                           ├── AgentCore Memory（中期記憶）
    │                           ├── DynamoDB: SESSION#（短期記憶・要約）
    │                           └── DynamoDB: GLOBAL_MODEL#（モデル設定）
    │                                    │
    │                                    ▼
    │                           Bedrock Converse API
    │                           ├── Prompt Caching（cachePoint ×2）
    │                           ├── Tool Use ループ（最大5回）
    │                           │   └── executeSkill() → Calendar / Tasks / Places / Search / Weather
    │                           ├── Guardrail チェック
    │                           └── WebSocket chat_delta（テキスト差分を逐次送信）
    │                                    │
    │               ┌────────────────────┘
    │               ▼
    ├── wsService: chat_delta 受信 → appStore.streamingText 蓄積
    ├── wsService: chat_complete 受信 → parseStreamedContent()
    │   ├── emotion → Live2DCanvas 表情変更
    │   ├── motion → Live2DCanvas モーション再生
    │   ├── mapData → MapView 地図表示
    │   └── text → メッセージ確定
    ├── ttsService: テキスト → 音声再生（文単位先行合成）
    └── fire-and-forget: /memory/events → AgentCore Memory
```

### 5.2 記憶管理フロー

```
チャット中（短期記憶）
    │
    ├── 5ターンごと ──→ summarize Lambda（非同期）
    │                      └── ローリング要約 + セグメント要約 → SESSION# 更新
    │
    ▼
EventBridge rate(15min) → sessionFinalizer
    │
    ├── 30分無操作検出
    │       │
    │       ▼
    │   extractFacts Lambda（非同期）
    │       ├── 全 MSG# 取得
    │       ├── Haiku 4.5 で FACTS / PREFERENCES 抽出
    │       ├── 既存の PERMANENT_FACTS とマージ（重複排除）
    │       ├── 閾値超過時は LLM で統合圧縮
    │       └── DynamoDB PERMANENT_FACTS 更新
    │
    └── AgentCore Memory（中期記憶、30日保持）
            └── 永久記憶との重複を deduplicateRecords で自動排除
```

### 5.3 システムプロンプト構造

```xml
[ブロック1: 全ユーザー共通 — キャッシュ対象]
  <ai_config>         キャラクター設定 + 共通ルール + 感情基準
  <skills>            ツール使用ルール（静的部分）
  <response_format>   JSON 出力形式
  ── cachePoint ──

[ブロック2: ユーザー固有 — キャッシュ対象]
  <user_profile>       ニックネーム・性別・AI名
  <permanent_profile>  永久記憶（FACTS + PREFERENCES）
  ── cachePoint ──

[ブロック3: 動的コンテキスト — キャッシュなし]
  <current_datetime>   現在日時
  <user_location>      GPS 位置情報
  <user_context>       中期記憶（AgentCore）
  <past_sessions>      過去セッション要約
  <current_session_summary>  現セッション要約
  <session_checkpoints>      チェックポイント
  <theme_context>      トピック情報
  <category_context>   カテゴリ別プロンプト
  <work_context>       MCP 接続情報
```

---

## 6. DynamoDB スキーマ

| PK | SK | 用途 | TTL |
|----|----|----|-----|
| `USER#{userId}` | `SETTINGS` | ユーザープロフィール | — |
| `USER#{userId}` | `PERMANENT_FACTS` | 永久記憶（facts[], preferences[]） | — |
| `USER#{userId}` | `PLAN` | サブスクリプションプラン | — |
| `USER#{userId}` | `SESSION#{sessionId}` | セッション要約 | 7日 |
| `USER#{userId}` | `THEME_SESSION#{themeId}` | テーマメタデータ | — |
| `USER#{userId}` | `GOOGLE_TOKEN#{provider}` | OAuth トークン | — |
| `USER#{userId}` | `USAGE_DAILY#{date}` | 日次メッセージカウンタ | 2日 |
| `USER#{userId}` | `USAGE_MONTHLY#{month}` | 月次メッセージカウンタ | 35日 |
| `USER#{userId}` | `USAGE_PREMIUM_MONTHLY#{month}` | Premium 月次カウンタ | 35日 |
| `USER#{userId}#SESSION#{sessionId}` | `MSG#{timestamp}#{role}` | チャットメッセージ | 7日 |
| `USER#{userId}#SESSION#{sessionId}` | `SUMMARY_CP#{timestamp}` | 要約チェックポイント | 7日 |
| `USER#{userId}#THEME#{themeId}` | `MSG#{timestamp}#{role}` | テーマメッセージ | 7日 |
| `ACTIVE_SESSION` | `{userId}#{sessionId}` | アクティブセッション追跡 | — |
| `WS_CONN#{connectionId}` | `META` | WebSocket 接続メタ | 2時間 |
| `GLOBAL_MODEL#{modelId}` | `METADATA` | モデル設定（character, emotion, motion） | — |

**GSI1**: フレンドコード逆引き、会話ソート
**GSI2**: 検索用インデックス

---

## 7. レートリミット

| プラン | 日次上限 | 月次上限 | Premium 月次 | 利用可能モデル |
|--------|---------|---------|-------------|--------------|
| Free | 15 | 300 | — | Haiku のみ |
| Paid | 40 | 1,000 | 60 | Haiku + Sonnet |
| Platinum | 無制限 | 無制限 | 無制限 | 全モデル |

---

## 8. API エンドポイント一覧

### REST API（Cognito Authorizer）

| メソッド | パス | Lambda | 用途 |
|---------|------|--------|------|
| POST | `/llm/chat` | llm-chat | LLM 会話（ストリーミング） |
| POST | `/tts/synthesize` | tts-synthesize | 音声合成 |
| POST | `/memory/events` | memory-events | AgentCore イベント保存 |
| GET/PUT | `/settings` | settings-* | ユーザー設定 |
| GET/POST | `/messages` | messages-* | メッセージ CRUD |
| GET/POST/DELETE/PATCH | `/themes/*` | themes-* | トピック管理 |
| GET/POST | `/friends/*` | friends-* | フレンド管理 |
| GET/POST | `/groups/*` | groups-* | グループ管理 |
| GET/POST | `/conversations/*` | conversations-* | グループ会話 |
| GET/POST/DELETE | `/memos` | memos-* | メモ CRUD |
| GET/POST/DELETE | `/skills/*` | skills-* | OAuth 管理 |
| POST/DELETE/GET | `/mcp/*` | mcp-* | MCP 管理 |
| GET | `/models` | models-list | モデル一覧 |
| GET | `/search` | search-query | 検索 |
| GET/POST | `/users/activity` | users-activity | 行動ログ |
| GET | `/usage` | usage-get | 利用量 |

### 管理 API

| メソッド | パス | 用途 |
|---------|------|------|
| GET | `/admin/me` | 管理者情報 |
| GET | `/admin/users` | ユーザー一覧 |
| GET | `/admin/users/{userId}` | ユーザー詳細 |
| PUT | `/admin/users/{userId}/role` | ロール変更 |
| PUT | `/admin/users/{userId}/plan` | プラン変更 |
| GET/DELETE | `/admin/users/{userId}/memory` | 永久記憶管理 |
| GET | `/admin/users/{userId}/activity` | 行動データ |
| GET/POST/PATCH/DELETE | `/admin/models/*` | モデル管理 |

### WebSocket API

| ルート | Lambda | 用途 |
|--------|--------|------|
| `$connect` | ws-authorizer + ws-connect | JWT 認証 + 接続記録 |
| `$disconnect` | ws-disconnect | 接続解除 |
| `$default` | ws-default | メッセージルーティング |

**サーバー→クライアント イベント**:
- `chat_delta`: テキスト差分（リアルタイム）
- `chat_complete`: 完了通知 + メタデータ

---

## 9. セキュリティモデル

| 項目 | 実装 |
|------|------|
| システムプロンプト | バックエンド完全生成。フロントエンドから送信しない |
| API 認証 | Cognito Authorizer（REST） / JWT カスタム Authorizer（WebSocket） |
| 管理画面 | TOTP MFA 強制 + admin ロール必須 |
| LLM 通信 | Bedrock Lambda プロキシ経由。フロントエンドに API キー不要 |
| コンテンツフィルタ | Bedrock Guardrails（6カテゴリ） |
| シークレット | SSM Parameter Store（`/butler-assistant/*`） |
| デバッグ情報 | 管理者の開発者モードのみ返却 |
| モデルファイル | `validateModelFiles()` でバリデーション必須 |

---

## 10. 設計パターン

| パターン | 適用箇所 |
|---------|---------|
| **Service Pattern** | Interface → Impl クラス → シングルトンエクスポート |
| **Platform Adapter** | Web / Capacitor を統一インターフェースで抽象化 |
| **Hook Composition** | 複雑な機能を小さなカスタムフックに分解 |
| **Zustand Persist** | appStore のみ localStorage 永続化（画像は24時間で期限切れ） |
| **WebSocket + Polling Fallback** | WS 不通時にポーリングでフォールバック |
| **Prompt Caching** | 静的/ユーザー固有/動的の3層キャッシュでコスト最適化 |
| **Fire-and-Forget** | 要約・記憶抽出を非同期 Lambda 起動で実行 |
| **Tool Use Loop** | Bedrock Converse API のツール呼び出しを最大5回ループ |
| **Motion Queue** | 優先度ベースのアニメーション再生管理 |

---

## 11. 統計サマリー

| 指標 | 数値 |
|------|------|
| フロントエンド コンポーネント | 38 ファイル（~9,800行） |
| フロントエンド フック | 12 ファイル（~1,600行） |
| フロントエンド サービス | 25 ファイル（~6,200行） |
| フロントエンド 合計（src） | ~16,000行 |
| 管理画面 コンポーネント | 14 ファイル |
| Lambda 関数 | 35+ |
| Lambda ディレクトリ | 20 |
| LLM スキル | 9 ファイル |
| テスト | 793（Vitest + jsdom） |
| テストファイル | 52 |
| CDK スタック | 1,245行 |
| LLM チャットハンドラ | 2,608行（最大ファイル） |
