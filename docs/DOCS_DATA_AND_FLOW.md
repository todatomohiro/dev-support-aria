# Ai-Ba データ構造 & フロー図

> コード内の型定義・インターフェース・API エンドポイント実装に基づくデータモデルとシーケンス図

---

## 1. ER 図（DynamoDB スキーマ）

### 1.1 メインテーブル全体像

```mermaid
erDiagram
    USER_SETTINGS {
        string PK "USER#{userId}"
        string SK "SETTINGS"
        json data "nickname, honorific, gender, aiName"
        string updatedAt "ISO 8601"
    }

    USER_PLAN {
        string PK "USER#{userId}"
        string SK "PLAN"
        string plan "free | paid | platinum"
        string updatedAt "ISO 8601"
        string updatedBy "admin userId"
    }

    USER_ROLE {
        string PK "USER#{userId}"
        string SK "ROLE"
        string role "admin | user"
        string assignedAt "ISO 8601"
        string assignedBy "admin userId"
    }

    PERMANENT_FACTS {
        string PK "USER#{userId}"
        string SK "PERMANENT_FACTS"
        list facts "string[] 最大40件"
        list preferences "string[] 最大15件"
        string lastUpdatedAt "ISO 8601"
    }

    SKILL_CONNECTION {
        string PK "USER#{userId}"
        string SK "SKILL_CONN#google"
        string accessToken "encrypted"
        string refreshToken "encrypted"
        number expiresAt "Unix epoch"
        string platform "web | ios"
        string connectedAt "ISO 8601"
    }

    USER_CODE {
        string PK "USER#{userId}"
        string SK "USER_CODE"
        string code "8文字英数字"
        string GSI1PK "USER_CODE#{code}"
        string GSI1SK "USER_CODE"
        string createdAt "ISO 8601"
    }

    FRIEND {
        string PK "USER#{userId}"
        string SK "FRIEND#{friendUserId}"
        string friendUserId "対象ユーザーID"
        string displayName "表示名"
        number linkedAt "timestamp"
    }

    USER_SETTINGS ||--o| USER_PLAN : "同一ユーザー"
    USER_SETTINGS ||--o| USER_ROLE : "同一ユーザー"
    USER_SETTINGS ||--o| PERMANENT_FACTS : "同一ユーザー"
    USER_SETTINGS ||--o| SKILL_CONNECTION : "同一ユーザー"
    USER_SETTINGS ||--o| USER_CODE : "同一ユーザー"
    USER_SETTINGS ||--o{ FRIEND : "複数フレンド"
```

### 1.2 セッション & メッセージ

```mermaid
erDiagram
    SESSION {
        string PK "USER#{userId}"
        string SK "SESSION#{sessionId}"
        string summary "ローリング要約"
        string lastSummarizedAt "ISO 8601"
        string updatedAt "ISO 8601"
        number turnsSinceSummary "要約後ターン数"
        number totalTurns "合計ターン数"
        string createdAt "ISO 8601"
        number ttlExpiry "7日TTL"
    }

    SESSION_MESSAGE {
        string PK "USER#{userId}#SESSION#{sessionId}"
        string SK "MSG#{timestamp}#{role}"
        string role "user | assistant"
        string content "テキスト or JSON"
        number ttlExpiry "7日TTL"
    }

    SUMMARY_CHECKPOINT {
        string PK "USER#{userId}#SESSION#{sessionId}"
        string SK "SUMMARY_CP#{timestamp}"
        string summary "セグメント要約"
        list keywords "string[]"
        string createdAt "ISO 8601"
        number ttlExpiry "7日TTL"
    }

    ACTIVE_SESSION {
        string PK "ACTIVE_SESSION"
        string SK "userId#sessionId or userId#theme:themeId"
        string userId "ユーザーID"
        string sessionId "セッションID"
        string themeId "テーマID（任意）"
        boolean isPrivate "プライベートモード"
        string updatedAt "ISO 8601"
    }

    SESSION ||--o{ SESSION_MESSAGE : "複数メッセージ"
    SESSION ||--o{ SUMMARY_CHECKPOINT : "複数チェックポイント"
    SESSION ||--o| ACTIVE_SESSION : "アクティブ時のみ"
```

### 1.3 テーマ（トピック）

```mermaid
erDiagram
    THEME_SESSION {
        string PK "USER#{userId}"
        string SK "THEME_SESSION#{themeId}"
        string themeId "UUID"
        string themeName "トピック名"
        string modelKey "haiku | sonnet | opus"
        string category "free | life | dev | aiapp"
        boolean isPrivate "プライベートモード"
        string summary "ローリング要約"
        string lastSummarizedAt "ISO 8601"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
        number ttlExpiry "7日TTL"
    }

    THEME_MESSAGE {
        string PK "USER#{userId}#THEME#{themeId}"
        string SK "MSG#{timestamp}#{role}"
        string role "user | assistant"
        string content "テキスト or JSON"
        string createdAt "ISO 8601"
        number ttlExpiry "7日TTL"
    }

    THEME_CHECKPOINT {
        string PK "USER#{userId}#THEME#{themeId}"
        string SK "SUMMARY_CP#{timestamp}"
        string summary "セグメント要約"
        list keywords "string[]"
        string createdAt "ISO 8601"
        number ttlExpiry "7日TTL"
    }

    THEME_SESSION ||--o{ THEME_MESSAGE : "複数メッセージ"
    THEME_SESSION ||--o{ THEME_CHECKPOINT : "複数チェックポイント"
```

### 1.4 グループ & 会話

```mermaid
erDiagram
    GROUP_META {
        string PK "CONV#{groupId}"
        string SK "META"
        string groupName "グループ名"
        list participants "string[] ユーザーID一覧"
        string createdBy "作成者userId"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
    }

    GROUP_MESSAGE {
        string PK "CONV#{groupId}"
        string SK "CMSG#{timestamp_padded}#{messageId}"
        string id "メッセージID"
        string senderId "送信者userId"
        string senderName "表示名"
        string content "テキスト"
        number timestamp "Unix epoch"
        string type "text | system"
    }

    CONV_MEMBER {
        string PK "USER#{userId}"
        string SK "CONV_MEMBER#{groupId}"
        string conversationId "グループID"
        string groupName "グループ名"
        string updatedAt "ISO 8601"
        string lastMessage "最新メッセージ"
        string lastReadAt "ISO 8601"
        string GSI2PK "USER#{userId}"
        string GSI2SK "CONV_UPDATED#{timestamp}"
    }

    GROUP_META ||--o{ GROUP_MESSAGE : "複数メッセージ"
    GROUP_META ||--o{ CONV_MEMBER : "複数メンバー"
```

### 1.5 利用量 & WebSocket & モデル & その他

```mermaid
erDiagram
    USAGE_DAILY {
        string PK "USER#{userId}"
        string SK "USAGE_DAILY#{YYYY-MM-DD}"
        number count "メッセージ数"
        number ttlExpiry "2日TTL"
    }

    USAGE_MONTHLY {
        string PK "USER#{userId}"
        string SK "USAGE_MONTHLY#{YYYY-MM}"
        number count "メッセージ数"
        number ttlExpiry "35日TTL"
    }

    USAGE_PREMIUM {
        string PK "USER#{userId}"
        string SK "USAGE_PREMIUM_MONTHLY#{YYYY-MM}"
        number count "Premiumモデル使用数"
        number ttlExpiry "35日TTL"
    }

    WS_CONNECTION {
        string PK "WS_CONN#{connectionId}"
        string SK "META"
        string userId "ユーザーID"
        string connectionId "WebSocket接続ID"
        string connectedAt "ISO 8601"
        string GSI1PK "USER#{userId}"
        string GSI1SK "WS_CONN#{connectionId}"
        number ttlExpiry "2時間TTL"
    }

    MODEL_META {
        string PK "GLOBAL_MODEL#{modelId}"
        string SK "METADATA"
        string modelId "モデルID"
        string name "モデル名（最大50文字）"
        string description "説明（最大200文字）"
        string s3Prefix "S3パス"
        string modelFile "model3.jsonファイル名"
        string status "active | inactive"
        list expressions "ModelExpression[]"
        list motions "ModelMotion[]"
        list textures "string[]"
        map emotionMapping "emotion→expressionName"
        map motionMapping "motionTag→group,index"
        map characterConfig "CharacterConfig"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
    }

    ACTIVITY {
        string PK "USER#{userId}"
        string SK "ACTIVITY#{YYYY-MM-DD}"
        set activeMinutes "StringSet 分単位タイムスタンプ"
        number ttlExpiry "30日TTL"
    }

    MEMO {
        string PK "USER#{userId}"
        string SK "MEMO#{memoId}"
        string memoId "UUID"
        string title "タイトル（最大50文字）"
        string content "本文（最大500文字）"
        list tags "string[]"
        string source "chat | quick"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
    }

    GLOBAL_MESSAGE {
        string PK "USER#{userId}"
        string SK "MSG#{timestamp_padded}#{messageId}"
        json data "role, content, timestamp, motion等"
    }
```

### 1.6 GSI 設計

```mermaid
erDiagram
    GSI1 {
        string GSI1PK "パーティションキー"
        string GSI1SK "ソートキー"
        string _用途1 "USER_CODE#{code} → USER_CODE : フレンドコード逆引き"
        string _用途2 "USER#{userId} → WS_CONN#{connId} : WS接続検索"
    }

    GSI2 {
        string GSI2PK "パーティションキー"
        string GSI2SK "ソートキー"
        string _用途1 "USER#{userId} → CONV_UPDATED#{ts} : グループ更新順ソート"
    }
```

---

## 2. フロントエンド主要データ構造

### 2.1 コアデータモデル

```mermaid
erDiagram
    Message {
        string id "UUID"
        string role "user | assistant | transcript"
        string content "テキスト"
        number timestamp "Unix epoch ms"
        string motion "モーションタグ（任意）"
        string imageBase64 "画像データ（任意）"
        string rawResponse "LLM生レスポンス（任意）"
        json mapData "MapData（任意）"
        json suggestedTheme "themeName（任意）"
        list suggestedReplies "string[]（任意）"
        list transcriptEntries "TranscriptEntry[]（任意）"
    }

    StructuredResponse {
        string text "応答テキスト"
        string motion "モーションタグ"
        string emotion "EmotionType"
        json mapData "MapData（任意）"
        json suggestedTheme "themeName（任意）"
        string enhancedSystemPrompt "デバッグ用（任意）"
        string sessionSummary "セッション要約（任意）"
        list permanentFacts "string[]（任意）"
        string themeName "トピック名（任意）"
        json workStatus "active, expiresAt, toolCount（任意）"
        list suggestedReplies "string[]（任意）"
        string briefingLogSK "ブリーフィングログキー（任意）"
        json tokenUsage "inputTokens, outputTokens等（任意）"
    }

    AppConfig {
        json model "ModelReference"
        json ui "UIConfig"
        json profile "UserProfile"
    }

    UIConfig {
        string theme "light | dark"
        number fontSize "フォントサイズ"
        number characterSize "キャラクターサイズ"
        boolean ttsEnabled "TTS有効"
        boolean cameraEnabled "カメラ有効"
        boolean geolocationEnabled "GPS有効"
        boolean sentimentEnabled "感情分析有効"
        boolean developerMode "開発者モード"
        boolean characterVisible "キャラクター表示"
        boolean themeCharacterVisible "テーマ内キャラクター表示"
        boolean activityLoggingEnabled "行動ログ有効"
    }

    UserProfile {
        string nickname "ニックネーム"
        string honorific "空 | さん | くん | 様"
        string gender "空 | female | male"
        string aiName "AI名"
    }

    ThemeSession {
        string themeId "UUID"
        string themeName "トピック名"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
        string modelKey "haiku | sonnet | opus（任意）"
        string category "free | life | dev | aiapp（任意）"
        string subcategory "サブカテゴリ（任意）"
        boolean workActive "MCP接続中（任意）"
        string workExpiresAt "MCP有効期限（任意）"
        boolean isPrivate "プライベート（任意）"
    }

    UsageInfo {
        string plan "free | paid | platinum"
        json daily "used, limit, remaining"
        json monthly "used, limit, remaining"
        json premiumMonthly "used, limit, remaining"
        list allowedModels "ModelKey[]"
        json resetAt "daily, monthly"
    }

    Message }o--o| StructuredResponse : "パース結果"
    AppConfig ||--|| UIConfig : "UI設定"
    AppConfig ||--|| UserProfile : "プロフィール"
```

### 2.2 グループ & ソーシャル

```mermaid
erDiagram
    FriendLink {
        string friendUserId "フレンドID"
        string displayName "表示名"
        number linkedAt "リンク日時"
    }

    GroupSummary {
        string groupId "グループID"
        string groupName "グループ名"
        string lastMessage "最新メッセージ"
        number updatedAt "更新日時"
    }

    GroupMessage {
        string id "メッセージID"
        string senderId "送信者ID"
        string senderName "送信者名"
        string content "内容"
        number timestamp "タイムスタンプ"
        string type "text | system"
    }

    GroupMember {
        string userId "ユーザーID"
        string nickname "ニックネーム"
    }

    GroupSummary ||--o{ GroupMessage : "メッセージ一覧"
    GroupSummary ||--o{ GroupMember : "メンバー一覧"
```

### 2.3 MCP & Live2D モデル

```mermaid
erDiagram
    WorkConnection {
        string themeId "テーマID"
        boolean active "接続中"
        string expiresAt "有効期限"
        list tools "MCPToolInfo[]"
        string serverUrl "MCPサーバーURL"
        string greeting "挨拶（任意）"
        string description "説明（任意）"
        list suggestedReplies "string[]（任意）"
        boolean suggestedRepliesPersistent "常時表示（任意）"
        string suggestedRepliesTemplate "テンプレート（任意）"
    }

    MCPToolInfo {
        string name "ツール名"
        string description "説明（任意）"
    }

    ModelMeta {
        string modelId "モデルID"
        string name "モデル名"
        string description "説明"
        string s3Prefix "S3パス"
        string modelFile "model3.jsonファイル名"
        string status "active | inactive"
        list expressions "ModelExpression[]"
        list motions "ModelMotion[]"
        map emotionMapping "emotion→expressionName"
        map motionMapping "motionTag→group,index"
        json characterConfig "CharacterConfig（任意）"
        string createdAt "ISO 8601"
        string updatedAt "ISO 8601"
    }

    CharacterConfig {
        string characterName "キャラクター名"
        string characterAge "年齢"
        string characterGender "male | female | other | 空"
        string characterPersonality "性格"
        string characterSpeechStyle "話し方"
        string characterPrompt "追加プロンプト"
    }

    WorkConnection ||--o{ MCPToolInfo : "複数ツール"
    ModelMeta ||--o| CharacterConfig : "キャラクター設定"
```

---

## 3. シーケンス図

### 3.1 チャットメッセージ送信（ストリーミング）

```mermaid
sequenceDiagram
    actor User
    participant ChatUI
    participant chatController
    participant llmClient
    participant appStore
    participant wsService
    participant Lambda as Lambda /llm/chat
    participant Bedrock
    participant DynamoDB
    participant WebSocket as API Gateway WS

    User->>ChatUI: テキスト入力 & 送信
    ChatUI->>chatController: sendMessage(content, imageBase64?)

    chatController->>appStore: addMessage({role: 'user', content})
    chatController->>appStore: setLoading(true)

    chatController->>llmClient: sendMessage(message, sessionId, imageBase64, themeId, userLocation, modelKey, debug, streaming=true)

    llmClient->>Lambda: POST /llm/chat<br/>{message, sessionId, streaming: true, selectedModelId, ...}

    Note over Lambda: リクエスト解析 & レートリミットチェック

    Lambda->>DynamoDB: Query SETTINGS, PERMANENT_FACTS,<br/>SESSION#, GLOBAL_MODEL# (並列)
    DynamoDB-->>Lambda: ユーザープロフィール, 永久記憶,<br/>セッション要約, モデル設定

    Note over Lambda: buildSystemPrompt()<br/>XMLタグ構造 + Prompt Caching (cachePoint×2)

    Lambda-->>llmClient: 202 {streamed: true, requestId}
    llmClient-->>chatController: StructuredResponse (初期)

    Lambda->>Bedrock: ConverseStreamCommand<br/>(systemPrompt, messages, toolConfig)

    loop ストリーミングループ
        Bedrock-->>Lambda: contentBlockDelta (テキスト差分)
        Lambda->>WebSocket: postToConnection<br/>{type: 'chat_delta', requestId, delta}
        WebSocket-->>wsService: chat_delta イベント
        wsService->>appStore: setStreamingText(accumulated)
        appStore-->>ChatUI: streamingText 更新 → タイプライター表示
    end

    alt Tool Use 発生時
        Bedrock-->>Lambda: toolUse {toolName, input}
        Lambda->>WebSocket: {type: 'chat_tool_start', tool}
        Lambda->>Lambda: executeSkill(toolName, input)
        Note over Lambda: Calendar / Tasks / Places /<br/>Search / Weather / MCP
        Lambda->>WebSocket: {type: 'chat_tool_result', tool}
        Lambda->>Bedrock: toolResult → 再度ストリーミング
    end

    Bedrock-->>Lambda: stopReason: 'end_turn'

    Lambda->>DynamoDB: PutItem MSG#{timestamp}#{role}<br/>(user + assistant メッセージ保存)
    Lambda->>DynamoDB: UpdateItem ACTIVE_SESSION

    alt 5ターンごと
        Lambda->>Lambda: invoke summarize (async Event)
    end

    Lambda->>WebSocket: postToConnection<br/>{type: 'chat_complete', requestId, content,<br/>themeName?, workStatus?, tokenUsage?}

    WebSocket-->>wsService: chat_complete イベント
    wsService->>chatController: onChatComplete(event)

    chatController->>chatController: extractStreamingText(rawContent)
    chatController->>chatController: parseStreamedContent(rawContent, event)
    Note over chatController: text, emotion, motion,<br/>mapData, suggestedReplies 抽出

    chatController->>appStore: addMessage({role: 'assistant', content: text, motion, mapData})
    chatController->>appStore: setCurrentExpression(emotion)
    chatController->>appStore: setCurrentMotion(motion)
    chatController->>appStore: setStreamingText(null)
    chatController->>appStore: setLoading(false)

    appStore-->>ChatUI: メッセージ確定表示
    Note over ChatUI: Live2D表情変更 + モーション再生

    chatController-->>chatController: fire-and-forget: POST /memory/events
```

### 3.2 音声会話（VoiceChat）パイプライン

```mermaid
sequenceDiagram
    actor User
    participant VoiceChat as VoiceChatScreen
    participant STT as useSpeechRecognition
    participant VAD as useVAD
    participant chatController
    participant llmClient
    participant Lambda as Lambda /llm/chat
    participant ttsService
    participant TTS as Lambda /tts/synthesize
    participant Live2D as Live2DCanvas

    User->>VoiceChat: 音声会話開始ボタン
    VoiceChat->>STT: startListening()
    VoiceChat->>VAD: start() (音声活動検出)

    User->>STT: 発話

    loop 音声認識中
        STT-->>VoiceChat: onInterimResult(partialText)
        VoiceChat-->>VoiceChat: 中間テキスト表示
    end

    VAD-->>VoiceChat: onSpeechEnd() (発話終了検出)
    STT-->>VoiceChat: onFinalResult(finalText)

    VoiceChat->>chatController: sendMessage(finalText, null, voiceMode=true, userMood?)

    chatController->>llmClient: sendMessage(text, sessionId, ..., voiceMode=true)
    llmClient->>Lambda: POST /llm/chat {message, streaming: true, voiceMode: true}

    Note over Lambda: voiceMode時: 簡潔な応答を指示

    Lambda-->>VoiceChat: WebSocket chat_delta (テキスト差分)

    Note over VoiceChat: テキスト蓄積 → 文単位で分割

    loop 文が完成するたび
        VoiceChat->>ttsService: synthesize(sentence)
        ttsService->>TTS: POST /tts/synthesize {text, provider}
        TTS-->>ttsService: {audio: base64 MP3}
        ttsService-->>VoiceChat: AudioBuffer
        VoiceChat->>Live2D: リップシンク開始（音量コールバック）
        VoiceChat-->>User: 音声再生
    end

    Lambda-->>VoiceChat: WebSocket chat_complete
    VoiceChat->>chatController: parseStreamedContent()
    VoiceChat->>Live2D: setExpression(emotion)

    Note over VoiceChat: TTS再生完了待ち → STT再開
    VoiceChat->>STT: startListening() (次の発話待ち)
```

### 3.3 3層記憶管理

```mermaid
sequenceDiagram
    participant Chat as Lambda /llm/chat
    participant Summarize as Lambda summarize
    participant EventBridge
    participant Finalizer as Lambda sessionFinalizer
    participant Extract as Lambda extractFacts
    participant DynamoDB
    participant AgentCore as AgentCore Memory

    Note over Chat: 会話中（短期記憶）

    Chat->>DynamoDB: PutItem MSG#{ts}#{role}<br/>(メッセージ保存, TTL=7日)
    Chat->>DynamoDB: UpdateItem ACTIVE_SESSION<br/>(updatedAt 更新)

    alt 5ターンごと
        Chat->>Summarize: Lambda.invoke(async Event)<br/>{userId, sessionId, themeId?}

        Summarize->>DynamoDB: Query MSG# (lastSummarizedAt以降)
        DynamoDB-->>Summarize: 新規メッセージ一覧

        par ローリング要約 & セグメント要約
            Summarize->>Summarize: Bedrock Haiku 4.5<br/>SUMMARY_PROMPT
            Summarize->>Summarize: Bedrock Haiku 4.5<br/>SEGMENT_SUMMARY_PROMPT
        end

        Summarize->>DynamoDB: UpdateItem SESSION#{sessionId}<br/>{summary, lastSummarizedAt, TTL=7日}
        Summarize->>DynamoDB: PutItem SUMMARY_CP#{ts}<br/>{summary, keywords[], TTL=7日}
    end

    Chat->>AgentCore: POST /memory/events<br/>(fire-and-forget, 中期記憶)

    Note over EventBridge: rate(15 minutes)

    EventBridge->>Finalizer: 定期実行

    Finalizer->>DynamoDB: Query PK=ACTIVE_SESSION
    DynamoDB-->>Finalizer: アクティブセッション一覧

    loop 各セッション
        alt 30分以上無操作 & isPrivate=false
            Finalizer->>Extract: Lambda.invoke(async Event)<br/>{userId, sessionId, themeId?}

            Extract->>DynamoDB: Query MSG# (全メッセージ)
            DynamoDB-->>Extract: 会話全文

            Extract->>Extract: Bedrock Haiku 4.5<br/>FACT_EXTRACTION_PROMPT<br/>→ {facts[], preferences[]}

            Extract->>DynamoDB: GetItem PERMANENT_FACTS
            DynamoDB-->>Extract: 既存 facts[], preferences[]

            Note over Extract: マージ & 重複排除

            alt facts > 30件 (統合閾値)
                Extract->>Extract: Bedrock Haiku 4.5<br/>CONSOLIDATION_PROMPT<br/>→ 60-70%に圧縮
            end

            Extract->>DynamoDB: PutItem PERMANENT_FACTS<br/>{facts[最大40], preferences[最大15]}
            Extract->>DynamoDB: DeleteItem ACTIVE_SESSION
        end
    end
```

### 3.4 ブリーフィング（プロアクティブ挨拶）

```mermaid
sequenceDiagram
    participant Hook as useBriefing
    participant chatController
    participant llmClient
    participant Lambda as Lambda /llm/chat
    participant DynamoDB
    participant Skills as LLM Skills
    participant ttsService

    Note over Hook: トリガー: 認証完了3秒後 /<br/>visibilitychange / 30分ポーリング

    Hook->>chatController: requestBriefing(userLocation?)

    chatController->>llmClient: sendMessage('__briefing__', sessionId,<br/>null, null, userLocation)

    llmClient->>Lambda: POST /llm/chat<br/>{message: '__briefing__', streaming: true}

    Note over Lambda: ブリーフィングモード検出

    Lambda->>DynamoDB: Query SETTINGS, PERMANENT_FACTS (並列)

    Lambda->>Skills: list_events (Google Calendar, 今日の予定)
    Lambda->>Skills: list_tasks (Google Tasks, 1週間以内)
    Lambda->>Skills: get_weather (Open-Meteo, 現在地)

    Skills-->>Lambda: 予定一覧 + ToDo一覧 + 天気情報

    Note over Lambda: 専用ブリーフィングプロンプトで応答生成<br/>（通常のメッセージ保存はしない）

    Lambda-->>chatController: WebSocket chat_complete<br/>{content, briefingLogSK}

    chatController->>chatController: parseStreamedContent()
    chatController->>ttsService: synthesizeAndPlay(text)
    ttsService-->>chatController: 音声再生

    Note over chatController: DynamoDB にメッセージ保存しない（揮発的）
```

### 3.5 WebSocket 接続 & ストリーミング

```mermaid
sequenceDiagram
    participant App as App.tsx
    participant wsService
    participant APIGW as API Gateway WS
    participant Authorizer as Lambda ws/authorizer
    participant Connect as Lambda ws/connect
    participant DynamoDB
    participant Chat as Lambda /llm/chat

    App->>wsService: connect(idToken)

    wsService->>APIGW: WebSocket接続<br/>wss://xxx?token={JWT}

    APIGW->>Authorizer: $connect (トークン検証)
    Authorizer->>Authorizer: CognitoJwtVerifier.verify(token)

    alt JWT有効
        Authorizer-->>APIGW: Allow {principalId, context: {userId}}
        APIGW->>Connect: $connect イベント
        Connect->>DynamoDB: PutItem WS_CONN#{connectionId}<br/>{userId, GSI1PK, GSI1SK, TTL=2h}
        Connect-->>APIGW: 200 OK
        APIGW-->>wsService: 接続成功
        wsService->>wsService: status = 'open'
    else JWT無効
        Authorizer-->>APIGW: Deny
        APIGW-->>wsService: 401 接続拒否
        wsService->>wsService: status = 'failed'
    end

    Note over Chat: LLM応答生成中...

    Chat->>DynamoDB: Query GSI1<br/>GSI1PK=USER#{userId}, begins_with(WS_CONN#)
    DynamoDB-->>Chat: connectionId一覧

    loop 各接続に送信
        Chat->>APIGW: PostToConnectionCommand<br/>(connectionId, {type: 'chat_delta', delta})
        APIGW-->>wsService: メッセージ受信
        wsService->>wsService: onChatStream callback 発火
    end
```

### 3.6 テーマ（トピック）作成 & チャット

```mermaid
sequenceDiagram
    actor User
    participant Sidebar
    participant themeStore
    participant themeService
    participant Lambda as Lambda /themes
    participant DynamoDB
    participant ThemeChat
    participant chatController
    participant LLM as Lambda /llm/chat

    User->>Sidebar: 新規トピック作成
    Sidebar->>themeService: createTheme(themeName, category?, modelKey?)

    themeService->>Lambda: POST /themes<br/>{themeName, category, modelKey, isPrivate?}

    Lambda->>DynamoDB: PutItem THEME_SESSION#{themeId}<br/>{themeId, themeName, modelKey, category, createdAt}
    Lambda-->>themeService: {themeId, themeName}

    themeService-->>themeStore: setThemes([...themes, newTheme])
    themeStore-->>Sidebar: UI更新

    User->>Sidebar: トピック選択
    Sidebar->>ThemeChat: navigate(/themes/{themeId})

    ThemeChat->>themeService: listMessages(themeId)
    themeService->>Lambda: GET /themes/{themeId}/messages
    Lambda->>DynamoDB: Query PK=USER#{userId}#THEME#{themeId},<br/>SK begins_with MSG#
    DynamoDB-->>Lambda: メッセージ一覧
    Lambda-->>themeService: {messages[]} (assistant JSON→text抽出済み)
    themeService-->>ThemeChat: Message[]

    User->>ThemeChat: メッセージ入力 & 送信
    ThemeChat->>chatController: sendThemeMessage(content, themeId)

    chatController->>LLM: POST /llm/chat<br/>{message, sessionId, themeId, streaming: true}

    Note over LLM: themeId付き →<br/>テーマコンテキスト注入<br/>category_context / subcategory_context

    LLM-->>chatController: WebSocket chat_complete<br/>{content, themeName?}

    alt 新規トピックで themeName 生成
        chatController->>themeStore: updateThemeName(themeId, themeName)
        themeStore-->>Sidebar: トピック名リアルタイム反映
    end
```

### 3.7 フレンドリンク & グループチャット

```mermaid
sequenceDiagram
    actor UserA
    actor UserB
    participant FriendUI as FriendList (UserA)
    participant friendService
    participant Lambda as Lambda /friends
    participant DynamoDB
    participant GroupUI as GroupChat
    participant groupService
    participant GroupLambda as Lambda /groups
    participant ConvLambda as Lambda /conversations
    participant WebSocket as API Gateway WS

    Note over UserA: フレンドコード取得
    UserA->>FriendUI: コード表示ボタン
    FriendUI->>friendService: generateCode()
    friendService->>Lambda: POST /friends/code
    Lambda->>DynamoDB: PutItem USER_CODE<br/>{code, GSI1PK: USER_CODE#{code}}
    Lambda-->>friendService: {code: "ABC12345"}
    friendService-->>FriendUI: QRコード表示

    Note over UserB: フレンドリンク
    UserB->>friendService: linkByCode("ABC12345", "UserBの表示名")
    friendService->>Lambda: POST /friends/link<br/>{code: "ABC12345", displayName}
    Lambda->>DynamoDB: Query GSI1 USER_CODE#{code}<br/>→ UserAのuserId取得
    Lambda->>DynamoDB: PutItem FRIEND#{UserB} (UserA側)
    Lambda->>DynamoDB: PutItem FRIEND#{UserA} (UserB側)
    Lambda-->>friendService: {friendUserId: UserA}

    Note over UserA: グループ作成
    UserA->>GroupUI: グループ作成
    GroupUI->>groupService: createGroup("グループ名")
    groupService->>GroupLambda: POST /groups<br/>{groupName}
    GroupLambda->>DynamoDB: PutItem CONV#{groupId} META
    GroupLambda->>DynamoDB: PutItem CONV_MEMBER#{groupId} (UserA)
    GroupLambda-->>groupService: {groupId, groupName}

    Note over UserA: メンバー追加
    UserA->>GroupUI: UserBを追加
    GroupUI->>groupService: addMember(groupId, UserB.userId)
    groupService->>GroupLambda: POST /groups/{groupId}/members
    GroupLambda->>DynamoDB: PutItem CONV_MEMBER#{groupId} (UserB)
    GroupLambda->>DynamoDB: UpdateItem CONV#{groupId} META<br/>(participants に追加)

    Note over UserA: メッセージ送信
    UserA->>GroupUI: メッセージ入力 & 送信
    GroupUI->>groupService: sendMessage(groupId, content, senderName)
    groupService->>ConvLambda: POST /groups/{groupId}/messages<br/>{content, senderName}
    ConvLambda->>DynamoDB: PutItem CMSG#{ts}#{msgId}

    ConvLambda->>DynamoDB: Query GSI1<br/>グループメンバー全員のWS接続取得
    loop 各メンバーの接続
        ConvLambda->>WebSocket: PostToConnection<br/>{type: 'group_message', groupId, message}
    end

    WebSocket-->>UserB: リアルタイム受信
```

### 3.8 Live2D モデルアップロード（管理画面）

```mermaid
sequenceDiagram
    actor Admin
    participant ModelMgmt as ModelManagement
    participant adminApi
    participant Lambda as Lambda /admin/models
    participant S3
    participant DynamoDB
    participant CloudFront

    Admin->>ModelMgmt: ZIPファイル選択

    ModelMgmt->>ModelMgmt: jszip.loadAsync(file)<br/>→ .model3.json 自動検出<br/>→ ファイル一覧抽出

    ModelMgmt->>adminApi: prepareUpload(name, description, files[])
    adminApi->>Lambda: POST /admin/models<br/>{name, description, files: string[]}

    Lambda->>DynamoDB: PutItem GLOBAL_MODEL#{modelId} METADATA<br/>{status: 'active', s3Prefix, ...}
    Lambda->>S3: createPresignedUrl() × N ファイル
    Lambda-->>adminApi: {modelId, uploadUrls: {filename: presignedUrl}}
    adminApi-->>ModelMgmt: uploadUrls

    loop 各ファイル
        ModelMgmt->>S3: PUT (Presigned URL)<br/>ファイルアップロード
    end

    ModelMgmt->>adminApi: finalizeUpload(modelId)
    adminApi->>Lambda: POST /admin/models/{modelId}/finalize

    Lambda->>S3: HeadObject (全ファイル存在確認)
    Lambda->>Lambda: model3.json解析<br/>→ expressions[], motions[] 抽出
    Lambda->>DynamoDB: UpdateItem GLOBAL_MODEL#{modelId}<br/>{expressions, motions, textures, modelFile}
    Lambda-->>adminApi: ModelMeta

    Note over CloudFront: d10pmg1gpcr0qb.cloudfront.net<br/>経由でモデルファイル配信

    Note over Admin: マッピング編集画面へ遷移

    Admin->>ModelMgmt: 感情/モーション マッピング編集
    ModelMgmt->>adminApi: updateModel(modelId,<br/>{emotionMapping, motionMapping, characterConfig})
    adminApi->>Lambda: PATCH /admin/models/{modelId}
    Lambda->>DynamoDB: UpdateItem GLOBAL_MODEL#{modelId}<br/>{emotionMapping, motionMapping, characterConfig}
```

### 3.9 レートリミットチェック

```mermaid
sequenceDiagram
    participant Lambda as Lambda /llm/chat
    participant RateLimiter as rateLimiter.ts
    participant DynamoDB

    Lambda->>RateLimiter: checkRateLimit(userId, modelKey)

    RateLimiter->>DynamoDB: GetItem PLAN
    DynamoDB-->>RateLimiter: {plan: 'free'|'paid'|'platinum'}

    par 利用量取得（並列）
        RateLimiter->>DynamoDB: GetItem USAGE_DAILY#{today}
        RateLimiter->>DynamoDB: GetItem USAGE_MONTHLY#{month}
        RateLimiter->>DynamoDB: GetItem USAGE_PREMIUM_MONTHLY#{month}
    end

    DynamoDB-->>RateLimiter: daily.count, monthly.count, premium.count

    alt Free プラン
        Note over RateLimiter: daily ≤ 15, monthly ≤ 300<br/>allowedModels: [haiku]
    else Paid プラン
        Note over RateLimiter: daily ≤ 40, monthly ≤ 1000<br/>premium ≤ 60<br/>allowedModels: [haiku, sonnet, opus]
    else Platinum プラン
        Note over RateLimiter: 無制限<br/>allowedModels: [haiku, sonnet, opus]
    end

    alt 制限超過
        RateLimiter-->>Lambda: {allowed: false, message: '制限超過メッセージ'}
        Lambda-->>Lambda: 429 レスポンス返却
    else 制限内
        RateLimiter-->>Lambda: {allowed: true, usage: UsageInfo}
        Lambda->>DynamoDB: UpdateItem USAGE_DAILY +1 (TTL=2日)
        Lambda->>DynamoDB: UpdateItem USAGE_MONTHLY +1 (TTL=35日)
        alt Premium モデル使用時
            Lambda->>DynamoDB: UpdateItem USAGE_PREMIUM_MONTHLY +1
        end
    end
```

### 3.10 MCP（Model Context Protocol）接続

```mermaid
sequenceDiagram
    actor User
    participant WorkModal as WorkConnectModal
    participant QR as useQRScanner
    participant workService
    participant Lambda as Lambda /mcp
    participant MCPServer as 外部MCPサーバー
    participant DynamoDB
    participant ThemeChat
    participant LLM as Lambda /llm/chat

    User->>WorkModal: QRスキャン開始
    WorkModal->>QR: startScanning()
    QR-->>WorkModal: onScan(qrData)

    Note over WorkModal: QRデータ解析<br/>{type: 'mcp', serverUrl, code?, ttlMinutes?}

    WorkModal->>workService: connect(qrPayload)
    workService->>Lambda: POST /mcp/connect<br/>{serverUrl, code?, themeId, ttlMinutes?}

    Lambda->>MCPServer: POST (JSON-RPC 2.0)<br/>initialize → tools/list
    MCPServer-->>Lambda: {tools: MCPToolInfo[]}

    Lambda->>DynamoDB: PutItem THEME_SESSION#{themeId}<br/>{workActive: true, workExpiresAt, workTools}
    Lambda-->>workService: WorkConnection<br/>{themeId, active, tools[], expiresAt}

    workService-->>WorkModal: 接続成功
    WorkModal-->>ThemeChat: navigate(/themes/{themeId})

    User->>ThemeChat: MCP ツールを使ったメッセージ送信

    ThemeChat->>LLM: POST /llm/chat<br/>{message, themeId, streaming: true}

    Note over LLM: work_context にMCPツール一覧注入<br/>→ mcp_* プレフィックスツールとして登録

    LLM->>LLM: Bedrock toolUse: mcp_toolName
    LLM->>MCPServer: callMCPTool(toolName, input)<br/>(JSON-RPC 2.0)
    MCPServer-->>LLM: ツール実行結果

    LLM-->>ThemeChat: WebSocket chat_complete<br/>{content, workStatus}
```

---

## 4. 補足: API リクエスト/レスポンス形式

### 共通ヘッダー

```
Authorization: Bearer {Cognito ID Token}
Content-Type: application/json
```

### 共通エラーレスポンス

```json
{ "error": "エラーメッセージ" }
```

### ステータスコード

| コード | 意味 |
|--------|------|
| 200 | 成功 |
| 202 | 受理（非同期/ストリーミング） |
| 400 | リクエスト不正 |
| 401 | 認証エラー |
| 404 | リソース未発見 |
| 409 | 競合（既にフレンド等） |
| 429 | レートリミット超過 |
| 500 | サーバーエラー |

### WebSocket メッセージ型

| type | 方向 | ペイロード |
|------|------|-----------|
| `chat_delta` | Server→Client | `{requestId, delta: string}` |
| `chat_tool_start` | Server→Client | `{requestId, tool: string}` |
| `chat_tool_result` | Server→Client | `{requestId, tool: string}` |
| `chat_complete` | Server→Client | `{requestId, content, themeName?, workStatus?, tokenUsage?}` |
| `chat_error` | Server→Client | `{requestId, error: string}` |
| `group_message` | Server→Client | `{groupId, message: GroupMessage}` |
