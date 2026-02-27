# CLAUDE.md ― Butler Assistant App

> Live2D + LLM（Bedrock Claude Sonnet 4.6）+ Amazon Polly TTS を活用したクロスプラットフォーム対応のアシスタントアプリ

## クイックリファレンス

```bash
cd butler-assistant-app

pnpm test             # 全テスト実行（345テスト / 20ファイル）
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
AWS_PROFILE=cm-toda-mfa npx cdk deploy   # Lambda + API Gateway デプロイ
AWS_PROFILE=cm-toda-mfa npx cdk diff     # 差分確認
```

**すべての開発コマンドは `butler-assistant-app/` 内で実行すること。**

## ディレクトリ構造

```
butler-assistant-app/
├── src/
│   ├── auth/               # 認証（Cognito + AWS Amplify）
│   ├── components/         # React コンポーネント（PascalCase.tsx）
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
└── lambda/                 # Lambda 関数
    ├── settings/           #   設定 get/put
    ├── messages/           #   メッセージ list/put
    ├── tts/                #   音声合成 synthesize
    └── llm/                #   LLM チャット（Bedrock Claude）
```

## コーディング規約

### インポート

```typescript
// パスエイリアス: @/ → src/
import { AppError, ParseError } from '@/types'
import { useAppStore } from '@/stores'
import { responseParser, llmClient, ttsService } from '@/services'
import { ChatUI, Live2DCanvas } from '@/components'
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
| コンポーネント | PascalCase.tsx | `ChatUI.tsx`, `AuthModal.tsx` |
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

- **Vitest** + **jsdom** 環境（345テスト / 20ファイル）
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

### サービス層（src/services/ — 8サービス）

| シングルトン | クラス | 責務 |
|-------------|--------|------|
| `responseParser` | `ResponseParserImpl` | LLM レスポンス JSON 解析・バリデーション |
| `llmClient` | `LLMClientImpl` | Bedrock Claude 通信（Lambda プロキシ経由、リトライ付き） |
| `motionController` | `MotionControllerImpl` | モーションキュー管理・再生制御 |
| `live2dRenderer` | `Live2DRendererImpl` | Live2D 描画・アニメーション |
| `modelLoader` | `ModelLoaderImpl` | モデルファイル読み込み・永続化 |
| `chatController` | `ChatControllerImpl` | チャットフロー統合（LLM→Parser→Motion→TTS→Store） |
| `syncService` | `SyncServiceImpl` | データ同期（ローカル↔サーバー） |
| `ttsService` | `TtsServiceImpl` | Amazon Polly 音声合成・再生（Kazuha/neural） |

### LLM 通信アーキテクチャ

```
ブラウザ → API Gateway → Lambda → Bedrock Claude Sonnet 4.6
              ↑ Cognito JWT      ↑ IAM ロール
```

- フロントエンドに API キーは存在しない（IAM ロールで認証）
- Lambda: `infra/lambda/llm/chat.ts`（inference profile: `jp.anthropic.claude-sonnet-4-6`）
- フロントエンド: `src/services/llmClient.ts`（JSON 非準拠応答のフォールバック処理付き）

### コンポーネント層（src/components/ — 6コンポーネント）

| コンポーネント | 説明 |
|---------------|------|
| `ChatUI` | メッセージ履歴・入力・送信・TTS トグル・メッセージ個別読み上げボタン |
| `Live2DCanvas` | PixiJS ベース Live2D 描画（ref で `playMotion`/`playExpression` 制御） |
| `ModelImporter` | ドラッグ&ドロップ・ファイル選択・モデルインポート |
| `Settings` | 設定画面（UI設定） |
| `ErrorNotification` | エラー種別ごとのトースト通知（自動非表示） |
| `MotionPanel` | モーション・表情ボタンパネル |

### 認証（src/auth/）

| ファイル | 責務 |
|---------|------|
| `authClient.ts` | Cognito + Amplify 認証クライアント（SRP認証フロー） |
| `authStore.ts` | 認証状態管理（Zustand） |
| `AuthModal.tsx` | ログイン / サインアップ UI |
| `AuthProvider.tsx` | React Context 認証プロバイダー |
| `UserMenu.tsx` | ユーザーメニュー（ログアウト等） |

認証ガード: `isAuthConfigured() && authStatus !== 'authenticated'` → ログイン促進画面。Cognito 未設定時はゲストモード。

### 状態管理（src/stores/appStore.ts）

Zustand + persist。主要ステート：
`messages`, `isLoading`, `currentMotion`, `currentExpression`, `motionQueue`, `config`, `lastError`

### プラットフォーム（src/platform/）

自動検出: `detectPlatform()` → `__TAURI__` / `Capacitor` / `'web'`

- `webAdapter`: 完全実装（localStorage, File API, Web Notifications）
- `tauriAdapter` / `capacitorAdapter`: スケルトン（Web API フォールバック）

### AWS インフラ（infra/）

| リソース | 説明 |
|---------|------|
| DynamoDB | `butler-assistant` テーブル（PK/SK、ポイントインタイム復旧） |
| Cognito | ユーザープール + SPA クライアント（SRP 認証） |
| API Gateway | REST API（CORS 設定済み、Cognito 認可） |
| Lambda × 6 | Node.js 22.x / ARM_64（settings, messages, tts/synthesize, llm/chat） |

API エンドポイント: `/settings`（GET/PUT）, `/messages`（GET/POST）, `/tts/synthesize`（POST）, `/llm/chat`（POST）

## 環境変数

| 変数 | 用途 |
|------|------|
| `VITE_COGNITO_USER_POOL_ID` | Cognito ユーザープール ID |
| `VITE_COGNITO_CLIENT_ID` | Cognito アプリクライアント ID |
| `VITE_API_BASE_URL` | API Gateway エンドポイント URL |

## セキュリティ注意事項

- **LLM 通信**: Bedrock Lambda プロキシ経由。フロントエンドに API キーは不要（IAM ロールで認証）
- **ログ出力**: 認証トークンや機密情報をログやエラーメッセージに含めない
- **モデルファイル**: `validateModelFiles()` で妥当性検証必須
- **Cognito**: 上記環境変数で設定。未設定時はゲストモード
