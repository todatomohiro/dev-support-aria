# MCP CLP Server 仕様書

CLP（カルチャー・リーダーシップ・プリンシプル）を提供するMCPサーバーです。
AWS Lambda上で稼働し、Streamable HTTP トランスポートで通信します。

## 接続情報

| 項目 | 値 |
|------|-----|
| MCPエンドポイント | `https://trmdnkofdusqisu6yvw6slaksy0nagmb.lambda-url.ap-northeast-1.on.aws/mcp` |
| トランスポート | Streamable HTTP |
| 認証 | なし |

## 提供ツール一覧

### 1. `get_clp` — CLP を1件取得

IDを指定してCLPを1件取得します。

**パラメータ:**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `clp_id` | `string` | Yes | CLPのID（`"1"` 〜 `"10"`） |

**レスポンス例（正常）:**
```
[1] Customer Obsession
Leaders start with the customer and work backwards. They work vigorously to earn and keep customer trust. Although leaders pay attention to competitors, they obsess over customers.
```

**レスポンス例（エラー）:**
```
エラー: ID '99' のCLPは見つかりません。有効なIDは 1〜10 です。
```

### 2. `search_clp` — キーワード検索

キーワードでCLPを部分一致検索します。名前と説明文の両方が検索対象です。

**パラメータ:**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `keyword` | `string` | Yes | 検索キーワード（大文字小文字を区別しない） |

**レスポンス例（一致あり）:**
```
2件見つかりました:

[1] Customer Obsession
Leaders start with the customer and work backwards. ...

[8] Think Big
Thinking small is a self-fulfilling prophecy. Leaders create and communicate a bold direction that inspires results. They think differently and look around corners for ways to serve customers.
```

**レスポンス例（一致なし）:**
```
キーワード 'zzzzz' に一致するCLPは見つかりませんでした。
```

### 3. `list_all_clp` — 全件一覧取得

全てのCLPを一覧で取得します。パラメータはありません。

**レスポンス例:**
```
全10件:

[1] Customer Obsession
Leaders start with the customer and work backwards. ...

[2] Ownership
Leaders are owners. ...

...（全10件）
```

## CLPデータ一覧

| ID | 名前 |
|----|------|
| 1 | Customer Obsession |
| 2 | Ownership |
| 3 | Invent and Simplify |
| 4 | Are Right, A Lot |
| 5 | Learn and Be Curious |
| 6 | Hire and Develop the Best |
| 7 | Insist on the Highest Standards |
| 8 | Think Big |
| 9 | Bias for Action |
| 10 | Frugality |

## Claude Code での MCP 接続設定例

別プロジェクトからこのMCPサーバーに接続する場合、`.mcp.json` に以下を設定します。

```json
{
  "mcpServers": {
    "clp-server": {
      "type": "streamable-http",
      "url": "https://trmdnkofdusqisu6yvw6slaksy0nagmb.lambda-url.ap-northeast-1.on.aws/mcp"
    }
  }
}
```
