# CLAUDE.md ― Butler Assistant App

> Live2D + LLM（Gemini/Claude）を活用したクロスプラットフォーム対応の執事アシスタントアプリケーション

## クイックリファレンス

```bash
cd butler-assistant-app

pnpm test             # 全テスト実行（328テスト / 20ファイル）
pnpm dev              # 開発サーバー（http://localhost:5173）
pnpm typecheck        # 型チェック
pnpm lint             # ESLint
pnpm build            # プロダクションビルド
pnpm test:coverage    # カバレッジ計測
pnpm tauri:dev        # Tauri デスクトップアプリ開発
pnpm cap:sync         # Capacitor モバイル同期
```

## 作業ディレクトリ

**すべての開発コマンドは `butler-assistant-app/` 内で実行すること。**

## ディレクトリ構造

```
butler-assistant-app/
├── src/
│   ├── auth/               # 認証（Cognito + AWS Amplify）
│   │   └── __tests__/      # AuthModal, authClient, authStore
│   ├── components/         # React コンポーネント（PascalCase.tsx）
│   │   └── __tests__/      # ChatUI, Live2DCanvas, ModelImporter, Settings, ErrorNotification
│   ├── services/           # ビジネスロジック（camelCase.ts）
│   │   └── __tests__/      # 全7サービス + performance テスト
│   ├── stores/             # Zustand 状態管理（appStore.ts）
│   ├── types/              # 型定義・エラークラス・サービスインターフェース
│   ├── platform/           # プラットフォーム抽象化（Web/Tauri/Capacitor）
│   │   └── __tests__/      # platformAdapter
│   ├── lib/live2d/         # Live2D Cubism SDK ラッパー
│   ├── utils/              # ユーティリティ（performance.ts）
│   └── __tests__/integration/  # chatFlow, settingsFlow, modelImportFlow
├── public/models/          # Live2D モデルファイル（mao_pro_jp）
├── public/live2d/core/     # Cubism SDK Core
├── src-tauri/              # Tauri 2 デスクトップ設定
├── ios/                    # Capacitor 8 iOS
└── .kiro/specs/butler-assistant-app/  # 仕様書（requirements, design, tasks）
infra/
├── bin/infra.ts            # CDK エントリーポイント
├── lib/butler-stack.ts     # AWS インフラ定義
└── lambda/                 # Lambda 関数（settings, messages）
```

## 実装状況

**全 26 タスク完了** — 詳細は `.kiro/specs/butler-assistant-app/tasks.md` を参照

| レイヤー | 状態 |
|---------|------|
| フロントエンド（React + TypeScript） | 完了 |
| 認証（Cognito + Amplify） | 完了 |
| バックエンド（CDK + Lambda + DynamoDB + API Gateway） | 完了 |
| テスト（328テスト / 20ファイル） | 全パス |
| マルチプラットフォーム（Web / Tauri / Capacitor iOS） | 完了 |

## コーディング規約

### インポートとエクスポート

```typescript
// パスエイリアス: @/ → src/
import { AppError, ParseError } from '@/types'
import { useAppStore } from '@/stores'
import { responseParser, llmClient } from '@/services'
import { ChatUI, Live2DCanvas } from '@/components'
import { platformAdapter } from '@/platform'
import { AuthProvider, AuthModal, useAuthStore, isAuthConfigured } from '@/auth'
```

### サービス実装パターン

```typescript
// インターフェース: src/types/services.ts に定義
// 実装: XxxImpl クラス名 + XxxService インターフェース
// エクスポート: シングルトン（小文字） + クラス（テスト用）

// 例: src/services/responseParser.ts
export class ResponseParserImpl implements ResponseParserService { ... }
export const responseParser = new ResponseParserImpl()  // シングルトン
```

### ファイル命名

| 種類 | 命名 | 例 |
|------|------|-----|
| コンポーネント | PascalCase.tsx | `ChatUI.tsx`, `AuthModal.tsx` |
| サービス | camelCase.ts | `llmClient.ts`, `syncService.ts` |
| 型定義 | camelCase.ts | `config.ts`, `errors.ts` |
| テスト | *.test.ts(x) | 同階層の `__tests__/` 内に配置 |

### コメント・JSDoc

- **日本語**で記述
- メソッドには必ず JSDoc を付ける

### エラーハンドリング

`src/types/errors.ts` の `AppError` 派生クラスを使用：
`NetworkError` / `APIError` / `RateLimitError` / `ParseError` / `ValidationError` / `ModelLoadError`

## テスト

- **Vitest** + **jsdom** 環境
- セットアップ: `src/__tests__/setup.ts`（Live2D SDK・PixiJS のモック定義済み）
- プロパティベーステスト: `fast-check`（`@fast-check/vitest`）、最低100回実行

### テストファイル一覧（20ファイル）

```
auth/__tests__/         AuthModal, authClient, authStore
services/__tests__/     responseParser, llmClient, motionController,
                        live2dRenderer, modelLoader, chatController,
                        performance, syncService
components/__tests__/   ChatUI, Live2DCanvas, ModelImporter, Settings, ErrorNotification
platform/__tests__/     platformAdapter
__tests__/integration/  chatFlow, settingsFlow, modelImportFlow
```

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

## 主要ファイルマップ

### 認証（src/auth/）

| ファイル | 責務 |
|---------|------|
| `authClient.ts` | Cognito + Amplify 認証クライアント（SRP認証フロー） |
| `authStore.ts` | 認証状態管理（Zustand） |
| `AuthModal.tsx` | ログイン / サインアップ UI |
| `AuthProvider.tsx` | React Context 認証プロバイダー |
| `UserMenu.tsx` | ユーザーメニュー（ログアウト等） |
| `isAuthConfigured()` | Cognito 設定有無判定（未設定時はゲストモード） |

### サービス層（src/services/）

| シングルトン | クラス | 責務 |
|-------------|--------|------|
| `responseParser` | `ResponseParserImpl` | LLM レスポンス JSON 解析・バリデーション |
| `llmClient` | `LLMClientImpl` | Gemini/Claude API 通信（リトライ付き） |
| `motionController` | `MotionControllerImpl` | モーションキュー管理・再生制御 |
| `live2dRenderer` | `Live2DRendererImpl` | Live2D 描画・アニメーション |
| `modelLoader` | `ModelLoaderImpl` | モデルファイル読み込み・永続化 |
| `chatController` | `ChatControllerImpl` | チャットフロー統合（LLM→Parser→Motion→Store） |
| `syncService` | `SyncServiceImpl` | データ同期（ローカル↔サーバー） |

### コンポーネント層（src/components/）

| コンポーネント | 説明 |
|---------------|------|
| `ChatUI` | メッセージ履歴・入力・送信・自動スクロール |
| `Live2DCanvas` | PixiJS ベース Live2D 描画（ref で `playMotion`/`playExpression` 制御） |
| `ModelImporter` | ドラッグ&ドロップ・ファイル選択・モデルインポート |
| `Settings` | 3タブ設定画面（APIキー / LLM設定 / UI設定） |
| `ErrorNotification` | エラー種別ごとのトースト通知（自動非表示） |
| `MotionPanel` | モーション・表情ボタンパネル |

### 状態管理（src/stores/appStore.ts）

Zustand + persist。主要ステート：
`messages`, `isLoading`, `currentMotion`, `currentExpression`, `motionQueue`, `config`, `lastError`

### プラットフォーム（src/platform/）

| アダプター | 状態 |
|-----------|------|
| `webAdapter` | 完全実装（localStorage, File API, Web Notifications） |
| `tauriAdapter` | スケルトン（TODO付き、Web API フォールバック） |
| `capacitorAdapter` | スケルトン（TODO付き、Web API フォールバック） |

自動検出: `detectPlatform()` → `__TAURI__` / `Capacitor` / `'web'`

### AWS インフラ（infra/）

| リソース | 説明 |
|---------|------|
| DynamoDB | `butler-assistant` テーブル（PK/SK、ポイントインタイム復旧） |
| Cognito | ユーザープール + SPA クライアント（SRP 認証） |
| API Gateway | REST API（CORS 設定済み） |
| Lambda | Node.js 22.x / ARM_64（settings get/put, messages list/put） |

### App.tsx 認証ガード

- `isAuthConfigured() && authStatus !== 'authenticated'` → メインコンテンツ非表示、ログイン促進画面表示
- Cognito 未設定（ゲストモード）→ 全機能表示

## セキュリティ注意事項

- **APIキー**: `PlatformAdapter.saveSecureData()` で保存。コードにハードコーディング禁止
- **ログ出力**: APIキーをログやエラーメッセージに含めない
- **モデルファイル**: `validateModelFiles()` で妥当性検証必須
- **Cognito**: 環境変数（`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`）で設定
