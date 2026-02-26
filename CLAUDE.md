# CLAUDE.md ― Butler Assistant App

> **Live2D + LLM（Gemini/Claude）を活用したクロスプラットフォーム対応の執事アシスタントアプリケーション**

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| アプリ名 | Butler Assistant App |
| 説明 | 感情豊かなLive2Dキャラクターが対話するAIアシスタント |
| 対応プラットフォーム | Web / Desktop (Tauri) / Mobile (Capacitor) |
| 作業ディレクトリ | `butler-assistant-app/` |

---

## ディレクトリ構造

```
butler-assistant-app/
├── src/
│   ├── components/      # Reactコンポーネント
│   ├── services/        # ビジネスロジック（LLM、Live2D、モーション制御）
│   ├── stores/          # Zustand状態管理
│   ├── types/           # TypeScript型定義
│   ├── platform/        # プラットフォーム抽象化（Web/Tauri/Capacitor）
│   ├── lib/live2d/      # Live2Dモデル管理
│   ├── utils/           # ユーティリティ関数
│   └── __tests__/       # 統合テスト
├── public/
│   ├── models/          # Live2Dモデルファイル
│   └── live2d/core/     # Cubism SDK
├── src-tauri/           # Tauriデスクトップ設定
└── (ios|android)/       # Capacitorモバイル設定
```

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フロントエンド | React 19 + TypeScript |
| Live2D | pixi-live2d-display + PixiJS 7 |
| 状態管理 | Zustand |
| スタイリング | Tailwind CSS 4 |
| ビルド | Vite 7 |
| テスト | Vitest + fast-check（PBT） |
| デスクトップ | Tauri 2 |
| モバイル | Capacitor 8 |
| LLM | Gemini API / Claude API |

---

## 開発コマンド

```bash
cd butler-assistant-app

# 開発サーバー起動
pnpm dev

# テスト実行
pnpm test              # 全テスト
pnpm test:watch        # ウォッチモード
pnpm test:coverage     # カバレッジ

# ビルド
pnpm build

# 型チェック
pnpm typecheck

# Lint
pnpm lint

# デスクトップ（Tauri）
pnpm tauri:dev
pnpm tauri:build

# モバイル（Capacitor）
pnpm cap:sync
pnpm cap:ios
pnpm cap:android
```

---

## コーディング規約

### TypeScript

- **パスエイリアス**: `@/` を使用（例: `import { AppError } from '@/types'`）
- **型定義**: `src/types/` に集約、`index.ts` で再エクスポート
- **インターフェース実装**: `XxxImpl` クラス名 + `XxxService` インターフェース
- **エクスポート**: シングルトンは小文字（例: `export const responseParser`）

### コメント

- JSDocは**日本語**で記述
- メソッドには必ず説明コメントを付ける

```typescript
/**
 * LLMからのJSON文字列を解析
 * @param jsonString JSON形式の文字列
 * @returns 解析されたレスポンス
 */
parse(jsonString: string): ParsedResponse
```

### ファイル構成

| 種類 | 配置 | 命名 |
|------|------|------|
| コンポーネント | `src/components/` | PascalCase.tsx |
| サービス | `src/services/` | camelCase.ts |
| 型定義 | `src/types/` | camelCase.ts |
| テスト | `__tests__/` 同階層 | *.test.ts(x) |

### エラーハンドリング

- `src/types/errors.ts` の `AppError` 派生クラスを使用
- NetworkError, APIError, RateLimitError, ParseError, ValidationError, ModelLoadError

---

## テストの書き方

### ユニットテスト（Vitest）

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('ResponseParser', () => {
  it('正常なJSONレスポンスを解析できる', () => {
    const json = '{"text": "かしこまりました", "motion": "bow"}'
    const result = responseParser.parse(json)
    expect(result.text).toBe('かしこまりました')
    expect(result.isValid).toBe(true)
  })
})
```

### プロパティベーステスト（fast-check）

```typescript
import { test, fc } from '@fast-check/vitest'

// Feature: butler-assistant-app, Property 17: ラウンドトリップ
test.prop([structuredResponseArbitrary()])(
  'シリアライズ→パースでラウンドトリップが成立する',
  (response) => {
    const serialized = responseParser.serialize(response)
    const parsed = responseParser.parse(serialized)
    expect(parsed.text).toBe(response.text)
  },
  { numRuns: 100 }
)
```

---

## 仕様書の参照

仕様書は `.kiro/specs/butler-assistant-app/` に配置：

| ファイル | 内容 |
|----------|------|
| `requirements.md` | 要件定義（12要件 + 非機能要件） |
| `design.md` | アーキテクチャ設計、インターフェース定義 |
| `tasks.md` | 実装タスクリスト（26タスク） |

### タスク実装時の手順

1. `tasks.md` から対象タスクを確認
2. `requirements.md` で関連要件を参照（例: `_要件: 4.1, 4.2_`）
3. `design.md` でインターフェース仕様を確認
4. 実装 → テスト作成 → `tasks.md` のチェックボックスを更新

---

## 主要サービスとインターフェース

| サービス | ファイル | 責務 |
|----------|----------|------|
| LLMClient | `services/llmClient.ts` | Gemini/Claude API通信 |
| ResponseParser | `services/responseParser.ts` | JSON解析・バリデーション |
| MotionController | `services/motionController.ts` | モーション再生キュー管理 |
| Live2DRenderer | `services/live2dRenderer.ts` | Live2D描画・アニメーション |
| ModelLoader | `services/modelLoader.ts` | モデルファイル読み込み |
| ChatController | `services/chatController.ts` | チャットフロー統合制御 |

---

## セキュリティ注意事項

- **APIキー**: `.env` ファイルに保存、コードにハードコーディング禁止
- **ログ出力**: APIキーをログやエラーメッセージに含めない
- **モデルファイル**: 外部からの不正なファイル読み込みを検証

---

## 現在の実装状況

- **テスト**: 200テスト全てパス
- **主要機能**: サービス層・コンポーネント層・プラットフォーム層 実装済み
- **残タスク**: `tasks.md` の `- [ ]` マーク項目を参照

---

## クイックリファレンス

```bash
# テスト実行（必須）
cd butler-assistant-app && pnpm test

# 開発サーバー
pnpm dev

# 型チェック
pnpm typecheck
```
