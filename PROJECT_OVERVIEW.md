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
- Live2D キャラクターが感情表現（8種）とモーション（12種）付きで応答
- LLM レスポンスは JSON 構造化（text, emotion, motion, suggestedReplies, mapData）
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
| 永久記憶 | DynamoDB | 無期限 | ユーザーの好み・事実（最大50件） |
| 中期記憶 | Amazon Bedrock AgentCore Memory | 30日 | 会話トピック・コンテキスト |
| 短期記憶 | DynamoDB | 7日 | セッション内会話履歴・5ターンごとのローリング要約 |

セッション終了時に EventBridge（15分ルール）→ Haiku 4.5 で永久事実を自動抽出。

### 4. トピック管理
- 会話をトピック別に整理・保存
- LLM による自動トピック命名
- メッセージ履歴の閲覧・手動リネーム

### 5. グループチャット
- フレンドコードによるフレンド追加
- グループ作成・メンバー管理
- WebSocket によるリアルタイムメッセージング

### 6. マルチモデル管理
- 管理画面から Live2D モデルのアップロード・設定が可能
- 感情→表情、モーション→アニメーションのマッピング設定
- S3 + CloudFront CDN 配信

### 7. MCP（Model Context Protocol）連携
- 外部 MCP サーバーとの接続
- LLM が MCP ツールを動的に利用可能

### 8. セキュリティ設計
- システムプロンプトはバックエンド（Lambda）で完全生成。フロントエンドに漏洩しない
- API キーは SSM Parameter Store で管理
- Prompt Caching（cachePoint 2箇所）でコスト最適化
- デバッグ情報は管理者のみ閲覧可能

## アプリケーション構成

```
butler-assistant-app/     ← メインアプリ（React + Vite）
├── コンポーネント 33個 / サービス 19個 / フック 8個 / ストア 3個
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
│   ├── components/         # React コンポーネント 33個（PascalCase.tsx）
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
│   │   └── ...                 # モーダル、ナビゲーション等
│   ├── hooks/              # カスタムフック 8個
│   │   ├── useSpeechRecognition.ts  # 音声認識（Web Speech API）
│   │   ├── useVAD.ts               # Voice Activity Detection
│   │   ├── useCamera.ts            # カメラ制御
│   │   ├── useGeolocation.ts       # 位置情報取得
│   │   ├── useWebSocket.ts         # WebSocket 通信
│   │   ├── useGroupPolling.ts      # グループチャット ポーリング
│   │   ├── useThemePolling.ts      # トピック ポーリング
│   │   └── useQRScanner.ts         # QR コード読み込み
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
[キャッシュブロック1: 全ユーザー共通]
  <ai_config>       キャラクター設定・会話ルール・感情選択基準
  <skills>          ツール使用ルール（カレンダー、天気、検索、メモ等）
  <response_format>  JSON 出力形式指示
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
  → chatController → Lambda /llm/chat
    → DynamoDB からプロフィール・永久記憶を並列取得
    → システムプロンプト構築 + Prompt Caching
    → Bedrock Claude Haiku 4.5（Converse API + Tool Use）
    → ツール実行（カレンダー / 天気 / 検索 / メモ等）
    → レスポンス返却（text, emotion, motion, mapData...）
  → Live2D アニメーション + Polly TTS 音声再生
  → fire-and-forget: AgentCore Memory に中期記憶保存
  → 5ターンごと: ローリング要約 Lambda 非同期起動
  → 15分無操作: EventBridge → 永久事実自動抽出
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
| フロントエンド コンポーネント | 33個 |
| カスタムフック | 8個 |
| サービス | 19個 |
| Zustand ストア | 3個 |
| Lambda 関数 | 35個 |
| LLM スキル | 7種（カレンダー×2、場所検索、Web検索、天気、メモ×4） |
| テスト | 719テスト / 48ファイル |
| 管理画面 コンポーネント | 12個 |
| Chrome 拡張 | 10ファイル |
| 型定義ファイル | 10個 |
| 対応プラットフォーム | 3種（Web / Tauri / Capacitor iOS） |
