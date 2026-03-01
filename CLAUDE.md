# CLAUDE.md ― Butler Assistant App

> Live2D + LLM（Bedrock Claude Sonnet 4.6）+ Amazon Polly TTS を活用したクロスプラットフォーム対応のアシスタントアプリ

## クイックリファレンス

```bash
cd butler-assistant-app

pnpm test             # 全テスト実行（621テスト / 42ファイル）
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

### その他プラットフォーム

```bash
pnpm tauri:dev        # Tauri デスクトップアプリ開発
```

### インフラデプロイ

```bash
cd infra
aws-vault exec cm-toda-mfa -- npx cdk deploy
```

シークレット（API キー等）は SSM Parameter Store (`/butler-assistant/*`) で管理。
環境変数の指定は不要。初回登録・更新は `infra/scripts/setup-ssm-params.sh` を使用。

**すべての開発コマンドは `butler-assistant-app/` 内で実行すること。**

## ディレクトリ構造

```
butler-assistant-app/
├── src/
│   ├── auth/               # 認証（Cognito + AWS Amplify）
│   ├── components/         # React コンポーネント（PascalCase.tsx）
│   ├── hooks/              # カスタムフック（useSpeechRecognition）
│   ├── services/           # ビジネスロジック（camelCase.ts）
│   ├── stores/             # Zustand 状態管理（appStore.ts）
│   ├── types/              # 型定義・エラークラス・サービスインターフェース
│   ├── platform/           # プラットフォーム抽象化（Web/Tauri/Capacitor）
│   ├── poc/                # 実験・検証ページ（PollyPoc）
│   ├── lib/live2d/         # Live2D Cubism SDK ラッパー
│   ├── utils/              # ユーティリティ（performance.ts）
│   └── __tests__/integration/  # 統合テスト
├── public/models/          # Live2D モデルファイル（mao_pro_jp）
├── public/live2d/core/     # Cubism SDK Core
├── src-tauri/              # Tauri 2 デスクトップ設定
└── ios/                    # Capacitor 8 iOS
infra/
├── bin/infra.ts            # CDK エントリーポイント
├── lib/butler-stack.ts     # AWS インフラ定義
└── lambda/
    ├── settings/           # 設定 get/put
    ├── messages/           # メッセージ list/put
    ├── tts/                # 音声合成 synthesize
    ├── llm/                # LLM チャット（Bedrock Claude + Tool Use + 3層記憶）
    │   ├── skills/         #   スキル実装（Google Calendar, Google Places）
    │   ├── summarize.ts    #   ローリング要約（短期記憶、Haiku 4.5）
    │   ├── extractFacts.ts #   永久事実抽出（セッション終了時、Haiku 4.5）
    │   └── sessionFinalizer.ts # セッション終了検出（EventBridge 15分ルール）
    ├── friends/            # フレンド管理（generateCode, getCode, link, list, unfriend）
    ├── groups/             # グループ管理（create, addMember, leave, members）
    ├── conversations/      # グループチャット会話（list, messagesList, messagesSend, messagesPoll）
    ├── ws/                 # WebSocket（authorizer, connect, disconnect）
    ├── skills/             # OAuth 管理（callback, connections, disconnect）
    └── memory/             # 長期記憶イベント保存（AgentCore Memory）
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

- **Vitest** + **jsdom** 環境（621テスト / 42ファイル）
- セットアップ: `src/__tests__/setup.ts`（Live2D SDK・PixiJS のモック定義済み）
- プロパティベーステスト: `fast-check`（`@fast-check/vitest`）、最低100回実行

### テストの書き方

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

## 主要モジュール

### サービス層（src/services/ — 12サービス）

| シングルトン | クラス | 責務 |
|-------------|--------|------|
| `responseParser` | `ResponseParserImpl` | LLM レスポンス JSON 解析・バリデーション（mapData 含む） |
| `llmClient` | `LLMClientImpl` | Bedrock Claude 通信（Lambda プロキシ経由、リトライ付き） |
| `motionController` | `MotionControllerImpl` | モーションキュー管理・再生制御 |
| `live2dRenderer` | `Live2DRendererImpl` | Live2D 描画・アニメーション |
| `modelLoader` | `ModelLoaderImpl` | モデルファイル読み込み・永続化 |
| `chatController` | `ChatControllerImpl` | チャットフロー統合（LLM→Parser→Motion→TTS→Store→Memory） |
| `syncService` | `SyncServiceImpl` | データ同期（ローカル↔サーバー） |
| `ttsService` | `TtsServiceImpl` | Amazon Polly 音声合成・再生（Kazuha/neural） |
| `skillClient` | — | スキル連携管理（OAuth コールバック・接続状態） |
| `friendService` | `FriendServiceImpl` | フレンド管理（ユーザーコード生成・リンク・一覧・解除） |
| `groupService` | `GroupServiceImpl` | グループチャット管理（グループ作成・メンバー管理・メッセージ送受信・ポーリング） |
| `wsService` | `WsServiceImpl` | WebSocket リアルタイム通信（接続管理・再接続・メッセージ配信） |

### LLM 通信アーキテクチャ

```
ユーザー発言 → chatController
  ├→ llmClient → Lambda /llm/chat
  │              ↓ 3層記憶を並列取得:
  │              │   ① getPermanentFacts（永久記憶 — DynamoDB）
  │              │   ② retrieveMemoryRecords（中期記憶 — AgentCore Memory）
  │              │   ③ getSessionContext（短期記憶 — ローリング要約）
  │              ↓ 中期記憶から永久記憶との重複を除外（deduplicateRecords）
  │              ↓ systemPrompt に3層記憶を注入:
  │              │   <permanent_profile> → <user_context> → <current_session_summary>
  │              ↓ Bedrock Claude 呼び出し（Tool Use 対応）
  │              ↓ ツール実行: list_events / create_event / search_places / web_search
  │              ↓ メッセージ保存 + ACTIVE_SESSION upsert
  │              ↓ 5ターンごとに要約 Lambda を非同期起動
  │              → レスポンス返却（text, motion, emotion, mapData?, permanentFacts?, sessionSummary?）
  ├→ fire-and-forget: Lambda /memory/events
  │                    ↓ CreateEvent（会話を記録）
  │                    → AgentCore Memory が自動で要約・抽出
  └→ EventBridge rate(15min) → sessionFinalizer Lambda
                                ↓ 30分無言セッションを検出
                                → extractFacts Lambda（Haiku 4.5 で永久事実を抽出・保存）
```

- フロントエンドに API キーは存在しない（IAM ロールで認証）
- Lambda: `infra/lambda/llm/chat.ts`（inference profile: `jp.anthropic.claude-sonnet-4-6`）
- フロントエンド: `src/services/llmClient.ts`（JSON 非準拠応答のフォールバック処理付き）

### LLM スキル（Tool Use）

| ツール名 | 実装ファイル | 機能 |
|---------|-------------|------|
| `list_events` | `infra/lambda/llm/skills/googleCalendar.ts` | Google カレンダー予定取得 |
| `create_event` | `infra/lambda/llm/skills/googleCalendar.ts` | Google カレンダー予定作成 |
| `search_places` | `infra/lambda/llm/skills/places.ts` | Google Places API で場所検索 |
| `web_search` | `infra/lambda/llm/skills/webSearch.ts` | Brave Search API でWeb検索 |

- ツール定義: `infra/lambda/llm/skills/toolDefinitions.ts`
- ルーティング: `infra/lambda/llm/skills/index.ts`（`executeSkill()`）
- トークン管理: `infra/lambda/llm/skills/tokenManager.ts`（Google OAuth トークン取得・リフレッシュ）

### 3層記憶モデル

```
① 永久記憶（PERMANENT_FACTS）  → <permanent_profile> タグ
② 中期記憶（AgentCore Memory） → <user_context> タグ（重複排除済み）
③ 短期記憶（ローリング要約）    → <current_session_summary> タグ
```

#### ① 永久記憶（DynamoDB 自前管理）
- DynamoDB: `PK=USER#{userId}`, `SK=PERMANENT_FACTS`（TTL なし、永久保持）
- 最大50件、各50文字以内の事実を配列で保持
- セッション終了（30分無言）を EventBridge 15分ルールで検出
- `sessionFinalizer` → `extractFacts`（Haiku 4.5）で会話から重要事実を自動抽出
- `ACTIVE_SESSION` レコード（TTL 1日）でアクティブセッションを追跡

#### ② 中期記憶（AgentCore Memory）
- **Memory ID**: 環境変数 `MEMORY_ID` で設定
- **記憶保存**: `chatController` が成功レスポンス後に `/memory/events` へ fire-and-forget で送信
- **記憶検索**: `/llm/chat` Lambda が Bedrock 呼び出し前に検索
- **ストラテジー**: `facts`（SEMANTIC）+ `preferences`（USER_PREFERENCE）
- **重複排除**: 永久記憶と部分文字列一致するレコードを自動除外
- **フォールバック**: メモリ検索失敗時は通常のチャットとして動作

#### ③ 短期記憶（ローリング要約）
- フロントエンドは `{ message, sessionId }` のみ送信
- Lambda が DynamoDB から要約 + 直近10件メッセージを取得してプロンプト構築
- 5ターンごとに Haiku 4.5 で非同期要約生成
- DynamoDB: `SESSION#{sessionId}`（TTL 7日）+ `MSG#`（セッションメッセージ）

### コンポーネント層（src/components/ — 17コンポーネント）

| コンポーネント | 説明 |
|---------------|------|
| `ChatUI` | メッセージ履歴・入力・送信・TTS トグル・音声入力・メッセージ個別読み上げボタン |
| `MapView` | Leaflet マップ表示（OpenStreetMap タイル、マーカー＋ポップアップ＋Google Maps リンク） |
| `Live2DCanvas` | PixiJS ベース Live2D 描画（ref で `playMotion`/`playExpression` 制御） |
| `ModelImporter` | ドラッグ&ドロップ・ファイル選択・モデルインポート |
| `Settings` | 設定画面（UI設定） |
| `ProfileModal` | ユーザープロフィール設定モーダル |
| `ErrorNotification` | エラー種別ごとのトースト通知（自動非表示） |
| `MotionPanel` | モーション・表情ボタンパネル |
| `OAuthCallback` | Google OAuth コールバック処理 |
| `SkillsModal` | スキル連携管理モーダル（Google カレンダー接続/切断） |
| `GroupChatScreen` | `/groups` のトップレベル画面（グループ一覧 or チャット表示） |
| `GroupList` | グループ一覧（グループ名・最新メッセージ・未読バッジ・WS ステータス） |
| `GroupChat` | グループチャット（N人対応・送信者名表示・WebSocket + ポーリングフォールバック） |
| `GroupInfoPanel` | グループ情報パネル（メンバー一覧・メンバー追加・グループ退出） |
| `UserCodeModal` | ユーザーコード共有・入力モーダル（フレンド追加） |
| `CreateGroupModal` | グループ作成モーダル（グループ名入力） |
| `AddMemberModal` | メンバー追加モーダル（フレンド選択 or ユーザーコード入力） |

### 認証（src/auth/）

| ファイル | 責務 |
|---------|------|
| `authClient.ts` | Cognito + Amplify 認証クライアント（SRP認証フロー） |
| `authStore.ts` | 認証状態管理（Zustand） |
| `AuthModal.tsx` | ログイン / サインアップ UI |
| `AuthProvider.tsx` | React Context 認証プロバイダー |
| `UserMenu.tsx` | ユーザーメニュー（ログアウト・プロフィール・スキル設定） |

認証ガード: `isAuthConfigured() && authStatus !== 'authenticated'` → ログイン促進画面。Cognito 未設定時はゲストモード。

### 状態管理（src/stores/）

**appStore.ts** — Zustand + persist。主要ステート：
`messages`, `isLoading`, `currentMotion`, `currentExpression`, `motionQueue`, `config`, `lastError`

**groupChatStore.ts** — Zustand（永続化なし、サーバーが信頼元）。主要ステート：
`friends`, `myUserCode`, `groups`, `activeGroupId`, `activeMessages`, `activeMembers`, `lastPollTimestamp`, `isSending`, `error`, `wsStatus`, `unreadCounts`

### プラットフォーム（src/platform/）

自動検出: `detectPlatform()` → `__TAURI__` / `Capacitor` / `'web'`

- `webAdapter`: 完全実装（localStorage, File API, Web Notifications）
- `tauriAdapter` / `capacitorAdapter`: スケルトン（Web API フォールバック）

### AWS インフラ（infra/）

| リソース | 説明 |
|---------|------|
| DynamoDB | `butler-assistant` テーブル（PK/SK + GSI1/GSI2、ポイントインタイム復旧、TTL） |
| Cognito | ユーザープール + SPA クライアント（SRP 認証） |
| API Gateway (REST) | REST API（CORS 設定済み、Cognito 認可） |
| API Gateway (WebSocket) | WebSocket API（JWT 認証、リアルタイムメッセージ配信） |
| Lambda × 29 | Node.js 22.x / ARM_64 |
| EventBridge | `rate(15 minutes)` → sessionFinalizer Lambda |
| AgentCore Memory | 中期記憶（SEMANTIC + USER_PREFERENCE ストラテジー） |

**Lambda 関数一覧:**

| 関数名 | エンドポイント | 説明 |
|--------|--------------|------|
| `butler-settings-get` | `GET /settings` | ユーザー設定取得 |
| `butler-settings-put` | `PUT /settings` | ユーザー設定更新 |
| `butler-messages-list` | `GET /messages` | メッセージ履歴取得 |
| `butler-messages-put` | `POST /messages` | メッセージ保存 |
| `butler-tts-synthesize` | `POST /tts/synthesize` | Amazon Polly 音声合成 |
| `butler-llm-chat` | `POST /llm/chat` | LLM チャット（Bedrock + Tool Use + 3層記憶） |
| `butler-llm-summarize` | （chat Lambda から非同期起動） | ローリング要約生成（Haiku 4.5） |
| `butler-extract-facts` | （sessionFinalizer から非同期起動） | 永久事実抽出（Haiku 4.5） |
| `butler-session-finalizer` | （EventBridge 15分ルール） | セッション終了検出 → extractFacts 起動 |
| `butler-memory-events` | `POST /memory/events` | AgentCore Memory イベント記録 |
| `butler-skills-callback` | `POST /skills/google/callback` | Google OAuth コールバック |
| `butler-skills-connections` | `GET /skills/connections` | スキル接続状態取得 |
| `butler-skills-disconnect` | `DELETE /skills/google/disconnect` | Google 連携解除 |
| `butler-friends-generate-code` | `POST /friends/code` | フレンドコード生成 |
| `butler-friends-get-code` | `GET /friends/code` | フレンドコード取得 |
| `butler-friends-link` | `POST /friends/link` | フレンドコードでリンク（双方向） |
| `butler-friends-list` | `GET /friends` | フレンド一覧取得 |
| `butler-friends-unfriend` | `DELETE /friends/{id}` | フレンド解除 |
| `butler-groups-create` | `POST /groups` | グループ作成 |
| `butler-groups-add-member` | `POST /groups/{id}/members` | グループメンバー追加（userId or userCode） |
| `butler-groups-leave` | `DELETE /groups/{id}/members/me` | グループ退出 |
| `butler-groups-members` | `GET /groups/{id}/members` | グループメンバー一覧取得 |
| `butler-groups-list` | `GET /groups` | グループ一覧取得（GSI2 updatedAt 降順） |
| `butler-groups-messages-list` | `GET /groups/{id}/messages` | グループメッセージ取得 |
| `butler-groups-messages-send` | `POST /groups/{id}/messages` | グループメッセージ送信 |
| `butler-groups-messages-poll` | `GET /groups/{id}/messages/new` | 新着メッセージポーリング |
| `butler-groups-messages-read` | `POST /groups/{id}/messages/read` | 既読位置更新 |
| `butler-ws-authorizer` | WebSocket `$connect` | Cognito JWT 認証（クエリパラメータ） |
| `butler-ws-connect` | WebSocket `$connect` | 接続レコード保存（DynamoDB TTL 2時間） |
| `butler-ws-disconnect` | WebSocket `$disconnect` | 接続レコード削除 |

## 環境変数

### フロントエンド（Vite）

| 変数 | 用途 |
|------|------|
| `VITE_COGNITO_USER_POOL_ID` | Cognito ユーザープール ID |
| `VITE_COGNITO_CLIENT_ID` | Cognito アプリクライアント ID |
| `VITE_API_BASE_URL` | API Gateway エンドポイント URL |
| `VITE_WS_URL` | WebSocket API エンドポイント URL |

### SSM Parameter Store（シークレット管理）

SSM パス `/butler-assistant/*` に保存。CDK デプロイ時に自動参照される。

| パラメータ | 用途 |
|-----------|------|
| `MEMORY_ID` | AgentCore Memory ID |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアント ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット |
| `GOOGLE_IOS_CLIENT_ID` | Google OAuth iOS クライアント ID |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) キー |
| `BRAVE_SEARCH_API_KEY` | Brave Search API キー |

## セキュリティ注意事項

- **LLM 通信**: Bedrock Lambda プロキシ経由。フロントエンドに API キーは不要（IAM ロールで認証）
- **ログ出力**: 認証トークンや機密情報をログやエラーメッセージに含めない
- **モデルファイル**: `validateModelFiles()` で妥当性検証必須
- **Cognito**: 上記環境変数で設定。未設定時はゲストモード
- **Google API キー**: Lambda 環境変数で管理。フロントエンドには露出しない
