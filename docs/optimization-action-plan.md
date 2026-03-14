# Ai-Ba 最適化アクションプラン — 仮想エキスパートチーム分析

> 作成日: 2026-03-14
> 対象: Ai-Ba（アイバ）v2 — LLM + Live2D AIチャットアシスタント

---

## 【Step 1】プロンプトエンジニア / LLM最適化スペシャリスト

### 1-1. JSON出力の安定化

#### 現状の課題

現在のレスポンスフォーマット指示（`buildJsonInstruction()`）は、JSON 全体を自然言語テキストの中に埋め込む形式で出力させている。フロントエンド（`extractStreamingText()`）は `search(/\{[\s]*"/)` で JSON 開始位置を検出し、`findJsonObjects()` でブレース深度追跡パースを行っている。

この方式の問題点:
- LLM が `text` フィールド内にネストされた JSON（コードスニペット等）を含む場合、パーサーが誤検出する可能性がある
- `extractTextFieldFromJson()` に3段階のフォールバック（JSON直接パース → 正規表現抽出 → シングルクォート変換）が必要な状態
- `stripEmbeddedJsonFragments()` で `suggestedReplies` の混入除去が必要

#### 提案

**A. Structured Output のための Prefill テクニック（推奨・低コスト）**

現在の response_format 指示に加え、assistant メッセージの先頭を `{"text": "` で Prefill することで、LLM が確実に JSON から出力を開始するよう強制する。

```typescript
// toConverseMessages() の最後に追加
messages.push({
  role: 'assistant',
  content: [{ text: '{"text": "' }],
})
```

これにより:
- `extractStreamingText()` の JSON 開始位置検出が不要に
- 平文テキスト + JSON 混在パターンを排除
- パースエラー率が大幅に低下

**注意**: ConverseStream API で assistant prefill がサポートされているか要確認。Messages API では対応済み。

**B. Few-shot の追加（中コスト・キャッシュ効率低下）**

response_format セクション内に 1〜2 例の模範回答を追加する:

```
例1（通常会話）:
{"text": "おはよう！今日はいい天気だね", "emotion": "happy"}

例2（場所検索時）:
{"text": "渋谷のカフェを探したよ！", "emotion": "happy", "mapData": {"center": ...}}
```

ただし、Few-shot はキャッシュブロック1（全ユーザー共通）のサイズを増加させるため、キャッシュ write コストとのトレードオフがある。Prefill 方式（A）で十分安定する場合は不要。

**C. Bedrock ToolUse のレスポンス形式への移行（将来検討）**

LLM の最終応答自体を Tool Use として定義し、JSON スキーマで出力を構造化する方式。Bedrock Converse API の `toolChoice: { tool: { name: 'respond' } }` で強制可能。

```typescript
const RESPONSE_TOOL: Tool = {
  toolSpec: {
    name: 'respond',
    description: 'ユーザーへの最終応答',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          emotion: { type: 'string', enum: ['neutral', 'happy', ...] },
          motion: { type: 'string' },
          mapData: { ... },
          suggestedReplies: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'emotion'],
      },
    },
  },
}
```

メリット: JSON パースエラーが原理的にゼロに。デメリット: ストリーミング時のテキスト先行表示が困難（ToolUse の入力 JSON はストリーム完了まで確定しない）。現在のストリーミング TTS パイプラインと相性が悪いため、**現時点では見送り**。

### 1-2. Tool Use の最適化

#### 現状の課題

- `MAX_TOOL_USE_ITERATIONS = 5` で直列ループ
- `get_weather` の description に「必ず直近のユーザーの発言で求められた地域のみを対象とする」という長い制約が必要（過去に不要な複数地域取得が発生した痕跡）
- ブリーフィング時はカレンダー・ToDo・天気を Lambda 内で事前呼び出し（`executeSkill()`）しているが、通常チャットでは LLM 判断で呼び出すため、不要なツール呼び出しが発生しうる

#### 提案

**A. ツール description の短縮と明確化**

```typescript
// Before（現在）
description: '天気予報を取得します。ユーザーが「天気を教えて」「明日の天気は？」...**【重要】必ず直近のユーザーの発言で...'

// After
description: '指定座標の天気予報を取得。地域の指定がなければ現在地を使用。1回の呼び出しで1地域のみ。'
```

短い description はトークン消費を削減し、LLM の判断精度も向上する（過剰な制約は逆にモデルを混乱させる）。

**B. ツール呼び出しの並列化**

現在のフロー:
```
LLM → tool_use(list_events) → Lambda → result → LLM → tool_use(get_weather) → Lambda → result → LLM → 最終応答
```

Bedrock Converse API は1回の応答で複数の tool_use ブロックを返せる。現在のコード（`streamConverseIteration`）は複数ツールを `toolUseBlocks` 配列に蓄積しているが、`executeSkill()` を直列で呼び出している。

```typescript
// 現在のツール実行ループ（chat.ts ハンドラー内）
for (const toolBlock of toolUseBlocks) {
  const result = await executeSkill(toolBlock.name, toolBlock.input, ...)
  // ...
}

// 提案: 並列実行
const toolResults = await Promise.all(
  toolUseBlocks.map(toolBlock =>
    executeSkill(toolBlock.name, toolBlock.input, ...)
      .then(result => ({ toolUseId: toolBlock.toolUseId, result }))
  )
)
```

これだけで、2つ以上のツールが同時に呼ばれるケース（例: 「明日の天気と予定を教えて」）のレイテンシが半減する。

**C. ブリーフィング時のツール事前呼び出し最適化**

現在ブリーフィングでは `executeSkill('list_events', ...)`, `executeSkill('list_tasks', ...)`, `executeSkill('get_weather', ...)` を直列で呼び出している。これらは互いに依存しないため `Promise.all` で並列化すべき。

```typescript
// 現在: 直列（カレンダー → ToDo → 天気 の3回待ち）
// 提案: 並列
const [calendarResult, tasksResult, weatherResult] = await Promise.allSettled([
  executeSkill('list_events', ...),
  executeSkill('list_tasks', ...),
  executeSkill('get_weather', ...),
])
```

### 1-3. Prompt Caching 戦略

#### 現状の評価

```
[キャッシュブロック1] 静的プロンプト（ai_config + skills + response_format）
  ── cachePoint ──
[キャッシュブロック2] ユーザー固有（user_profile + permanent_profile + user_preferences）
  ── cachePoint ──
[動的コンテキスト] current_datetime + user_location + user_context + past_sessions + ...
```

**良い点**:
- 全ユーザー共通の静的プロンプトが最初のキャッシュブロック → 最大のヒット率
- ユーザー固有データが2番目 → 同一ユーザーの連続会話でヒット

**改善点**:

1. **モデルメタデータによるキャッシュブロック1の分岐問題**: `buildStaticSystemPrompt()` が `modelMeta`（characterConfig, emotionMapping, motionMapping）を引数に取るため、モデルが異なるとキャッシュブロック1が変わる。ユーザーがモデルを切り替えるとキャッシュミスが発生する。

   **対策**: モデル非依存の共通部分（COMMON_RULES_PROMPT + SKILL_RULES_PROMPT）をキャッシュブロック0として分離し、モデル依存部分を別ブロックにする。ただし Bedrock の cachePoint は最大4箇所まで可能か要確認（現在は2箇所使用）。

2. **動的コンテキストの肥大化**: `past_sessions`（最大7日分）、`session_checkpoints`、`briefing_context` がすべて動的ブロックに含まれ、トークン数が会話の進行に伴い増大する。

   **対策**: `past_sessions` をユーザー固有キャッシュブロック2に移動する（同一セッション中はほぼ不変のため）。変化するのは `current_session_summary` のみ。

3. **`buildJsonInstruction()` の動的要素**: `emotionMapping` と `motionMapping` が変わるとキャッシュが無効化される。しかしこれらはモデル依存であり、セッション中に変わることはない → 現状のブロック1配置で問題なし。

#### 推奨構造

```
[ブロック1: 全ユーザー×全モデル共通]
  COMMON_RULES_PROMPT + SKILL_RULES_PROMPT
  ── cachePoint ──
[ブロック2: モデル別キャラクター + レスポンス形式]
  buildCharacterPrompt(modelMeta) + buildJsonInstruction(themeId, modelMeta)
  ── cachePoint ──
[ブロック3: ユーザー固有 + 過去セッション]
  user_profile + permanent_profile + user_preferences + past_sessions
  ── cachePoint ──
[動的コンテキスト]
  current_datetime + user_location + user_context + current_session_summary + checkpoints + theme_context
```

ただし Bedrock Converse API の cachePoint 上限を確認の上で決定。上限が2の場合は現行構造を維持し、past_sessions のみブロック2に移動する折衷案を採用。

---

## 【Step 2】RAG / AIエージェントアーキテクト

### 2-1. 記憶のコンソリデーション戦略

#### 現状の課題

`extractFacts.ts` の統合ロジック:
- `FACTS_CONSOLIDATION_THRESHOLD = 30` で LLM 統合を発火
- 統合時に「リスト末尾が最新」というルールで矛盾解消
- 完全一致の重複排除（`Set`）→ LLM 統合 → 上限超過時は古いものから押し出し

問題点:
1. **部分一致の重複が残る**: `Set` は完全一致のみ。「東京在住」と「東京都千代田区在住」は重複として検出されない
2. **統合プロンプトが時間情報を持たない**: 各事実にタイムスタンプがないため、「来月から大阪に転勤」が3ヶ月後も残る
3. **統合結果の検証が甘い**: `consolidated.length > items.length` のみ。統合で重要情報が欠落しても検出できない

#### 提案

**A. セマンティック重複検出の導入（中コスト）**

LLM 統合の前段で、Embedding ベースの類似度チェックを追加する。Bedrock Titan Embeddings で各事実をベクトル化し、コサイン類似度 > 0.85 のペアを事前にグルーピングしてから LLM に統合を依頼する。

ただし、永久記憶は最大55件（40 FACTS + 15 PREFERENCES）であり、全ペア比較は 55C2 = 1485 回。Embedding API のレイテンシを考えると、バッチ処理でも数秒かかる可能性がある。

**現実的な代替案**: 統合プロンプト（`FACT_CONSOLIDATION_PROMPT`）に「部分的に重複する事実も統合すること」を明示的に追加する。現在のプロンプトには「表現揺れの統合」はあるが「部分一致の統合」が弱い。

```
追加ルール:
- 包含関係にある事実（例: 「東京在住」と「東京都千代田区在住」）は、より具体的な方を残す
- 矛盾する事実がある場合は、時系列を考慮して最新の方を採用する
```

**B. タイムスタンプ付き永久記憶（低コスト・推奨）**

DynamoDB の `PERMANENT_FACTS` レコードに、各事実の最終更新日を持たせる:

```typescript
// 現在: facts: string[]
// 提案: facts: Array<{ text: string; updatedAt: string }>
```

統合プロンプトにタイムスタンプを渡すことで、「3ヶ月前の『来月転勤』はもう古い」と判断可能になる。

実装コスト:
- DynamoDB スキーマ変更（後方互換: 既存の string[] も受け付ける）
- `extractFacts.ts` の保存/統合ロジック修正
- `chat.ts` の `buildUserStaticPrompt()` 修正（タイムスタンプは注入しない or 「N日前に記録」形式で注入）

**C. 統合結果の差分検証（低コスト）**

統合後に、元のリストにあった「コアアイデンティティ」キーワード（家族名、勤務先、居住地など）が統合結果にも含まれているか検証する:

```typescript
function validateConsolidation(original: string[], consolidated: string[]): boolean {
  // 固有名詞（カタカナ・漢字の連続）を抽出して存在チェック
  const originalNames = extractProperNouns(original.join(' '))
  const consolidatedText = consolidated.join(' ')
  return originalNames.every(name => consolidatedText.includes(name))
}
```

### 2-2. セマンティック検索の最適化

#### 現状の課題

`retrieveMemoryRecords()` は単一のクエリ文字列で AgentCore Memory を検索:
```typescript
searchCriteria: { searchQuery: query }  // query = ユーザーのメッセージそのもの
```

ブリーフィング時は2つのクエリで並列検索:
```typescript
retrieveMemoryRecords(userId, '最近の会話の話題や気になっていたこと')
retrieveMemoryRecords(userId, 'ユーザーが悩んでいたこと、楽しみにしていること、頑張っていること')
```

問題点:
- 通常チャットではユーザーの生メッセージをそのまま検索クエリにしている → 「おはよう」「うん」のような短い発話では有意義な記憶が取得できない
- `maxResults: 10` は固定 → 関連性の低い記憶も含まれうる

#### 提案

**A. Query Rewriting（推奨・低コスト）**

ユーザーメッセージが短い（< 10文字）場合、直近の会話コンテキストを含めたクエリに拡張する:

```typescript
async function buildMemoryQuery(message: string, recentMessages: Array<{role: string; content: string}>): Promise<string> {
  if (message.length >= 10) return message

  // 直近3ターンのコンテキストを含めたクエリを生成
  const context = recentMessages.slice(-6).map(m => m.content).join(' ')
  return `${context} ${message}`.slice(0, 200)
}
```

**B. 検索結果のリランキング（中コスト）**

AgentCore Memory の検索結果に relevance score が含まれる場合、閾値以下のレコードをフィルタリング:

```typescript
const records = (result.memoryRecordSummaries ?? [])
  .filter(record => (record.score ?? 0) > 0.3)  // 低関連度を除外
  .map(record => record.content?.text)
  .filter(Boolean)
```

### 2-3. 文脈の競合解決

#### 現状の課題

プロンプト内に3つの記憶ソースが並列に存在:
1. `<permanent_profile>` — 永久記憶（FACTS）
2. `<user_context>` — 中期記憶（AgentCore Memory、30日）
3. `<past_sessions>` / `<current_session_summary>` — 短期記憶

矛盾例: 永久記憶「東京都在住」+ 中期記憶「大阪への転勤の話をした」+ 現セッション「引っ越し完了した」

現在の `deduplicateRecords()` は部分文字列一致で中期記憶から永久記憶と重複する内容を除外しているが、矛盾の解決はしていない。

#### 提案

**A. 時間的優先順位の明示（低コスト・推奨）**

COMMON_RULES_PROMPT に記憶の優先順位ルールを追加:

```
記憶の信頼性:
- 現在の会話でユーザーが言ったこと > 中期記憶（user_context）> 永久記憶（permanent_profile）
- 永久記憶と矛盾する内容をユーザーが現在の会話で言った場合、ユーザーの発言を信頼すること
- 「前は〇〇だったけど、今は〇〇なんだね」のように変化を自然に受け入れること
```

**B. 矛盾検出 + 動的更新（中コスト・将来）**

LLM のレスポンス内に `memoryUpdate` フィールドを追加し、矛盾を検出した場合に永久記憶の更新を提案させる:

```json
{
  "text": "大阪に引っ越したんだね！",
  "emotion": "surprised",
  "memoryUpdate": {
    "remove": ["東京都在住"],
    "add": ["大阪在住"]
  }
}
```

Lambda 側で `memoryUpdate` を受け取り、`PERMANENT_FACTS` を即時更新。ただし LLM の判断が誤る可能性があるため、ログを残して定期的に検証する仕組みが必要。

---

## 【Step 3】クラウドインフラ / パフォーマンスエンジニア

### 3-1. Tool Use ループのレイテンシ解消

#### 現状のフロー

```
REST POST /llm/chat → Lambda 起動
  → ConverseStreamCommand (1回目) → chat_delta → ... → tool_use
  → executeSkill() → 外部API呼び出し → ToolResult
  → ConverseStreamCommand (2回目) → chat_delta → ... → 最終応答
  → chat_complete → WebSocket プッシュ
  → HTTP 200 返却
```

ツール使用時は最低2回の Bedrock API 呼び出し + 外部 API 呼び出しが発生。Lambda 90秒タイムアウト内で完了する必要がある。

#### 提案

**A. ツール実行中のフロントエンド通知（低コスト・推奨）**

現在 `chat_tool_start` イベントは送信されているが、フロントエンドでの表示がどうなっているか要確認。

```typescript
// 現在のコード（chat.ts:1038-1043）
await wsPushAll(wsClient, connectionIds, {
  type: 'chat_tool_start',
  requestId,
  tool: currentToolUse.name,
})
```

フロントエンド側で `chat_tool_start` を受信したら:
- Live2D キャラクターに `thinking` モーション再生
- 「カレンダーを確認中...」「天気を調べ中...」等のステータス表示
- 音声モードではフィラー音声（「えーっと」「ちょっと待ってね」）を先行再生

**B. ツール並列実行の強化（中コスト）**

Step 1-2B で述べた `Promise.all` による並列化に加え、LLM に「可能な限り複数ツールを1回の応答で呼び出すこと」を指示する:

```
<skills> セクションに追加:
- 複数の情報が必要な場合（例: 天気と予定の両方）、可能な限り1回の応答で複数ツールを同時に呼び出してください
```

**C. Bedrock ConverseStream の応答キャッシュ（将来）**

同一ユーザーの同一セッション内で、同じツールが短時間に2回呼ばれるケース（例: 天気確認後に「傘いる？」と聞かれて再度天気取得）を防ぐため、ツール結果を Lambda 内でメモ化する:

```typescript
const toolResultCache = new Map<string, { result: ToolResultContentBlock[]; timestamp: number }>()
const TOOL_CACHE_TTL = 60 * 1000 // 60秒

async function executeSkillWithCache(name: string, input: Record<string, unknown>, ...args: any[]) {
  const cacheKey = `${name}:${JSON.stringify(input)}`
  const cached = toolResultCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < TOOL_CACHE_TTL) {
    return cached.result
  }
  const result = await executeSkill(name, input, ...args)
  toolResultCache.set(cacheKey, { result, timestamp: Date.now() })
  return result
}
```

### 3-2. ストリーミング・パイプラインのボトルネック排除

#### 現状のフロー

```
REST POST（streaming: true）
  → Lambda 起動、HTTP 202 即時返却
  → ConverseStreamCommand → chat_delta を WebSocket で逐次送信
  → chat_complete で完了通知
  → DynamoDB にメッセージ保存（updateSessionAndMaybeSummarize）
```

#### ボトルネック分析

1. **REST → Lambda → WebSocket の初期レイテンシ**: REST API Gateway のオーソライザ → Lambda コールドスタート → WebSocket 接続 ID 取得 → 最初の Bedrock API 呼び出しまでの時間
2. **DynamoDB 保存の直列実行**: `updateSessionAndMaybeSummarize()` でユーザー/アシスタントメッセージ保存 + セッション更新 + ACTIVE_SESSION upsert + テーマ更新が直列的に呼ばれている（一部は `Promise.all` だが、セッション更新は後続）
3. **要約 Lambda の非同期起動**: 3ターンごとに `InvokeCommand({ InvocationType: 'Event' })` で非同期起動。これ自体は問題ないが、起動のための `lambdaClient.send()` の時間（~50ms）がクリティカルパス上にある

#### 提案

**A. Lambda Provisioned Concurrency の導入（コスト要検討）**

LLM チャット Lambda（90秒タイムアウト）はコールドスタートが最も影響する。Provisioned Concurrency を1〜2に設定することで初回レイテンシを ~500ms → ~100ms に削減。

ただし Provisioned Concurrency はコストが高い（常時1インスタンス分の料金）。利用頻度が低い場合はコスト非効率。

**代替**: Lambda SnapStart（Java のみ対応、Node.js 未対応）。Node.js Lambda では AWS SDK の初期化を `global scope` に置く（現在対応済み）ことが最善。

**B. DynamoDB 保存のクリティカルパス外出し（低コスト・推奨）**

chat_complete をユーザーに送信した**後に** DynamoDB 保存を行う:

```typescript
// 現在: 保存 → chat_complete
// 提案: chat_complete → 保存（fire-and-forget）

// chat_complete をまず送信
await wsPushAll(wsClient, connectionIds, { type: 'chat_complete', ... })

// HTTP レスポンスを返す（Lambda のライフサイクルは継続）
// → DynamoDB 保存は HTTP レスポンス後に実行
```

ただし Lambda は HTTP レスポンス返却後にもコードが実行されるが、API Gateway の統合タイムアウト（29秒）に注意。現在は HTTP 202 を即時返却しているため、この問題は発生しない。

**実際の改善点**: `updateSessionAndMaybeSummarize()` 内の DynamoDB 操作を全て `Promise.all` で並列化する:

```typescript
// 現在: メッセージ保存(並列) → セッション更新 → ACTIVE_SESSION → テーマ更新
// 提案: 全て並列
await Promise.all([
  // メッセージ保存（user + assistant）
  dynamo.send(new UpdateItemCommand({ /* user msg */ })),
  dynamo.send(new UpdateItemCommand({ /* assistant msg */ })),
  // セッション更新
  dynamo.send(new UpdateItemCommand({ /* session record */ })),
  // ACTIVE_SESSION
  dynamo.send(new UpdateItemCommand({ /* active session */ })),
  // テーマ更新（条件付き）
  ...(themeId ? [dynamo.send(new UpdateItemCommand({ /* theme */ }))] : []),
])
```

**C. WebSocket 接続 ID のキャッシュ（低コスト）**

`getUserConnectionIds()` は毎回 DynamoDB GSI1 をクエリしている。同一リクエスト内で複数回呼ばれることはないが、ツールループ中に `wsPushAll` が繰り返し呼ばれる際、接続 ID は変わらない。ループ開始前に1回取得してキャッシュする（現在も概ねそうなっているが、明示的にループ外で取得を保証する）。

---

## 【Step 4】VUI / AI UX デザイナー

### 4-1. ターンテーキングの最適化

#### 現状の課題

ツール実行中（2〜10秒の空白時間）にユーザーが「フリーズした？」と感じるリスクがある。

#### 提案

**A. 思考中モーション + ステータスバブル（低コスト・推奨）**

`chat_tool_start` イベント受信時:
1. Live2D キャラクターに `thinking` モーション再生
2. チャット UI にステータスバブル表示:
   ```
   🔍 カレンダーを確認中...
   ```
3. ツール名 → 日本語ラベルのマッピング:
   ```typescript
   const TOOL_LABELS: Record<string, string> = {
     list_events: 'カレンダーを確認中',
     create_event: '予定を作成中',
     list_tasks: 'ToDoを確認中',
     search_places: 'お店を検索中',
     web_search: '情報を検索中',
     get_weather: '天気を確認中',
   }
   ```

**B. 音声モードでのフィラー発話（中コスト）**

音声会話モードでツール実行が始まった場合、定型フレーズの TTS を先行再生:
```
「ちょっと調べてみるね」
「えーっと、カレンダー見てみる」
「今確認するから待ってて」
```

これはキャラクター設定に応じたバリエーションが必要。`characterConfig.characterSpeechStyle` から適切なトーンのフィラーを選択する。

実装:
- フロントエンドの `chat_tool_start` ハンドラーで、事前録音またはリアルタイム TTS のフィラーを再生
- フィラーのキャラクターバリエーションは管理画面で設定可能にする（将来）

### 4-2. プロアクティブ機能の距離感

#### 現状の評価

ブリーフィング機能は既にかなり洗練されている:
- 6フェーズ制（深夜/朝/午前サポート/午後/夕方サポート/夜）
- サポートフェーズの反応スコアベース発火制御
- ブリーフィング履歴による重複排除
- 消化済みフェーズの簡潔化

#### 改善提案

**A. 初回起動時の「軽い接触」パターン（低コスト）**

アプリ起動後、ブリーフィングを受け取る前の数秒間に Live2D キャラクターが自然に動く（目線をこちらに向ける、軽く手を振るなど）ことで、ブリーフィングの「いきなり話しかけられる」感を軽減する:

```
[アプリ起動] → [Live2D 軽いモーション 1〜2秒] → [ブリーフィング開始]
```

**B. ブリーフィング拒否の学習強化（低コスト）**

現在の `userReaction` は `engaged / dismissed / ignored` の3段階。`ignored`（反応なし）のスコアが `-1` と最も重いが、これはアプリを閉じただけの場合にも適用される可能性がある。

提案: `ignored` のスコアを `-0.3` に軽減し、明示的な `dismissed`（×ボタン等）を `-1` にする。実際に不快だったケースのみを強くペナルティする。

**C. 「今日はお知らせなし」パターン（低コスト）**

カレンダー・ToDo・天気すべてが平穏で、過去の会話にも特筆事項がない場合、無理にブリーフィングを生成せず:
- キャラクターが手を振るだけ（モーションのみ、テキストなし）
- または1行の短い挨拶（「おはよ！今日は特になにもないよ」）

現在のプロンプトに「情報がほとんどない場合は、時間帯に合った短い挨拶だけでよい」とあるが、LLM はそれでも「何か言わなきゃ」と感じて無駄に長い挨拶を生成しがち。`skipped: true` レスポンスで Lambda 側から「ブリーフィング不要」と判定する分岐を追加する。

### 4-3. フォールバックとエラーリカバリー

#### 現状の課題

`extractTextFieldFromJson()` に3段階のフォールバックがあり、最終的にはテキストをそのまま返す。しかし、フロントエンドでの表示はどうなるか:
- JSON パース成功 → `text` フィールドを表示
- パース失敗 → 生テキスト全体を表示（JSON フラグメントが見える可能性）

#### 提案

**A. キャラクター世界観を保ったエラーメッセージ（低コスト・推奨）**

フロントエンドの `parseStreamedContent()` で JSON パースが失敗した場合:

```typescript
function getCharacterErrorMessage(): string {
  const messages = [
    'ごめん、ちょっと頭がこんがらがっちゃった…もう1回言ってくれる？',
    'あれ？うまく考えがまとまらなかった…もう一度聞いていい？',
    'ん〜ちょっと混乱しちゃった。もう1回教えて？',
  ]
  return messages[Math.floor(Math.random() * messages.length)]
}
```

キャラクター設定に応じたバリエーションが必要だが、初期実装ではデフォルトの3パターンで十分。

**B. 自動リトライ（中コスト）**

JSON パース失敗時に、Lambda 側で自動リトライ（同じメッセージで再度 Bedrock 呼び出し）する。ただし MAX_TOOL_USE_ITERATIONS のカウントに含めて無限ループを防止:

```typescript
if (parseError && retryCount < 1) {
  // システムプロンプトに「前回の出力がJSONとして不正でした。正しいJSON形式で再出力してください」を追加
  // 再度 ConverseStreamCommand を呼び出し
}
```

**C. Guardrail ブロック時の対話（低コスト）**

現在 Bedrock Guardrails がブロックした場合、メッセージ保存・記憶保存がスキップされる。フロントエンドでの表示は確認が必要だが、キャラクターの世界観を保ったブロックメッセージを用意する:

```
「えっと…その話題はちょっと苦手かも。別の話をしよう？」
```

---

## 【Step 5】プロダクトマネージャー統合

### 5-1. 提案間のコンフリクト解決

| コンフリクト | Step | 解決策 |
|---|---|---|
| Prefill テクニック (1-1A) vs ストリーミング TTS (3-2) | 1 vs 3 | Prefill は最初のチャンクが `{"text": "` 固定になるだけで、以降のストリーミングには影響なし → **共存可能** |
| cachePoint 増設 (1-3) vs Bedrock API 制約 | 1 | Bedrock cachePoint の上限確認が前提。上限2なら past_sessions 移動のみの折衷案 → **確認後に決定** |
| ツール description 短縮 (1-2A) vs ツールの誤発火防止 | 1 vs 4 | description を短くしつつ、重要な制約は残す。テストで誤発火率を検証 → **段階的に実施** |
| フィラー発話 (4-1B) vs 応答速度 (3-1) | 4 vs 3 | フィラーはフロントエンド側で完結し、バックエンドの処理とは非同期 → **共存可能** |
| DynamoDB 保存の並列化 (3-2B) vs データ整合性 | 3 | セッション更新とメッセージ保存は独立した DynamoDB レコード → **並列化しても整合性は維持** |
| 記憶タイムスタンプ (2-1B) vs DynamoDB スキーマ変更コスト | 2 | 後方互換設計で段階移行可能 → **長期的に有益だが優先度は中** |

### 5-2. インパクト × コスト マトリクス

```
                高インパクト
                    │
        ┌───────────┼───────────┐
        │  ★ A      │  C        │
        │  ★ B      │  E        │
  低コスト──────────┼──────────高コスト
        │  D        │  F        │
        │  G        │           │
        └───────────┼───────────┘
                    │
                低インパクト

A: ツール並列実行 + ブリーフィング並列化 (1-2B, 1-2C)
B: ターンテーキング UX改善 (4-1A: ステータスバブル + 思考中モーション)
C: Prompt Caching 最適化 (1-3)
D: 記憶の優先順位ルール追加 (2-3A)
E: 記憶タイムスタンプ導入 (2-1B)
F: Lambda Provisioned Concurrency (3-2A)
G: キャラクターエラーメッセージ (4-3A)
```

### 5-3. 直近1ヶ月のトップ3タスク

---

### タスク1: ツール実行の並列化 + ブリーフィング高速化

**インパクト**: ツール使用時のレイテンシを最大50%削減。ブリーフィングの初期表示を 2〜3 秒短縮。
**コスト**: 1〜2 日

#### 実装ステップ

1. **ブリーフィング時のツール事前呼び出し並列化** (chat.ts:2096-2153)
   ```typescript
   const [calResult, tasksResult, weatherResult] = await Promise.allSettled([
     executeSkill('list_events', calendarInput, 'briefing-cal', userId),
     executeSkill('list_tasks', tasksInput, 'briefing-tasks', userId),
     executeSkill('get_weather', weatherInput, 'briefing-weather', userId, undefined, userLocation),
   ])
   ```

2. **通常チャットのツール実行ループ並列化** (chat.ts のツールループ)
   ```typescript
   // 複数 toolUseBlocks を Promise.all で並列実行
   const toolResults = await Promise.all(
     toolUseBlocks.map(block => executeSkill(block.name, block.input, ...))
   )
   ```

3. **DynamoDB 保存の完全並列化** (updateSessionAndMaybeSummarize)
   - メッセージ保存、セッション更新、ACTIVE_SESSION upsert、テーマ更新を全て `Promise.all`

4. **ツール description の簡潔化** (toolDefinitions.ts)
   - 各ツールの description を 1 行に圧縮
   - 「複数ツールの同時呼び出し推奨」を SKILL_RULES_PROMPT に追加

5. **テスト**: 既存の Vitest テストが通ることを確認 + 手動テストで応答時間を計測

---

### タスク2: ターンテーキング UX 改善（思考中フィードバック）

**インパクト**: ツール使用時の「無応答感」を解消。ユーザー体感の待ち時間を心理的に短縮。
**コスト**: 2〜3 日

#### 実装ステップ

1. **フロントエンド: `chat_tool_start` ハンドラーの実装/強化**
   - `appStore` にツール実行中ステート（`activeToolName`）を追加
   - ツール名 → 日本語ラベルマッピングを定義

2. **ChatUI: ステータスバブルコンポーネント**
   - `activeToolName` が set されたらタイピングインジケーターの代わりにステータスバブルを表示
   - アニメーション付き（`...` の点滅など）

3. **Live2DCanvas: 思考中モーション連携**
   - `chat_tool_start` 受信時に `thinking` モーション再生
   - `chat_delta` 受信時（テキスト到着時）にモーションを中断して通常に戻す

4. **音声モード: フィラー発話**
   - `VoiceChatScreen` で `chat_tool_start` 受信時にフィラー TTS を再生
   - フィラーテキスト候補を3〜5パターン用意（キャラクター口調）
   - フィラー再生中に `chat_delta` が来たら自然にフェードアウト

5. **テスト**: ツール使用シナリオ（天気確認、予定作成等）で体験確認

---

### タスク3: 記憶の矛盾解決 + 検索精度向上

**インパクト**: AI が「知ったかぶり」「矛盾した発言」をする頻度を低減。相棒としての信頼感を向上。
**コスト**: 2〜3 日

#### 実装ステップ

1. **COMMON_RULES_PROMPT に記憶の優先順位ルール追加** (chat.ts)
   ```
   記憶の信頼性:
   - 現在の会話 > 中期記憶 > 永久記憶
   - 矛盾がある場合は最新の情報を信頼し、変化を自然に受け入れること
   ```

2. **Query Rewriting の実装** (chat.ts: retrieveMemoryRecords)
   - 短いメッセージ（< 10文字）の場合、直近の会話コンテキストを含めたクエリに拡張
   - セッションコンテキストの要約テキストをクエリのヒントとして追加

3. **抽出プロンプトの部分一致重複排除強化** (extractFacts.ts)
   - `FACT_EXTRACTION_PROMPT` に「記録済みリストとの部分一致も考慮して重複を除外すること」を追加
   - `FACT_CONSOLIDATION_PROMPT` に「包含関係にある事実は具体的な方を残す」を追加

4. **フロントエンド: JSON パース失敗時のキャラクターエラーメッセージ**
   - `parseStreamedContent()` 失敗時に定型エラーメッセージを表示
   - emotion: `troubled` を自動設定

5. **テスト**: 記憶の矛盾シナリオを手動テスト（プロフィール変更後の会話等）

---

### 実施スケジュール

| 週 | タスク | 完了条件 |
|---|---|---|
| Week 1 | タスク1: ツール並列化 | ブリーフィング並列化 + ツールループ並列化 + DynamoDB 並列化。テスト通過 |
| Week 2 | タスク2: ターンテーキング UX | ステータスバブル + 思考中モーション + フィラー発話。手動テスト完了 |
| Week 3 | タスク3: 記憶改善 | 記憶優先順位ルール + Query Rewriting + エラーメッセージ。手動テスト完了 |
| Week 4 | 統合テスト + デプロイ | 全タスクの統合テスト + CDK デプロイ + 本番確認 |

---

### 今後の検討事項（1ヶ月以降）

| 優先度 | 項目 | 備考 |
|---|---|---|
| 中 | Prompt Caching 3ブロック化 | Bedrock cachePoint 上限確認後 |
| 中 | 記憶タイムスタンプ導入 | DynamoDB スキーマ移行が必要 |
| 中 | Assistant Prefill によるJSON安定化 | ConverseStream API での対応確認後 |
| 低 | ToolUse レスポンス形式への移行 | ストリーミング TTS との両立が課題 |
| 低 | Provisioned Concurrency | コスト対効果の検証が必要 |
| 低 | API Gateway REST → HTTP API v2 移行 | ~50%レイテンシ削減（下記補足参照） |
| 低 | SessionFinalizer の ACTIVE_SESSION スキャン最適化 | GSI 活用で O(n) → O(1) |

---

## 補足: インフラ調査で判明した追加リスク

### A. SessionFinalizer の全件スキャン問題

`sessionFinalizer.ts` は EventBridge 15分ルールで `ACTIVE_SESSION` の全レコードをスキャンしている。ユーザー数増加時にスキャンコスト・実行時間が線形増加する。

**対策案**: `ACTIVE_SESSION` を `GSI1PK = ACTIVE_SESSION`, `GSI1SK = updatedAt` でソートし、30分以上前の `updatedAt` のみクエリする。これにより不要なレコード読み取りを回避。

### B. API Gateway の REST vs HTTP API

現在 REST API（v1）を使用。HTTP API（v2）は:
- ~100ms → ~50ms のオーバーヘッド削減
- コスト 70% 削減（$1.00/M → $0.30/M）
- ただし Cognito Authorizer の移行が必要（HTTP API は JWT authorizer を使用）

移行は Breaking Change を伴うため、次のメジャーリリース時に検討。

### C. フロントエンドのストリーミング堅牢性

フロントエンドの調査で判明した設計上の強み:
- **45秒アイドルタイムアウト**: iOS Safari でのハング防止（適切な値）
- **`findJsonObjects()` のブレース深度追跡**: ネストされた JSON に対応（堅牢）
- **エラー時の emotion マッピング**: NetworkError→troubled, RateLimit→sad, Parse→surprised（キャラクター一貫性維持）
- **画像の24時間自動削除**: base64 データの肥大化防止（セキュリティ + ストレージ）

改善の余地:
- `chat_tool_start` イベントは送信されているが、フロントエンドでの明示的な UX 処理が不足（タスク2で対応）
- `stripExpiredImages()` はリハイドレーション時のみ実行 → セッション中の長時間利用では古い画像が残る（低優先度）

### D. DynamoDB アクセスパターンの最適化候補

| 現在のパターン | 問題 | 改善案 |
|---|---|---|
| `getUserConnectionIds()` GSI1 クエリ | WS relay で毎回実行 | ツールループ開始前に1回取得してローカルキャッシュ（タスク1で対応） |
| Usage 3レコード個別 GetItem | 3回の I/O | BatchGetItem で1回に統合 |
| メモ検索 in-memory フィルタ | スケール不可 | DynamoDB contains() or GSI 検討（将来） |
