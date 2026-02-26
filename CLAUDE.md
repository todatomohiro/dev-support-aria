# CLAUDE.md ― Butler Assistant App

> Live2D + LLM（Gemini/Claude）を活用したクロスプラットフォーム対応の執事アシスタントアプリケーション

## クイックリファレンス

```bash
cd butler-assistant-app

pnpm test           # 全テスト実行（200テスト / 13ファイル）
pnpm dev            # 開発サーバー（http://localhost:5173）
pnpm typecheck      # 型チェック
pnpm lint           # ESLint
pnpm build          # プロダクションビルド
```

## 作業ディレクトリ

**すべての開発コマンドは `butler-assistant-app/` 内で実行すること。**

## ディレクトリ構造

```
butler-assistant-app/
├── src/
│   ├── components/         # React コンポーネント（PascalCase.tsx）
│   │   └── __tests__/      # ChatUI, ModelImporter, Settings, ErrorNotification
│   ├── services/           # ビジネスロジック（camelCase.ts）
│   │   └── __tests__/      # 全6サービスのテスト
│   ├── stores/             # Zustand 状態管理（appStore.ts）
│   ├── types/              # 型定義・エラークラス・サービスインターフェース
│   ├── platform/           # プラットフォーム抽象化（Web/Tauri/Capacitor）
│   │   └── __tests__/      # platformAdapter.test.ts
│   ├── lib/live2d/         # Live2D Cubism SDK ラッパー
│   ├── utils/              # ユーティリティ（performance.ts）
│   └── __tests__/integration/  # 統合テスト（chatFlow, settingsFlow）
├── public/models/          # Live2D モデルファイル（mao_pro_jp）
├── public/live2d/core/     # Cubism SDK Core
├── src-tauri/              # Tauri 2 デスクトップ設定
├── ios/, android/          # Capacitor 8 モバイル
└── .kiro/specs/butler-assistant-app/  # 仕様書
```

## 現在の実装状況

**完了: 22/26 タスク** — 詳細は `.kiro/specs/butler-assistant-app/tasks.md` を参照

### 実装済み

- 型定義・エラークラス・サービスインターフェース（`src/types/`）
- 全6サービス（ResponseParser, LLMClient, MotionController, Live2DRenderer, ModelLoader, ChatController）
- 全6コンポーネント（ChatUI, Live2DCanvas, ModelImporter, Settings, ErrorNotification, MotionPanel）
- Zustand ストア（persist middleware 付き）
- プラットフォーム抽象化（Web 完全実装 / Tauri・Capacitor はスケルトン＋Web フォールバック）
- App.tsx 統合（初期化、テーマ、LLM設定、モーション連動）
- Tauri / Capacitor プロジェクトセットアップ
- テスト 200 件（13ファイル、全パス）
- README.md

### 未完了タスク

| タスク | 内容 | 備考 |
|--------|------|------|
| 19 | パフォーマンス最適化 | 60FPS確認、メモリリーク検出、応答性ベンチマーク |
| 20 | チェックポイント | タスク19完了後に実施 |
| 26 | 最終チェックポイント | 全プラットフォーム動作確認 |
| 12.3* | Live2DCanvas ユニットテスト | オプション |
| 24.2* | モデルインポート統合テスト | オプション |

## コーディング規約

### インポートとエクスポート

```typescript
// パスエイリアス: @/ → src/
import { AppError, ParseError } from '@/types'
import { useAppStore } from '@/stores'
import { responseParser, llmClient } from '@/services'
import { ChatUI, Live2DCanvas } from '@/components'
import { platformAdapter } from '@/platform'
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
| コンポーネント | PascalCase.tsx | `ChatUI.tsx`, `Live2DCanvas.tsx` |
| サービス | camelCase.ts | `llmClient.ts`, `responseParser.ts` |
| 型定義 | camelCase.ts | `config.ts`, `errors.ts` |
| テスト | *.test.ts(x) | 同階層の `__tests__/` 内に配置 |

### コメント・JSDoc

- **日本語**で記述
- メソッドには必ず JSDoc を付ける

### エラーハンドリング

`src/types/errors.ts` の `AppError` 派生クラスを使用：
`NetworkError` / `APIError` / `RateLimitError` / `ParseError` / `ValidationError` / `ModelLoadError`

## テスト

### テスト環境

- **Vitest** + **jsdom** 環境
- セットアップ: `src/__tests__/setup.ts`（Live2D SDK・PixiJS のモック定義済み）
- プロパティベーステスト: `fast-check`（`@fast-check/vitest`）、最低100回実行

### テストファイル一覧（13ファイル）

```
services/__tests__/   responseParser, llmClient, motionController,
                      live2dRenderer, modelLoader, chatController
components/__tests__/ ChatUI, ModelImporter, Settings, ErrorNotification
platform/__tests__/   platformAdapter
__tests__/integration/ chatFlow, settingsFlow
```

### テストの書き方

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('ServiceName', () => {
  it('テスト内容を日本語で記述', () => {
    // ...
  })
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

### サービス層（src/services/）

| シングルトン | クラス | 責務 |
|-------------|--------|------|
| `responseParser` | `ResponseParserImpl` | LLM レスポンス JSON 解析・バリデーション |
| `llmClient` | `LLMClientImpl` | Gemini/Claude API 通信（リトライ付き） |
| `motionController` | `MotionControllerImpl` | モーションキュー管理・再生制御 |
| `live2dRenderer` | `Live2DRendererImpl` | Live2D 描画・アニメーション |
| `modelLoader` | `ModelLoaderImpl` | モデルファイル読み込み・永続化 |
| `chatController` | `ChatControllerImpl` | チャットフロー統合（LLM→Parser→Motion→Store） |

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

### ユーティリティ（src/utils/performance.ts）

`MAX_MESSAGE_HISTORY`(100), `createVisibilityHandler`, `debounce`, `throttle`, `measurePerformance`, `createFPSCounter`, `getMemoryUsage`

## 仕様書

`.kiro/specs/butler-assistant-app/` に配置：

| ファイル | 内容 |
|----------|------|
| `requirements.md` | 要件定義（12要件 + 非機能要件） |
| `design.md` | アーキテクチャ設計・インターフェース定義 |
| `tasks.md` | 実装タスクリスト（26タスク、チェックボックス管理） |

### タスク実装時の手順

1. `tasks.md` で対象タスクを確認
2. `requirements.md` で関連要件を参照（例: `_要件: 4.1, 4.2_`）
3. `design.md` でインターフェース仕様を確認
4. 実装 → テスト作成 → `pnpm test` で全テスト通過を確認
5. `tasks.md` のチェックボックスを `[x]` に更新

## セキュリティ注意事項

- **APIキー**: `PlatformAdapter.saveSecureData()` で保存。コードにハードコーディング禁止
- **ログ出力**: APIキーをログやエラーメッセージに含めない
- **モデルファイル**: `validateModelFiles()` で妥当性検証必須
