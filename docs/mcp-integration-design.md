# MCP 連携機能 設計書

> QR コードを起点に外部 MCP サーバーと接続し、AI チャットに一時的なコンテキスト・ツールを動的追加する機能

## 概要

MCP（Model Context Protocol）の仕組みを参考に、アプリケーションと外部システムを接続する。
QR コードを読み取ることで外部企業が用意した MCP サーバーに接続し、時限式でコンテキストやツールを利用できる。

## ユースケース例: 博物館

1. 博物館の展示横に QR コードを設置
2. ユーザーがアプリで QR コードをスキャン
3. AI チャットがその展示の情報を理解し、質問に回答できるようになる
4. 一定時間（例: 30分）経過後、自動的にアクセスが失効する

## アーキテクチャ

### 全体フロー

```
QR コード（展示横に設置）
  ↓ アプリでスキャン
アプリ（Cognito 認証必須）
  ↓ POST /mcp/connect { serverUrl, exhibitId, ttlMinutes }
Lambda（MCP 接続管理）
  ↓ 外部 MCP サーバーに接続 → 展示データ・ツール一覧を取得
DynamoDB に保存（TTL 付き）
  ↓
AI チャット（/llm/chat）
  ↓ ユーザーの MCP 接続を確認 → system prompt に展示コンテキスト注入
  ↓ 外部 MCP ツールが利用可能に
レスポンス返却
  ↓ 一定時間後
DynamoDB TTL で自動削除 → AI は展示情報にアクセスできなくなる
```

### 推奨アプローチ: Lambda が MCP クライアント

```
アプリ（フロントエンド）→ Lambda（MCP Client）→ 外部 MCP Server
```

- API キーやトークンがフロントエンドに露出しない
- 既存の Tool Use 基盤（`executeSkill`）を拡張する形で実装可能
- レート制限・監査ログなどのセキュリティ制御をサーバー側で一元管理
- MCP トランスポートは **Streamable HTTP** を使用（Lambda は長時間接続を維持できないため）

## QR コードの仕様

### QR コード内容

```json
{
  "type": "mcp",
  "serverUrl": "https://museum-api.example.com/mcp",
  "exhibitId": "exhibit-dinosaur-t-rex",
  "ttlMinutes": 30
}
```

- `type`: `"mcp"` 固定（アプリ側で MCP 接続であることを判別）
- `serverUrl`: 外部 MCP サーバーの URL
- `exhibitId`: 展示や対象の識別子
- `ttlMinutes`: 接続の有効期限（分）

### QR コードの運用

- 外部企業（博物館など）が QR コードを生成・設置
- QR コードは公開情報のため、アプリ側の Cognito 認証で不正利用を防止

## DynamoDB 設計

### MCP 接続レコード

```
PK: USER#{userId}
SK: MCP_CONNECTION#{serverId}#{exhibitId}
serverUrl: "https://museum-api.example.com/mcp"
serverId: "museum-xyz"
exhibitId: "exhibit-dinosaur-t-rex"
context: "（展示の説明テキストや関連情報）"
tools: [{ name: "get_exhibit_details", ... }, ...]
connectedAt: "2026-03-03T10:00:00Z"
ttlExpiry: 1709485200  ← TTL（接続から30分後に自動削除）
```

### アクティブ接続の取得

```
KeyConditionExpression: PK = :pk AND begins_with(SK, :prefix)
:pk = USER#{userId}
:prefix = MCP_CONNECTION#
```

LLM Lambda が呼び出し時にユーザーのアクティブ MCP 接続を取得し、system prompt に注入する。

## 3層記憶モデルとの統合

既存の記憶モデルに「一時コンテキスト層」として追加:

| 層 | 用途 | プロンプトタグ | TTL |
|----|------|---------------|-----|
| 永久記憶 | ユーザーの事実 | `<permanent_profile>` | なし |
| 中期記憶 | AgentCore Memory | `<user_context>` | 30日 |
| 短期記憶 | セッション要約 | `<current_session_summary>` | 7日 |
| **一時コンテキスト（新規）** | **MCP 接続データ** | **`<mcp_context>`** | **数十分** |

### system prompt 注入順序

```
<permanent_profile>...</permanent_profile>
<user_context>...</user_context>
<mcp_context>
  接続中: 恐竜博物館 - ティラノサウルス展示
  展示情報: ...
  利用可能なツール: get_exhibit_details, get_related_exhibits
</mcp_context>
<current_session_summary>...</current_session_summary>
```

## セキュリティ設計

### 認証・認可

- **認証**: QR スキャン後、Cognito 認証済みであることを必須とする
- **認可**: ユーザーごとに接続許可した MCP サーバーのみ使用可能（DynamoDB で管理）
- **同意**: 接続前にユーザーに capabilities を表示し、明示的な同意を取得

### 不正利用防止

- QR コードは公開情報 → アプリ認証（Cognito）で保護
- 接続は時限式（DynamoDB TTL）→ 無期限アクセスを防止
- レート制限: ユーザーあたりの同時 MCP 接続数を制限（例: 最大3件）
- 監査ログ: 接続・利用履歴を記録

### 外部 MCP サーバーの信頼

- 接続時に MCP サーバーの capabilities を取得し、ユーザーに表示
- 将来的には信頼済みサーバーのホワイトリスト管理も検討

## 必要な開発項目

### 新規 Lambda

| Lambda | エンドポイント | 説明 |
|--------|--------------|------|
| `butler-mcp-connect` | `POST /mcp/connect` | QR データを受け取り、外部 MCP サーバーに接続して DynamoDB に保存 |
| `butler-mcp-disconnect` | `DELETE /mcp/connections/{id}` | MCP 接続を手動削除 |
| `butler-mcp-list` | `GET /mcp/connections` | ユーザーのアクティブ MCP 接続一覧 |

### 既存 Lambda の拡張

| Lambda | 変更内容 |
|--------|---------|
| `butler-llm-chat` | ユーザーの MCP 接続を取得し、system prompt に `<mcp_context>` を注入。外部ツールを動的に `toolConfig` に追加 |

### フロントエンド

| コンポーネント | 説明 |
|---------------|------|
| `QRScanner` | Capacitor カメラで QR コードをスキャン |
| `McpConnectionModal` | 接続確認ダイアログ（capabilities 表示、同意取得） |
| `McpConnectionList` | アクティブ MCP 接続の一覧表示（手動切断ボタン付き） |

### サービス

| サービス | 説明 |
|---------|------|
| `mcpService` | MCP 接続管理（connect / disconnect / list） |

### 外部企業（博物館など）が用意するもの

- 展示データの API（JSON で展示名・説明・関連情報を返す）
- QR コードの生成・設置
- （フル MCP 対応時）MCP サーバーの運用

## 技術的な考慮事項

### MCP トランスポート

- Lambda からの接続は **Streamable HTTP** が現実的
- Lambda は長時間接続（WebSocket / SSE）を維持できないため、リクエスト・レスポンス型で通信

### Lambda タイムアウト

- 現在の LLM Lambda タイムアウト: 90秒
- 外部 MCP サーバーの応答が遅い場合のタイムアウト処理が必要
- MCP サーバーへのリクエストタイムアウト: 10秒程度を推奨

### 動的ツール定義

- 現在は静的な4ツール（list_events, create_event, search_places, web_search）
- MCP 接続時に外部ツールを `TOOL_DEFINITIONS` に動的追加
- `executeSkill` のルーティングを拡張し、MCP ツールは外部サーバーに転送

### 段階的な実装アプローチ

**Phase 1: コンテキスト注入のみ（シンプル版）**
- QR スキャン → 展示データを取得 → system prompt に注入
- 外部ツール実行なし、情報提供のみ

**Phase 2: 外部ツール連携**
- MCP サーバーのツールを動的に追加
- LLM が外部ツールを呼び出せるようにする

**Phase 3: プラットフォーム化**
- 外部企業向けの MCP サーバー構築ガイド
- 管理コンソール（接続統計、利用状況）
