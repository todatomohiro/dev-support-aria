# Butler Assistant App

Live2Dキャラクターが執事として対話するAIアシスタントアプリケーション。

## 概要

Butler Assistant Appは、Live2Dキャラクターを通じてAIと対話できるマルチプラットフォームアプリケーションです。Gemini API / Claude APIを使用し、キャラクターの感情表現やモーションを伴った自然な対話体験を提供します。

## 機能

- **Live2Dキャラクター表示**: カスタマイズ可能な3Dキャラクターによる対話
- **マルチLLMサポート**: Google Gemini / Anthropic Claude対応
- **感情表現**: AIの応答に応じたキャラクターの表情・モーション
- **マルチプラットフォーム**: Web / デスクトップ（Tauri）/ モバイル（Capacitor）
- **セキュアなAPIキー管理**: プラットフォームネイティブのセキュアストレージ
- **ダークモード**: ライト/ダークテーマ切り替え

## 技術スタック

- **Frontend**: React 19 + TypeScript + Vite
- **スタイリング**: Tailwind CSS
- **状態管理**: Zustand（永続化対応）
- **Live2D**: Cubism SDK for Web
- **LLM**: Google Generative AI / Anthropic Claude API
- **デスクトップ**: Tauri 2.0
- **モバイル**: Capacitor

## セットアップ

### 前提条件

- Node.js 18以上
- pnpm 9以上

### インストール

```bash
# 依存関係のインストール
pnpm install

# 開発サーバーの起動
pnpm dev
```

### 環境設定

APIキーは設定画面から入力します。初回起動時に設定画面が表示されます。

## スクリプト

```bash
# 開発サーバー起動
pnpm dev

# ビルド
pnpm build

# テスト実行
pnpm test

# テスト（UI付き）
pnpm test:ui

# リント
pnpm lint

# 型チェック
pnpm typecheck
```

## プロジェクト構造

```
src/
├── components/          # UIコンポーネント
│   ├── ChatUI.tsx       # チャットインターフェース
│   ├── Live2DCanvas.tsx # Live2D描画キャンバス
│   ├── Settings.tsx     # 設定画面
│   ├── ModelImporter.tsx# モデルインポート
│   └── ErrorNotification.tsx # エラー通知
├── services/            # ビジネスロジック
│   ├── llmClient.ts     # LLMクライアント（マルチプロバイダー）
│   ├── chatController.ts# チャット制御
│   ├── live2dRenderer.ts# Live2Dレンダリング
│   ├── motionController.ts# モーション制御
│   ├── responseParser.ts# レスポンスパーサー
│   └── modelRegistry.ts # モデル管理
├── stores/              # 状態管理
│   └── appStore.ts      # グローバルストア
├── platform/            # プラットフォーム抽象化
│   ├── index.ts         # プラットフォーム判定・エクスポート
│   ├── web.ts           # Web実装
│   ├── tauri.ts         # Tauri実装
│   └── capacitor.ts     # Capacitor実装
├── types/               # 型定義
│   └── index.ts         # 共通型
├── utils/               # ユーティリティ
│   └── performance.ts   # パフォーマンス関連
├── App.tsx              # メインアプリケーション
└── main.tsx             # エントリーポイント
```

## 設定

### LLM設定

- **Provider**: gemini / claude
- **Temperature**: 0.0 - 2.0（創造性の度合い）
- **Max Tokens**: 最大出力トークン数
- **System Prompt**: キャラクターの性格設定

### UI設定

- **Theme**: light / dark
- **Font Size**: 12 - 24px
- **Character Size**: キャラクター表示サイズ（50-200%）

## テスト

```bash
# 全テスト実行
pnpm test

# カバレッジ付き
pnpm test:coverage

# 特定ファイルのテスト
pnpm test src/services/__tests__/llmClient.test.ts
```

### テスト構成

- **ユニットテスト**: 各サービス・コンポーネント
- **統合テスト**: `src/__tests__/integration/`
  - チャットフロー
  - 設定フロー

## プラットフォーム対応

### Web

```bash
pnpm dev   # 開発
pnpm build # ビルド
```

### Tauri（デスクトップ）

```bash
pnpm tauri dev   # 開発
pnpm tauri build # ビルド
```

前提条件:
- Rust ツールチェーン
- プラットフォーム固有の依存関係（[Tauriドキュメント](https://tauri.app/v1/guides/getting-started/prerequisites)参照）

### Capacitor（モバイル）

```bash
pnpm cap add ios     # iOS追加
pnpm cap add android # Android追加
pnpm cap sync        # 同期
pnpm cap open ios    # Xcodeで開く
pnpm cap open android# Android Studioで開く
```

## Live2Dモデル

### モデルの追加

1. 設定画面から「モデルインポート」を選択
2. Live2D Cubism形式のモデルファイル（.model3.json）をドラッグ&ドロップ
3. モデルが自動的にロードされ、リストに追加

### サポート形式

- Cubism 3.x / 4.x モデル
- .model3.json + 関連アセット

## エラーハンドリング

アプリケーションは以下のエラーを適切に処理します：

- **NetworkError**: ネットワーク接続エラー
- **RateLimitError**: API利用制限
- **APIError**: APIレスポンスエラー
- **ParseError**: レスポンス解析エラー

エラー発生時はキャラクターが困った表情を見せ、ユーザーフレンドリーなメッセージを表示します。

## ライセンス

MIT License

## 貢献

Issue・Pull Requestを歓迎します。

## 作者

Butler Assistant Team
