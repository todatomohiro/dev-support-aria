# Ai-Ba 機能仕様書（実装ベース）

> コード内の定数・変数名・コメント・条件分岐から逆算した、実装済み機能の一覧とビジネスロジック

---

## 目次

1. [チャット（LLM 会話）](#1-チャットllm-会話)
2. [ストリーミング応答](#2-ストリーミング応答)
3. [3層記憶システム](#3-3層記憶システム)
4. [プロアクティブ・ブリーフィング](#4-プロアクティブブリーフィング)
5. [レートリミット（プラン制限）](#5-レートリミットプラン制限)
6. [LLM スキル（ツール実行）](#6-llm-スキルツール実行)
7. [音声合成（TTS）](#7-音声合成tts)
8. [音声会話（VoiceChat）](#8-音声会話voicechat)
9. [Live2D キャラクター制御](#9-live2d-キャラクター制御)
10. [トピック（テーマ）管理](#10-トピックテーマ管理)
11. [画像送信](#11-画像送信)
12. [フレンド機能](#12-フレンド機能)
13. [グループチャット](#13-グループチャット)
14. [MCP 接続（外部ツール統合）](#14-mcp-接続外部ツール統合)
15. [メモ機能](#15-メモ機能)
16. [天気アイコン表示](#16-天気アイコン表示)
17. [行動パターン分析](#17-行動パターン分析)
18. [センチメント分析](#18-センチメント分析)
19. [認証・認可](#19-認証認可)
20. [管理画面](#20-管理画面)
21. [コンテンツモデレーション](#21-コンテンツモデレーション)
22. [プラットフォーム対応](#22-プラットフォーム対応)

---

## 1. チャット（LLM 会話）

### 機能概要
ユーザーのテキスト入力を Bedrock Claude に送信し、テキスト + 感情 + モーション + メタデータを含む構造化 JSON で応答を返す。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **モデル選択** | `haiku`（デフォルト）/ `sonnet` / `opus` の 3 種。プランにより利用可能モデルが異なる |
| **推論パラメータ** | temperature: `0.7`（固定）、maxTokens: haiku=`2048`, sonnet=`2048`, opus=`4096` |
| **画像付き maxTokens** | haiku=`2048`, sonnet=`4096`, opus=`4096` |
| **Tool Use 上限** | 最大 `5` 回ループ（`MAX_TOOL_USE_ITERATIONS`） |
| **メッセージ履歴** | 直近 `20` 件を DynamoDB から取得してコンテキストに含む（`RECENT_MESSAGES_LIMIT`） |
| **メッセージ保存** | user/assistant 両方を DynamoDB に保存、TTL `7日` |
| **クライアント側バッファ** | `MAX_MESSAGE_HISTORY = 100`（appStore に保持する最大メッセージ数） |

### システムプロンプト構造

3ブロック + 2キャッシュポイントで構成：

```
[ブロック1: 静的共通] ← 全ユーザー共通、モデル設定反映済み
  <ai_config>       キャラクター設定 + 共通ルール + 感情基準
  <skills>          ツール使用ルール（静的部分）
  <response_format>  JSON 出力形式
  ── cachePoint ──

[ブロック2: ユーザー固有] ← ユーザーごとに固定
  <user_profile>       ニックネーム・性別・AI名
  <permanent_profile>  永久記憶（FACTS + PREFERENCES）
  ── cachePoint ──

[ブロック3: 動的] ← 毎リクエスト変動、キャッシュなし
  <current_datetime>  / <user_location>  / <user_context>
  <past_sessions>  / <current_session_summary>  / <session_checkpoints>
  <theme_context>  / <category_context>  / <subcategory_context>
  <work_context>  / <briefing_context>
```

### トピック自動命名ロジック

| 条件 | 動作 |
|------|------|
| **初回ターン**（`isNewTopic=true`） | LLM が `topicName` フィールドを出力 → フォールバック: ユーザー発言の先頭 `15` 文字（超過時は`…`付加） |
| **3ターン目**（`totalTurns===2` かつ `!renamedByUser`） | LLM が改善された `topicName` を再生成 |
| **手動リネーム後** | `renamedByUser='true'` フラグにより以降の自動命名をスキップ |

### カテゴリ別コンテキスト注入

カテゴリ付きテーマ（`category !== 'free'`）の場合：
- 過去セッション + ブリーフィングコンテキストを**除外**（トピック集中のため）
- `<category_context>` / `<subcategory_context>` を追加注入

---

## 2. ストリーミング応答

### 機能概要
WebSocket 経由でテキスト差分をリアルタイム送信し、タイプライター表示する。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **プロトコル** | REST POST → `202 {streamed: true, requestId}` で即時返却 → WebSocket で差分送信 |
| **フォールバック** | WebSocket 接続がない場合は REST レスポンスで全文返却 |
| **アイドルタイムアウト** | `45秒`（`STREAM_IDLE_TIMEOUT_MS`）— WebSocket delta が途絶えたら中断 |
| **タイムアウト確認間隔** | `5秒`（`CHECK_INTERVAL_MS`） |

### WebSocket メッセージ型

| type | ペイロード | タイミング |
|------|-----------|-----------|
| `chat_delta` | `{requestId, delta}` | テキスト差分（逐次） |
| `chat_tool_start` | `{requestId, tool}` | ツール実行開始 |
| `chat_tool_result` | `{requestId, tool}` | ツール実行完了 |
| `chat_complete` | `{requestId, content, themeName?, workStatus?, tokenUsage?}` | 応答完了 |
| `chat_error` | `{requestId, error}` | エラー発生 |

### フロントエンド JSON パース

| 関数 | アルゴリズム |
|------|------------|
| `extractStreamingText()` | 正規表現 `/\{[\s]*"/` で最初の JSON オブジェクト位置を検出 → 以降を除去。先頭が `{` の場合は `"text"` フィールド値を抽出 |
| `findJsonObjects()` | ブレース深度追跡パーサー。文字列リテラル内のエスケープ (`\"`, `\\`) を考慮。完全な JSON オブジェクトを配列で返却 |
| `parseStreamedContent()` | JSON オブジェクト配列を**逆順**探索し `"text"` フィールドを持つものを採用。emotion（デフォルト: `neutral`）、motion（デフォルト: `idle`）を抽出 |

---

## 3. 3層記憶システム

### 機能概要
短期（セッション）→ 中期（AgentCore）→ 永久（DynamoDB）の 3 層で記憶を管理。

### 3.1 短期記憶（セッション要約）

| 項目 | 制約・仕様 |
|------|-----------|
| **要約トリガー** | `5` ターンごと（`SUMMARY_INTERVAL`） |
| **実行方式** | Lambda 非同期呼び出し（`InvocationType: 'Event'`） |
| **ローリング要約** | 最大 `500` 文字。前回要約 + 新規メッセージを統合 |
| **セグメント要約** | JSON 形式。キーワード `2-3` 個 + 要約 `300` 文字 |
| **推論パラメータ** | temperature: `0.3`、maxTokens: ローリング=`1024`, セグメント=`512` |
| **チェックポイント** | `SUMMARY_CP#{timestamp}` として保存 |
| **TTL** | セッション/メッセージ/チェックポイントすべて `7日` |

### 3.2 中期記憶（AgentCore Memory）

| 項目 | 制約・仕様 |
|------|-----------|
| **保存先** | Amazon Bedrock AgentCore Memory |
| **戦略** | `SEMANTIC` + `USER_PREFERENCE` |
| **保持期間** | `30日` |
| **送信タイミング** | チャット応答後に fire-and-forget で `POST /memory/events` |
| **重複排除** | 永久記憶（FACTS + PREFERENCES 両方）との重複を `deduplicateRecords()` で自動排除 |

### 3.3 永久記憶（PERMANENT_FACTS）

| 項目 | 制約・仕様 |
|------|-----------|
| **FACTS 上限** | `40` 件（`MAX_FACTS`） |
| **PREFERENCES 上限** | `15` 件（`MAX_PREFERENCES`） |
| **1件あたり** | 最大 `50` 文字 |
| **統合閾値** | FACTS: `30` 件以上で統合（`FACTS_CONSOLIDATION_THRESHOLD`） |
| | PREFERENCES: `12` 件以上で統合（`PREFERENCES_CONSOLIDATION_THRESHOLD`） |
| **統合率** | 元の `60-70%` に圧縮（LLM による意味的統合） |
| **1回の抽出上限** | FACTS: `10` 件、PREFERENCES: `5` 件 |
| **抽出モデル** | Haiku 4.5（`BACKGROUND_MODEL_ID`）、temperature: `0.3`、maxTokens: `1024` |
| **オーバーフロー** | 上限超過時は古い方を切り捨て（`slice(-MAX)` で末尾を保持） |

### 3.4 セッション終了検出

| 項目 | 制約・仕様 |
|------|-----------|
| **EventBridge** | `rate(15 minutes)` で定期実行 |
| **無操作タイムアウト** | `30分`（`SESSION_TIMEOUT_MS`） |
| **プライベートセッション** | `isPrivate=true` → extractFacts をスキップ（記憶汚染防止）、ACTIVE_SESSION は削除 |

---

## 4. プロアクティブ・ブリーフィング

### 機能概要
時間帯に応じた挨拶を自動生成。カレンダー予定・ToDo・天気を事前取得して応答に反映。

### 5フェーズ・ブリーフィング

| フェーズ | 時間帯 | タイプ | 目的 |
|---------|--------|--------|------|
| Morning（朝） | 6:00-11:00 | main | 朝の挨拶 + 今日の予定 |
| Midday Support | 11:00-12:00 | support | 午前サポート |
| Afternoon（昼） | 12:00-17:00 | main | 午後の挨拶 |
| Evening Support | 17:00-19:00 | support | 夕方サポート |
| Night（夜） | 19:00-23:00 | main | 夜の挨拶 |

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **トリガー** | 認証完了 `3秒` 後 / `visibilitychange` イベント（`1秒` ディレイ） / `30分` ポーリング |
| **メッセージ** | `message === '__briefing__'` で送信 |
| **レートリミット** | **対象外**（カウントしない） |
| **メッセージ保存** | **しない**（揮発的な挨拶、DynamoDB に記録なし） |
| **フェーズ重複防止** | 本日のブリーフィングログを取得 → 同フェーズ消費済みならスキップ |
| **ブリーフィングログ TTL** | `8日`（7日分のスコアリング + 1日バッファ） |

### Support フェーズ・スキップ判定

Support フェーズ（`phaseType === 'support'`）は**反応スコア**に基づきスキップ可能：

| ユーザー反応 | スコア |
|-------------|--------|
| `engaged`（5文字超の返信） | `+1.0` |
| `dismissed`（5文字以下の返信） | `-0.5` |
| `ignored`（30秒以内に反応なし / 画面非表示） | `-1.0` |

- スコア計算期間: 直近 `7日` のログ
- **スコア < 0 → Support フェーズをスキップ**（ユーザーが煩わしく感じている判定）

### ブリーフィング反応計測

| 項目 | 制約・仕様 |
|------|-----------|
| **観察ウィンドウ** | `30秒`（`REACTION_TIMEOUT_MS`） |
| **engaged 判定** | 30秒以内にユーザーが `5文字超` のメッセージを送信 |
| **dismissed 判定** | 30秒以内にユーザーが `5文字以下` のメッセージを送信 |
| **ignored 判定** | 30秒以内に反応なし、または画面が非表示状態 |

### コンテキスト取得

- AgentCore Memory: 2クエリ（`"話題"`, `"感情・状況"`）
- Google Calendar: 今日 + 明日、最大 `10` 件
- Google Tasks: 今日 + 1週間以内、最大 `10` 件
- 天気: 現在地ベース（位置情報がある場合のみ）

---

## 5. レートリミット（プラン制限）

### 機能概要
プランに応じた日次/月次/Premium月次の利用制限。

### プラン別制限値

| プラン | 日次上限 | 月次上限 | Premium月次 | 利用可能モデル | 音声品質 |
|--------|---------|---------|-------------|--------------|---------|
| **Free** | 15 | 300 | 0 | haiku のみ | 電子（低品質） |
| **Paid** | 40 | 1,000 | 60 | haiku, sonnet, opus | 電子（低品質） |
| **Platinum** | 無制限 | 無制限 | 200 | haiku, sonnet, opus | ナチュラル |

### チェック順序

以下の順序で評価し、**最初に該当した制限で即座に拒否**：

1. **モデル許可チェック** — プランの `allowedModels` にリクエストの `modelKey` が含まれるか
2. **日次上限** — `dailyUsed >= limit.daily`
3. **月次上限** — `monthlyUsed >= limit.monthly`
4. **Premium月次上限** — `isPremiumModel && premiumMonthlyUsed >= limit.premiumMonthly`

### 日付計算

- タイムゾーン: **JST（UTC+9）固定**
- 日次キー: `YYYY-MM-DD`（JST 日付）
- 月次キー: `YYYY-MM`（JST 月）
- リセット: 日次=JST 午前 0:00、月次=JST 月初 0:00

### 制限時メッセージ（キャラクター口調）

| 制限種別 | メッセージ概要 |
|---------|--------------|
| `daily_limit` | 「今日のお話回数の上限に達しちゃった…🥺 明日になったらまた話せるから、待っててね！」 |
| `monthly_limit` | 「今月のお話回数の上限に達しちゃった…🥺 来月になったらまたたくさんお話できるよ！」 |
| `premium_monthly_limit` | 「Premium モードの利用回数の上限に達しちゃった…🥺 Normal モードならまだ使えるよ！」 |
| `model_not_allowed` | 「Premium モードは有料プランで使えるよ！ Normal モードなら今すぐ使えるから試してみてね 😊」 |

---

## 6. LLM スキル（ツール実行）

### 機能概要
LLM が Tool Use で外部 API を呼び出し、結果を会話に反映する。

### 6.1 Google Calendar

| 項目 | 制約・仕様 |
|------|-----------|
| **list_events** | 必須: `timeMin`, `timeMax`（ISO 8601）。デフォルト maxResults: `10` |
| **create_event** | 必須: `summary`, `startDateTime`, `endDateTime`。任意: `description`, `location` |
| **タイムゾーン** | `Asia/Tokyo`（固定） |
| **表示形式** | `- {summary} : {start} 〜 {end} [場所: {location}]` |

### 6.2 Google Tasks

| 項目 | 制約・仕様 |
|------|-----------|
| **list_tasks** | 任意: `dueMin`, `dueMax`, `showCompleted`, `maxResults`（API デフォルト: `100`、表示デフォルト: `20`） |
| **create_task** | 必須: `title`。任意: `notes`, `due`（日付→ `T00:00:00.000Z` 変換） |
| **complete_task** | 必須: `taskId` |
| **日付フィルタ** | **コード側で実施**（Google Tasks API の `dueMin/dueMax` が不安定なため） |
| **対象リスト** | `@default` のみ（マルチリスト未対応） |
| **ステータス表示** | `✅`（完了）/ `⬜`（未完了） |

### 6.3 場所検索（Google Places）

| 項目 | 制約・仕様 |
|------|-----------|
| **検索半径** | `5,000m`（5km）— 位置情報がある場合の Circle bias |
| **最大結果数** | `5` 件（固定、ユーザー変更不可） |
| **取得フィールド** | `displayName`, `formattedAddress`, `location`, `rating` |
| **言語** | `ja`（日本語固定） |
| **API バージョン** | Google Places API v1（新版） |

### 6.4 Web 検索（Brave Search）

| 項目 | 制約・仕様 |
|------|-----------|
| **結果数** | `5` 件（固定） |
| **パラメータ** | `q`（検索クエリ）のみ |

### 6.5 天気予報（Open-Meteo）

| 項目 | 制約・仕様 |
|------|-----------|
| **予報期間** | `2日`（48時間） |
| **サンプリング** | 3時間ごと（0, 3, 6, 9, 12, 15, 18, 21 時） |
| **取得項目** | 気温, 天気コード, 降水確率, 湿度, 風速 |
| **タイムゾーン** | `Asia/Tokyo` |
| **リトライ** | 最大 `3` 回、タイムアウト: `8秒`/回 |
| **API キー** | 不要（無料 API） |

### 全ツール定義一覧

| ツール名 | 必須パラメータ | 任意パラメータ |
|---------|--------------|--------------|
| `list_events` | timeMin, timeMax | maxResults(10) |
| `create_event` | summary, startDateTime, endDateTime | description, location |
| `list_tasks` | — | dueMin, dueMax, showCompleted, maxResults(20) |
| `create_task` | title | notes, due |
| `complete_task` | taskId | — |
| `search_places` | query | locationBias |
| `web_search` | query | — |
| `get_weather` | — | latitude, longitude |

---

## 7. 音声合成（TTS）

### 機能概要
LLM 応答テキストを音声に変換し、リップシンク付きで再生する。

### プロバイダー選択

| プロバイダー | 用途 | デフォルト音声 |
|------------|------|--------------|
| **Amazon Polly** | 標準品質 | `Kazuha`（neural エンジン） |
| **Aivis Cloud** | 高品質 | `modelUuid` で指定 |
| **Web Speech API** | ゼロレイテンシ・フォールバック | ブラウザデフォルト |

### テキスト前処理

| 処理 | ルール |
|------|--------|
| **Markdown 除去** | コードブロック / 見出し / リスト / 引用 / 表 / 太字・斜体 / インラインコード / リンク を除去 |
| **文分割** | `/(?<=[。！？\n])/g` で分割 |
| **最小チャンクサイズ** | `10文字`（未満は次チャンクに結合） |

### Aivis Cloud 固有仕様

| 項目 | 制約・仕様 |
|------|-----------|
| **テキスト上限** | `1,000文字`（コスト制約） |
| **文境界検出** | `/(?<=[。！？\n、])/g`（読点も含む） |
| **最小フレーズ長** | `8文字`（短すぎるフレーズは TTS しない） |
| **最小末尾テキスト** | `2文字`（極小テキストをスキップ） |
| **ストリーミング監視間隔** | `200ms` |
| **speaking rate** | `0.5` 〜 `2.0`（デフォルト: `1.0`） |
| **pitch** | `-1.0` 〜 `1.0`（デフォルト: `0`） |

### 感情別音声パラメータ（Aivis）

| 感情 | speakingRate | pitch |
|------|-------------|-------|
| neutral | 1.0 | 0 |
| happy | 1.1 | +0.05 |
| excited | 1.15 | +0.1 |
| sad | 0.9 | -0.08 |
| angry | 1.05 | -0.05 |
| thinking | 0.9 | 0 |
| surprised | 1.1 | +0.1 |
| embarrassed | 1.0 | +0.03 |
| troubled | 0.9 | -0.05 |

### リップシンク

| 項目 | 制約・仕様 |
|------|-----------|
| **サンプリングレート** | `60 FPS`（`ENVELOPE_FPS`） |
| **RMS スケーリング** | `Math.min(1, rms * 4)` — 自然音量域 0-0.25 を 0-1 に変換 |
| **出力** | 音量コールバック → Live2D 口パラメーター |

### 再生戦略

- **単一チャンク**: 即座に合成 & 再生
- **複数チャンク**: 第1チャンク合成開始と同時に残りを並列合成 → 順次再生
- **安全タイムアウト**: `(audioBuffer.duration + 2) * 1000` ms（`onended` 未発火時の保険）
- **世代管理**: `generation` カウンターで新セッション開始時の旧再生を中断

---

## 8. 音声会話（VoiceChat）

### 機能概要
STT → LLM → TTS のリアルタイムパイプラインで、音声による対話を実現。

### 音声活動検出（VAD）

| 項目 | 制約・仕様 |
|------|-----------|
| **初期閾値** | `15`（`DEFAULT_VOLUME_THRESHOLD`） |
| **適応型キャリブレーション** | 起動後 `1.5秒`（`CALIBRATION_DURATION_MS`）でノイズ測定 → ベースライン × `2.0`倍（`CALIBRATION_MARGIN`） |
| **閾値範囲** | `5` 〜 `40`（`MIN_THRESHOLD` / `MAX_THRESHOLD`） |
| **発話終了判定** | 無音 `700ms`（`HYSTERESIS_MS`）継続で speech end |
| **FFT サイズ** | `512`、スムージング: `0.5` |
| **音声帯域** | `100Hz` 〜 `8,000Hz` |

### VoiceMode 特殊動作

LLM に以下の制約を指示：
- 応答を **1-3 文** に制限
- Markdown 書式を**無効化**
- 口語・自然な話し方スタイルを要求
- `suggestedReplies` を**無効化**
- `userMood` パラメータを受け付け（`calm` / `excited` / `low` / `tense` / `neutral`）→ トーン調整

---

## 9. Live2D キャラクター制御

### 機能概要
PixiJS + pixi-live2d-display で Live2D キャラクターを描画。感情→表情、モーションタグ→アニメーション。

### 表情制御

| 入力 | 出力 | 管理元 |
|------|------|--------|
| LLM の `emotion` フィールド | Live2D Expression | `emotionMapping`（管理画面で設定） |

**デフォルト感情タグ**: `neutral` / `happy` / `thinking` / `surprised` / `sad` / `embarrassed` / `troubled` / `angry` / `error`

### モーション制御

| 入力 | 出力 | 管理元 |
|------|------|--------|
| LLM の `motion` フィールド（省略可） | Live2D Motion | `motionMapping`（管理画面で設定） |

**デフォルトモーションタグ**: `idle` / `happy` / `thinking` / `surprised` / `sad` / `embarrassed` / `troubled` / `angry` / `error` / `motion1`-`motion6`

### アイドル自律行動

| 項目 | 制約・仕様 |
|------|-----------|
| **カーソルリセット** | 無操作 `3秒`（`IDLE_TIMEOUT_MS`）で正面向き |
| **初回モーション** | `15秒` 後（`IDLE_FIRST_MOTION_MS`） |
| **ループ開始** | `100秒` 後（`IDLE_LOOP_START_MS`） |
| **ループ間隔** | `30秒`（`IDLE_LOOP_INTERVAL_MS`） |
| **モーション候補** | `motionMapping` の `motion1`〜`motion6` → 未設定時は `DEFAULT_IDLE_MOTIONS = ['bow', 'smile', 'think']` |

### レイアウト

| 項目 | 制約・仕様 |
|------|-----------|
| **モバイル判定** | 高さ `350px` 未満（`MOBILE_HEIGHT_THRESHOLD`） |
| **モバイルスケール** | `Math.min(widthScale * 0.8, 1.0)` |
| **デスクトップ最大スケール** | `0.5`（`DESKTOP_MAX_SCALE`） |
| **モバイル Y 位置** | `originalH * scale * 0.4`（上半身フォーカス） |
| **解像度** | モバイル: `min(devicePixelRatio, 1.5)`、デスクトップ: `devicePixelRatio` |
| **リサイズ throttle** | `100ms` |

### キャラクター表示切替

| 状態 | 動作 |
|------|------|
| `characterVisible=true`（デフォルト） | Live2D キャンバス表示、天気アイコン重畳 |
| `characterVisible=false` | PixiJS `app.stop()`（GPU 節約）→ 折りたたみバー表示 → チャットエリア全画面 |

---

## 10. トピック（テーマ）管理

### 機能概要
カテゴリ別のトピックチャットを作成・管理する。

### トピックカテゴリ

| カテゴリ | ラベル | デフォルトモデル | 開発者限定 | サブカテゴリ |
|---------|--------|---------------|-----------|------------|
| `free` | 自由に相談 | haiku | — | なし |
| `life` | 生活について | sonnet | — | cleaning, appliances, cooking, health, childcare, relationships |
| `dev` | 開発について | sonnet | — | development, design, technology |
| `aiapp` | AIアプリ開発について | sonnet | **Yes** | new_feature, modify_feature, ui_display, ai_technology（各サブカテゴリに専用プロンプトあり） |

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **テーマID** | `crypto.randomUUID()` |
| **メッセージ取得上限** | デフォルト: `100` 件、最大: `500` 件（`Math.min(requested, 500)`） |
| **ソート** | 逆時系列。同一タイムスタンプ内は `user`/`transcript` → `assistant` の順 |
| **プライベートモード** | `isPrivate=true` → メッセージは保存されるが永久記憶抽出をスキップ |
| **assistant メッセージ抽出** | 3段階フォールバック: ① JSON パース → `.text` ② 正規表現 `\{[\s\S]*\}` → パース → `.text` ③ JSON 部分切り捨て |

---

## 11. 画像送信

### 機能概要
ファイル選択またはカメラ撮影した画像を base64 で LLM に送信。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **最大サイズ** | `5MB`（base64 換算: `Math.ceil(5 * 1024 * 1024 * 4 / 3)` ≈ 6.67MB） |
| **フォーマット検出** | マジックバイト判定 |
| **対応形式** | PNG（`89 50 4E 47`）/ GIF（`47 49 46`）/ WebP（`52 49 46 46` + `57 45 42 50`）/ JPEG（フォールバック） |
| **チャット表示** | メッセージバブル内サムネイル `240×180px` |
| **画像保持** | appStore に保存、`24時間` で自動期限切れ（`IMAGE_EXPIRY_MS`） |

---

## 12. フレンド機能

### 機能概要
フレンドコードの生成・共有によりユーザー間をリンク。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **コード形式** | `8文字`、文字セット: `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（曖昧文字 0/O, 1/I/L を除外） |
| **生成** | Crypto ランダムバイト → 文字セットマッピング |
| **一意性保証** | GSI1 で `USER_CODE#{code}` を検索 → 重複時は最大 `10回` リトライ |
| **永続性** | コードは**永久有効**（使い捨てではない） |
| **コード照合** | 大文字変換（`.toUpperCase()`）で照合 |
| **リンク方式** | **双方向**（トランザクショナル書き込みで両方の FRIEND# レコードを原子的に作成） |
| **自己防止** | 自分自身へのリンクは `409` エラー |
| **重複防止** | 既存の `FRIEND#{friendUserId}` レコードをチェック |

---

## 13. グループチャット

### 機能概要
複数ユーザーでリアルタイムグループチャット。WebSocket + ポーリングのハイブリッド。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **グループ作成** | サイズ上限なし。初期メンバー: 作成者のみ |
| **メンバー追加** | グループメンバーのみが追加可能。自己追加・重複追加は `400` エラー |
| **メッセージプレビュー** | `CONV_MEMBER.lastMessage` に先頭 `100文字` を保存 |
| **ソート** | GSI2 の `CONV_UPDATED#{timestamp}` で更新順 |
| **ポーリング** | WebSocket 不通時に `5秒` 間隔でフォールバック（`useGroupPolling` / `useThemePolling`） |
| **WebSocket 通知** | メッセージ送信時、全メンバーの WS 接続に `PostToConnection` でブロードキャスト |
| **既読管理** | 送信者は自動で `lastReadAt` 更新 |

---

## 14. MCP 接続（外部ツール統合）

### 機能概要
QR コードスキャンで外部 MCP サーバーに接続し、LLM からツールとして利用可能にする。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **同時接続上限** | `3` 接続/ユーザー（`MAX_CONNECTIONS_PER_USER`） |
| **TTL 範囲** | `1` 〜 `1,440分`（最大24時間） |
| **プロトコル** | JSON-RPC 2.0 over HTTP（Streamable HTTP） |
| **MCP バージョン** | `2025-03-26` |
| **リクエストタイムアウト** | `10秒`（JSON-RPC リクエスト） |
| **通知タイムアウト** | `5秒`（レスポンス不要の通知） |
| **レジストリコード** | `xxx-xxx-xxx` 形式 |
| **重複接続防止** | 同一 `registryCode` の再接続をチェック |
| **ツール登録** | MCP サーバーの `tools/list` レスポンスを DynamoDB に保存 → `mcp_` プレフィックス付きで LLM ツールとして登録 |
| **コンテキスト制御** | MCP アクティブ時はセッション履歴を除外（ツール汚染防止） |

---

## 15. メモ機能

### 機能概要
ユーザーがテキストメモを保存・検索・削除。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **タイトル上限** | `50文字`（`.slice(0, 50)` で強制切り詰め） |
| **本文上限** | `500文字`（バリデーション + 強制切り詰め） |
| **タグ上限** | 最大 `10` 個、各タグ最大 `20文字` |
| **ソース** | `chat`（チャットから保存）/ `quick`（直接保存） |
| **メモ ID** | `crypto.randomUUID()` |

---

## 16. 天気アイコン表示

### 機能概要
Live2D キャンバス上に現在の天気アイコンと気温をオーバーレイ表示。LLM は使用しない。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **API** | Open-Meteo（無料、API キー不要） |
| **ポーリング間隔** | `30分`（`POLL_INTERVAL_MS`） |
| **気温表示** | 小数点以下切り捨て（整数表示） |
| **昼夜判定** | API レスポンスの `is_day === 1` |
| **天気コード** | WMO 標準コード → SVG 線画アイコンにマッピング |
| **表示位置** | Live2D キャンバス左上 |

---

## 17. 行動パターン分析

### 機能概要
ユーザーの利用時間帯を記録し、パターンを分析。ブリーフィングタイミング最適化に活用。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **記録粒度** | 分単位（`YYYY-MM-DDTHH:mm`） |
| **記録先** | DynamoDB `ACTIVITY#{YYYY-MM-DD}`（`StringSet`） |
| **TTL** | `30日` |
| **パターンキャッシュ** | `6時間`（`CACHE_TTL_MS`）、localStorage に保存 |
| **オプトイン** | `activityLoggingEnabled=false`（デフォルト無効） |
| **分析項目** | 睡眠時間帯推定、ピーク活動時間、深夜利用頻度 |

---

## 18. センチメント分析

### 機能概要
ユーザーのテキストからキーワードベースで感情を推定し、Live2D 表情に反映。

### ビジネスロジック

| 項目 | 制約・仕様 |
|------|-----------|
| **キーワード数** | `80+` 個（日本語、8 感情カテゴリ） |
| **スコアリング** | キーワードの文字数が長いほど高スコア（`score += keyword.length`） |
| **感情→Expression マッピング** | happy→`exp_02`, sad→`exp_05`, surprised→`exp_04`, angry→`exp_08`, troubled→`exp_07`, embarrassed→`exp_06`, thinking→`exp_03`, neutral→`exp_01` |
| **オプトイン** | `sentimentEnabled=true`（デフォルト有効） |

---

## 19. 認証・認可

### 機能概要
Cognito + Amplify によるユーザー認証。管理画面は TOTP MFA 必須。

### メインアプリ

| 項目 | 制約・仕様 |
|------|-----------|
| **認証方式** | Cognito SRP フロー |
| **未設定時** | ゲストモード（認証なし） |
| **トークン** | ID Token を全 API リクエストの `Authorization` ヘッダーに付与 |
| **管理者判定** | `useAuthStore` の `isAdmin` フラグ |
| **開発者モード** | 管理者のみ表示可能 |

### 管理画面

| 項目 | 制約・仕様 |
|------|-----------|
| **認証方式** | Cognito SRP + TOTP MFA |
| **MFA 強制** | 未設定時は全ページブロック → `/mfa` 設定画面に遷移 |
| **ロールチェック** | `AdminGuard` で `role === 'admin'` を検証。非管理者は即拒否 |

### WebSocket 認証

| 項目 | 制約・仕様 |
|------|-----------|
| **トークン渡し** | クエリパラメータ `?token={JWT}` |
| **検証** | `CognitoJwtVerifier` で ID Token 検証 |
| **接続 TTL** | `2時間`（WS_CONN レコード） |

---

## 20. 管理画面

### 機能概要
管理者向けのユーザー管理・モデル管理ダッシュボード。

### 20.1 ユーザー管理

| 機能 | 制約・仕様 |
|------|-----------|
| **一覧表示** | `20件/ページ`、ページネーショントークン |
| **ロール変更** | `admin` / `user`。自分自身のロール変更は不可 |
| **プラン変更** | `free` / `paid` / `platinum`。即時反映 |
| **記憶閲覧** | FACTS（`40件`上限、`30件`統合閾値）/ PREFERENCES（`15件`上限、`12件`統合閾値）の表示 + 個別削除 |
| **行動ヒートマップ** | 直近 `30日`、1時間ごとのセル色: 0分=gray, 1-5=blue-100, 6-15=blue-200, 16-30=blue-400, 30+=blue-600 |

### 20.2 モデル管理

| 機能 | 制約・仕様 |
|------|-----------|
| **アップロード** | ZIP 展開 → `.model3.json` 自動検出 → S3 Presigned URL × N ファイル → finalize |
| **モデル名** | 最大 `50文字` |
| **説明** | 最大 `200文字` |
| **ステータス** | `active` / `inactive` トグル |
| **マッピング編集** | 感情→Expression、モーション→Motion の対応設定。Live2D プレビュー付き |
| **キャラクター設定** | name / age / gender / personality / speechStyle / prompt の各フィールド |
| **CDN** | `d10pmg1gpcr0qb.cloudfront.net` 経由で配信 |

---

## 21. コンテンツモデレーション

### 機能概要
Bedrock Guardrails による有害コンテンツの自動フィルタリング。

### フィルタカテゴリ & 強度

| カテゴリ | フィルタ強度 |
|---------|------------|
| VIOLENCE（暴力） | HIGH |
| HATE（ヘイト） | HIGH |
| INSULTS（侮辱） | MEDIUM |
| SEXUAL（性的） | HIGH |
| MISCONDUCT（不正行為） | HIGH |
| PROMPT_ATTACK（プロンプトインジェクション） | HIGH |

### ガードレール発動時の動作

| 項目 | 動作 |
|------|------|
| **検出条件** | `stopReason === 'guardrail_intervened'` |
| **メッセージ保存** | **しない** |
| **記憶保存** | **しない**（要約・永久記憶抽出すべてスキップ） |
| **応答** | 「この内容にはお答えできません。別の話題でお話ししましょう。」 |
| **感情** | `emotion: 'troubled'` |

---

## 22. プラットフォーム対応

### 機能概要
Web / iOS（Capacitor 8）のマルチプラットフォーム対応。

### プラットフォーム抽象化

| 機能 | Web | Capacitor (iOS) |
|------|-----|-----------------|
| **セキュアストレージ** | localStorage（JSON） | Preferences プラグイン |
| **ファイル選択** | `<input type="file">` | Camera プラグイン or ファイルピッカー |
| **プラットフォーム検出** | 自動（`currentPlatform`） | Capacitor API 検出 |

### デフォルト設定値

| 設定 | デフォルト値 |
|------|------------|
| theme | `light` |
| fontSize | `14` |
| characterSize | `100` |
| ttsEnabled | `false` |
| cameraEnabled | `false` |
| geolocationEnabled | `false` |
| sentimentEnabled | `true` |
| developerMode | `false` |
| characterVisible | `true` |
| themeCharacterVisible | `false` |
| activityLoggingEnabled | `false` |
| nickname | `''`（空） |
| honorific | `''`（空） |
| gender | `''`（空） |
| aiName | `''`（空） |

---

## 付録: 全定数・閾値一覧

### バックエンド（Lambda）

| 定数名 | 値 | ファイル | 用途 |
|--------|-----|---------|------|
| `MAX_TOOL_USE_ITERATIONS` | 5 | chat.ts | Tool Use 最大ループ回数 |
| `SUMMARY_INTERVAL` | 5 | chat.ts | 要約トリガーターン数 |
| `RECENT_MESSAGES_LIMIT` | 20 | chat.ts | セッション履歴取得件数 |
| `MAX_IMAGE_BASE64_LENGTH` | ~6.67MB | chat.ts | 画像サイズ上限（5MB） |
| `SESSION_TIMEOUT_MS` | 1,800,000ms | sessionFinalizer.ts | 無操作タイムアウト（30分） |
| `MAX_FACTS` | 40 | extractFacts.ts | 永久記憶 FACTS 上限 |
| `MAX_PREFERENCES` | 15 | extractFacts.ts | 永久記憶 PREFERENCES 上限 |
| `FACTS_CONSOLIDATION_THRESHOLD` | 30 | extractFacts.ts | FACTS 統合閾値 |
| `PREFERENCES_CONSOLIDATION_THRESHOLD` | 12 | extractFacts.ts | PREFERENCES 統合閾値 |
| `MAX_CONNECTIONS_PER_USER` | 3 | mcp/connect.ts | MCP 同時接続上限 |
| temperature (chat) | 0.7 | chat.ts | チャット推論温度 |
| temperature (background) | 0.3 | summarize.ts, extractFacts.ts | バックグラウンド推論温度 |

### フロントエンド

| 定数名 | 値 | ファイル | 用途 |
|--------|-----|---------|------|
| `MAX_MESSAGE_HISTORY` | 100 | performance.ts | メッセージバッファ上限 |
| `IMAGE_EXPIRY_MS` | 86,400,000ms | appStore.ts | 画像保持期間（24時間） |
| `STREAM_IDLE_TIMEOUT_MS` | 45,000ms | chatController.ts | WS アイドルタイムアウト |
| `REACTION_TIMEOUT_MS` | 30,000ms | chatController.ts | ブリーフィング反応計測ウィンドウ |
| `DEFAULT_VOLUME_THRESHOLD` | 15 | useVAD.ts | VAD 初期音量閾値 |
| `HYSTERESIS_MS` | 700ms | useVAD.ts | 発話終了判定無音時間 |
| `CALIBRATION_DURATION_MS` | 1,500ms | useVAD.ts | ノイズキャリブレーション期間 |
| `CALIBRATION_MARGIN` | 2.0 | useVAD.ts | ベースラインノイズ倍率 |
| `IDLE_FIRST_MOTION_MS` | 15,000ms | Live2DCanvas.tsx | 初回アイドルモーション遅延 |
| `IDLE_LOOP_START_MS` | 100,000ms | Live2DCanvas.tsx | アイドルループ開始 |
| `IDLE_LOOP_INTERVAL_MS` | 30,000ms | Live2DCanvas.tsx | アイドルループ間隔 |
| `MOBILE_HEIGHT_THRESHOLD` | 350px | Live2DCanvas.tsx | モバイルレイアウト判定 |
| `ENVELOPE_FPS` | 60 | ttsService.ts | リップシンクサンプリングレート |
| `POLL_INTERVAL_MS` (briefing) | 1,800,000ms | useBriefing.ts | ブリーフィングポーリング（30分） |
| `POLL_INTERVAL_MS` (weather) | 1,800,000ms | useWeatherIcon.ts | 天気更新間隔（30分） |
| `CACHE_TTL_MS` (activity) | 21,600,000ms | activityPatternService.ts | パターンキャッシュ（6時間） |

### エラーモーション対応表

| エラー種別 | モーション |
|-----------|-----------|
| network | `troubled` |
| api | `troubled` |
| rateLimit | `sad` |
| parse | `surprised` |
| default | `troubled` |

### 挨拶時間帯区分

| 時間帯 | 範囲 |
|--------|------|
| morning | 5:00 - 10:59 |
| daytime | 11:00 - 16:59 |
| evening | 17:00 - 20:59 |
| night | 21:00 - 1:59 |
| lateNight | 2:00 - 4:59 |

### 不在期間区分

| 期間 | 区分 |
|------|------|
| 初回 | `firstTime` |
| 24時間未満 | `none` |
| 24-72時間 | `day` |
| 72-168時間 | `fewDays` |
| 168時間以上 | `week` |
