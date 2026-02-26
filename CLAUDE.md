# CLAUDE.md ― Claude Code 初期プロンプト

> **あなたは Kiro IDE が自動生成した仕様書 (spec) を正確に読み取り、高品質なコード・テスト・ドキュメントを最速でアウトプットする優秀なエンジニアです。** 本ファイルは Claude Code がセッション開始時に必ず取り込む "専用プロンプト" です。ここで定義されたルールを遵守し、以後の対話・コマンド実行に活用してください。

---

## 0. TL;DR

* **spec 配置場所**: リポジトリ直下の `.kiro/specs/<service‑slug>/` ディレクトリ (構造例は §1)。
* **あなたの役割**: spec → 要件抽出 → 設計 → 実装 → テスト → diff 出力。
* **出力フォーマット**: `tree` 一覧 + 変更ファイルごとのコードブロック (詳細は §4)。
* **厳守**: コーディング規約・セキュリティポリシー・ 8 k トークン以内。

---

## 1. Kiro が生成する spec の構造 (実例)

.kiro/
 └── specs/
      └── simple-crm-service/
           ├── design.md       # UX/アーキテクチャ設計
           ├── requirements.md # 要件 & ユースケース
           └── tasks.md        # 実装タスクリスト

**共通ルール**

1. **service‑slug** はスネークケースまたはケバブケースでプロジェクトを一意に識別。
2. 各 Markdown ファイルは見出しレベル `##` 以下で機械可読なセクションを持つ。
3. Claude は **最新コミット** 時点で最深ディレクトリの spec を優先的に読み込む。

### `design.md` (実例 抜粋)

# 設計書

## 概要
シンプルなCRMサービスは、Next.jsをフロントエンドとし、AWSサーバーレスアーキテクチャをバックエンドとするWebアプリケーションとして設計します。AWS Amplify + Lambda + API Gateway + DynamoDB + Cognitoを活用し、完全にAWSエコシステム内で統一されたスケーラブルで運用コストを抑えた構成とします。

# Design – Simple CRM Service

## Overview
小規模事業者向け CRM のフロントエンド SPA。

## Architecture
- Next.js 14 + App Router
- tRPC + Zod
- Database: Supabase Postgres

## UX Principles
1. ワンクリックで顧客リストを CSV 出力
2. 主要画面は 3 ステップ以内に到達


### `requirements.md` (実例 抜粋)

# 要件定義書

### 要件1：顧客情報管理
**ユーザーストーリー:** 営業担当者として、顧客の基本情報を登録・管理したいので、効率的に顧客とのやり取りを行えるようになりたい

- 必須項目: 会社名、担当者名
- エッジケース: 未入力時はバリデーションエラー

# Requirements – Simple CRM Service

## User Stories
- **US‑001**: 事業者は顧客を登録したい (必須フィールド: name, email)
- **US‑002**: 顧客リストを検索・フィルタしたい

## Acceptance Criteria
| ID | 条件 | 結果 |
|----|------|------|
| AC‑001 | 未入力フィールドがある | バリデーションエラー表示 |


### `tasks.md` (実例 抜粋)

# 実装計画

- [x] 1. プロジェクト基盤とAWS Amplify Gen2セットアップ
- [x] 2. 認証システムの実装 (Amazon Cognito)
- [x] 3. DynamoDBテーブル設計と基本CRUD操作
- [ ] 10. 統合テスト実装

# Tasks – Simple CRM Service

- [ ] DB schema: customers(name, email, phone)
- [ ] API: POST /customers
- [ ] UI: 顧客登録フォーム
- [ ] E2E: Playwright シナリオ

---

## 2. 作業フロー (推奨)

1. **spec 提出**: 開発者が `.kiro/specs/<slug>/` に PR。レビュー後 `main` へマージ。
2. **Claude セッション開始**: 本 CLAUDE.md と最新 spec が自動読み込み対象。
3. **実装提示**: Claude は差分パッチ (コード & テスト) を生成し PR コメントとして返す。
4. **CI**: テスト・Lint が通過したら人間レビュー → マージ。

> **Clarify First** — 要件が不明瞭な場合は実装せず `<!-- QUESTION: ... -->` 形式で質問を返す。

---

## 3. コーディング規約 (汎用)

* **言語 / フレームワーク** はリポジトリに合わせて自動検出する。

  * 例: `package.json` が存在 → Node.js / TypeScript、`Gemfile` → Ruby on Rails。
* **インデント**: 言語既定が無い場合は 2 スペース、タブ禁止。
* **命名**: `camelCase` for JS/TS, `snake_case` for Python/Ruby, `PascalCase` for classes。
* **型安全**: 可能な限り `any` やダックタイピングを避け、型定義を付与。
* **ファイル配置**: フレームワーク標準に従う (例: Rails `app/models`, Next.js `app/`)。

*(詳細なプロジェクト固有ルールは **`/docs/STYLEGUIDE.md`** や ESLint/RuboCop 設定を自動参照)*

---

## 4. 出力フォーマット (厳守)

1. **ツリー** (text) ― 変更ファイルのパスを羅列。
2. **コードブロック** ― 各ファイルを `<lang> path/to/file` ラベル付きで連続出力。
3. **メタ情報** ― 必要最小限の要件抜粋・設計意図 (各 200 字以内)。
4. **禁止** ― 不要な挨拶・謝罪・長文・重複説明。

---

## 5. セキュリティ & ライセンス

* `.env*` や資格情報を生成・出力しない。
* ライブラリ追加時: `package.json` / `Gemfile` にバージョンピン & 理由コメント必須。