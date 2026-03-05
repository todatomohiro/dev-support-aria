# CLAUDE.md ― AI Assistant App

> Live2D + LLM（Bedrock Claude Haiku 4.5）+ Amazon Polly TTS を活用したクロスプラットフォーム対応のアシスタントアプリ

## クイックリファレンス

```bash
cd butler-assistant-app

pnpm test             # 全テスト実行（Vitest + jsdom）
pnpm dev              # 開発サーバー（http://localhost:5173）
pnpm typecheck        # 型チェック
pnpm lint             # ESLint
pnpm build            # プロダクションビルド
pnpm test:coverage    # カバレッジ計測
```

### iOS デプロイ

```bash
pnpm build && npx cap sync ios   # ビルド → iOS に同期
pnpm cap:ios                     # Xcode を開く → Run(▶) で実機デプロイ
```

### インフラデプロイ

```bash
cd infra
aws-vault exec cm-toda-mfa -- npx cdk deploy ButlerAssistantStack
```

シークレット（API キー等）は SSM Parameter Store (`/butler-assistant/*`) で管理。
初回登録・更新は `infra/scripts/setup-ssm-params.sh` を使用。

**すべての開発コマンドは `butler-assistant-app/` 内で実行すること。**

## ディレクトリ構造

```
butler-assistant-app/          # フロントエンド（React + Vite + TypeScript）
├── src/
│   ├── auth/               # 認証（Cognito + AWS Amplify）
│   ├── components/         # React コンポーネント（PascalCase.tsx）
│   ├── hooks/              # カスタムフック（useSpeechRecognition, useCamera, useWebSocket, useGeolocation）
│   ├── services/           # ビジネスロジック（camelCase.ts）
│   ├── stores/             # Zustand 状態管理（appStore, themeStore, groupChatStore）
│   ├── types/              # 型定義・エラークラス・サービスインターフェース
│   ├── platform/           # プラットフォーム抽象化（Web/Tauri/Capacitor）
│   ├── lib/live2d/         # Live2D Cubism SDK ラッパー
│   ├── utils/              # ユーティリティ（performance, dateFormat）
│   └── poc/                # 実験・検証ページ
├── public/models/          # Live2D モデルファイル（mao_pro_jp）
├── src-tauri/              # Tauri 2 デスクトップ設定
└── ios/                    # Capacitor 8 iOS
butler-admin-app/              # 管理画面（React + Cognito TOTP MFA）
infra/
├── lib/butler-stack.ts     # AWS インフラ定義（CDK）
└── lambda/
    ├── llm/                # LLM チャット（Bedrock Converse + Tool Use + Prompt Caching + 3層記憶）
    │   ├── chat.ts         #   メインハンドラー（システムプロンプト生成・Prompt Caching 対応）
    │   ├── skills/         #   スキル実装（Calendar, Places, Web Search）
    │   ├── summarize.ts    #   ローリング要約（Haiku 4.5）
    │   ├── extractFacts.ts #   永久事実抽出（Haiku 4.5）
    │   └── sessionFinalizer.ts # セッション終了検出（EventBridge 15分ルール）
    ├── themes/             # トピック管理（create, list, delete, update, messages）
    ├── friends/            # フレンド管理（generateCode, getCode, link, list, unfriend）
    ├── groups/             # グループ管理（create, addMember, leave, members）
    ├── conversations/      # グループチャット会話（list, messagesList, messagesSend, messagesPoll, messagesRead）
    ├── ws/                 # WebSocket（authorizer, connect, disconnect）
    ├── skills/             # OAuth 管理（callback, connections, disconnect）
    ├── memory/             # 長期記憶イベント保存（AgentCore Memory）
    ├── settings/           # 設定 get/put
    ├── messages/           # メッセージ list/put
    └── tts/                # 音声合成 synthesize（Amazon Polly）
```

## コーディング規約

### インポート

```typescript
// パスエイリアス: @/ → src/
import { AppError, ParseError, MapData } from '@/types'
import { useAppStore } from '@/stores'
import { responseParser, llmClient, ttsService } from '@/services'
import { ChatUI, Live2DCanvas, MapView } from '@/components'
import { platformAdapter } from '@/platform'
import { AuthProvider, AuthModal, useAuthStore, isAuthConfigured } from '@/auth'
```

### サービス実装パターン

```typescript
// インターフェース: src/types/services.ts に定義
// 実装: XxxImpl クラス + XxxService インターフェース
// エクスポート: シングルトン（小文字） + クラス（テスト用）
export class ResponseParserImpl implements ResponseParserService { ... }
export const responseParser = new ResponseParserImpl()
```

### ファイル命名

| 種類 | 命名 | 例 |
|------|------|-----|
| コンポーネント | PascalCase.tsx | `ChatUI.tsx`, `MapView.tsx` |
| サービス | camelCase.ts | `llmClient.ts`, `ttsService.ts` |
| 型定義 | camelCase.ts | `config.ts`, `errors.ts` |
| テスト | *.test.ts(x) | 同階層の `__tests__/` 内に配置 |

### コメント・JSDoc

- **日本語**で記述
- メソッドには必ず JSDoc を付ける

### エラーハンドリング

`src/types/errors.ts` の `AppError` 派生クラスを使用：
`NetworkError` / `APIError` / `RateLimitError` / `ParseError` / `ValidationError` / `ModelLoadError` / `AuthError` / `SyncError`

## テスト

- **Vitest** + **jsdom** 環境（719テスト / 48ファイル）
- セットアップ: `src/__tests__/setup.ts`（Live2D SDK・PixiJS のモック定義済み）
- プロパティベーステスト: `fast-check`（`@fast-check/vitest`）、最低100回実行

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('ServiceName', () => {
  it('テスト内容を日本語で記述', () => { /* ... */ })
})
```

プロパティベーステスト：

```typescript
import { test, fc } from '@fast-check/vitest'

test.prop([fc.string()])(
  'Feature: butler-assistant-app, Property N: プロパティ説明',
  (input) => { /* ... */ },
  { numRuns: 100 }
)
```

## アーキテクチャ

### LLM 通信フロー

```
ユーザー発言 → chatController
  ├→ llmClient → Lambda /llm/chat
  │   ↓ システムプロンプトはバックエンドで完全生成（フロントエンドから送信しない）
  │   ↓ DynamoDB からプロフィール・永久記憶を取得、3層記憶を並列取得 → systemPrompt に注入
  │   ↓ Prompt Caching: 静的プロンプト → cachePoint → ユーザー固有 → cachePoint → 動的コンテキスト
  │   ↓ Bedrock Claude Haiku 4.5（Converse API + Tool Use）
  │   ↓ ツール実行: list_events / create_event / search_places / web_search
  │   ↓ メッセージ保存 + 5ターンごとに要約 Lambda 非同期起動
  │   → レスポンス返却（text, emotion, mapData?, permanentFacts?, sessionSummary?, themeName?)
  ├→ fire-and-forget: /memory/events → AgentCore Memory
  └→ EventBridge rate(15min) → sessionFinalizer → extractFacts（永久事実抽出）
```

- **セキュリティ**: フロントエンドに API キー・システムプロンプトは存在しない
- LLM Lambda: `infra/lambda/llm/chat.ts`（モデル: `jp.anthropic.claude-haiku-4-5-20251001-v1:0`）
- スキル定義: `infra/lambda/llm/skills/toolDefinitions.ts`
- スキルルーティング: `infra/lambda/llm/skills/index.ts`（`executeSkill()`）
- トークン管理: `infra/lambda/llm/skills/tokenManager.ts`（Google OAuth）
- デバッグ情報（`enhancedSystemPrompt`）は `includeDebug=true`（開発者モード）時のみ返却

### システムプロンプト構造（XMLタグ + Prompt Caching）

```
[キャッシュブロック1: 全ユーザー共通]
  <ai_config>         キャラクター設定・会話ルール・感情選択基準
  <skills>            ツール使用ルール（日時を除く静的部分）
  <response_format>   JSON出力形式指示
  ── cachePoint ──
[キャッシュブロック2: ユーザー固有]
  <user_profile>      ユーザー名・性別・AI名（DynamoDB SETTINGS から取得）
  <permanent_profile>  永久記憶（事実）
  ── cachePoint ──
[動的コンテキスト: キャッシュなし]
  <current_datetime>  現在日時
  <user_location>     GPS位置情報
  <user_context>      中期記憶（AgentCore Memory）
  <past_sessions>     過去セッション要約
  <current_session_summary>  現セッション要約
  <session_checkpoints>      チェックポイント
  <theme_context>     トピック情報
  <category_context>  カテゴリ別プロンプト
  <subcategory_context> サブカテゴリ別プロンプト
  <work_context>      MCP接続情報
```

### トピック（テーマ）管理

```
トピック作成 → themeService.createTheme("新規トピック") → Lambda /themes
トピックチャット → chatController.sendThemeMessage → Lambda /llm/chat（themeId 付き）
  ↓ 新規トピック時: LLM が topicName 生成 or ユーザー発言先頭15文字をフォールバック
  ↓ DynamoDB THEME_SESSION#{themeId} の themeName を更新
  → レスポンスに themeName 付与 → themeStore.updateThemeName で UI 即反映
手動リネーム → themeService.renameTheme → Lambda PATCH /themes/{themeId}
メッセージ履歴 → themeService.listMessages → Lambda GET /themes/{themeId}/messages
```

- DynamoDB PK: `USER#userId#THEME#themeId` + SK: `MSG#timestamp#role`
- トピック一覧は `THEME_SESSION#{themeId}` (PK=`USER#userId`)
- メッセージ取得時: アシスタント JSON から `text` のみ抽出、時系列 + role 順でソート

### 3層記憶モデル

| 層 | 保存先 | プロンプトタグ | TTL |
|----|--------|---------------|-----|
| 1. 永久記憶 | DynamoDB `PERMANENT_FACTS` | `<permanent_profile>` | なし（永久） |
| 2. 中期記憶 | AgentCore Memory | `<user_context>` | 30日 |
| 3. 短期記憶 | DynamoDB `SESSION#` + `MSG#` | `<current_session_summary>` | 7日 |

- 永久記憶: 最大50件x50文字、セッション終了時に Haiku 4.5 で自動抽出
- 中期記憶: 永久記憶との重複を自動排除（`deduplicateRecords`）
- 短期記憶: フロントエンドは `{ message, sessionId }` のみ送信、Lambda がコンテキスト構築

### 認証

Cognito + Amplify（SRP 認証フロー）。`src/auth/` に集約。
認証ガード: `isAuthConfigured() && authStatus !== 'authenticated'` → ログイン促進。未設定時はゲストモード。
管理者判定: `useAuthStore` の `isAdmin` フラグ。開発者モードは管理者のみ表示。

### 状態管理（Zustand）

- **appStore.ts**: メッセージ、モーション、設定（persist あり）
- **themeStore.ts**: トピック一覧、アクティブトピック、テーマメッセージ（persist なし、サーバーが信頼元）
- **groupChatStore.ts**: フレンド、グループ、WS ステータス（persist なし、サーバーが信頼元）

### AWS インフラ

| リソース | 説明 |
|---------|------|
| DynamoDB | `butler-assistant`（PK/SK + GSI1/GSI2、ポイントインタイム復旧、TTL） |
| Cognito | ユーザープール + SPA クライアント（SRP 認証）+ 管理画面用クライアント（TOTP MFA） |
| API Gateway | REST（Cognito 認可）+ WebSocket（JWT 認証） |
| Lambda x 35 | Node.js 22.x / ARM_64（デフォルト 10秒、LLM: 90秒） |
| EventBridge | `rate(15 minutes)` → sessionFinalizer |
| AgentCore Memory | 中期記憶（SEMANTIC + USER_PREFERENCE ストラテジー） |
| CloudFront + S3 | 管理画面ホスティング（カスタムドメイン） |

### 環境変数

**フロントエンド（Vite）**: `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_BASE_URL`, `VITE_WS_URL`

**SSM Parameter Store** (`/butler-assistant/*`): `MEMORY_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_PLACES_API_KEY`, `BRAVE_SEARCH_API_KEY`

## セキュリティ注意事項

- **システムプロンプト**: バックエンドで完全生成。フロントエンドからプロンプトを送信しない
- **LLM 通信**: Bedrock Lambda プロキシ経由。フロントエンドに API キーは不要
- **デバッグ情報**: `enhancedSystemPrompt` は開発者モード（管理者のみ）時のみ返却
- **ログ出力**: 認証トークンや機密情報をログやエラーメッセージに含めない
- **モデルファイル**: `validateModelFiles()` で妥当性検証必須
- **Google API キー**: Lambda 環境変数で管理。フロントエンドには露出しない
