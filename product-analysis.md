# Ai-Ba（アイバ）プロダクト分析

**分析日**: 2026-03-12
**対象**: Ai-Ba v1.0 MVP 定義・商用化フェーズ
**バージョン**: 1.0

---

## エグゼクティブサマリー

### 現状評価
**技術成熟度**: ★★★★☆（4.5/5）
- コア機能（AIチャット、3層記憶、スキル）の実装は堅牢
- WebSocket ストリーミング、Prompt Caching で性能最適化済み
- テスト coverage 高い（793 テスト / 52 ファイル）

**商用準備度**: ★★☆☆☆（2/5）
- 機能完成度は高いが、**課金・法務・分析機能がなく商用リリース不可**
- スコープ拡散（音声会話、Chrome 拡張等）で優先順位不明確

### 推奨アクション
1. **MVP 機能セットの確定** → コア 5機能に集中
2. **スコープ削減** → v1.0 後に延期する機能を明確化
3. **商用化必須項目の追加** → Stripe、法務、GA4、オンボーディング
4. **実装スケジュール** → 6ヶ月ロードマップの策定

---

## 1. MVP 機能の定義

### 1-1. Core MVP（リリース必須）

#### ✅ 実装済み・リリース対象

| # | 機能 | 実装状況 | 安定度 | 補足 |
|----|------|--------|--------|------|
| 1 | AIチャット + Live2D | 完 | ★★★★★ | WebSocket ストリーミング、感情表現、モーション対応 |
| 2 | 3層記憶モデル | 完 | ★★★★★ | 永久記憶（FACTS/PREFERENCES）、中期記憶（AgentCore）、短期記憶（セッション） |
| 3 | Google Calendar | 完 | ★★★★☆ | list_events / create_event 実装済み |
| 4 | Google Tasks | 完 | ★★★★☆ | list_tasks / create_task / complete_task（2026-03-11 実装完了） |
| 5 | Web検索 | 完 | ★★★★☆ | Brave Search API 統合 |
| 6 | 天気予報 | 完 | ★★★★★ | Open-Meteo API（キー不要）、アイコン表示済み |
| 7 | トピック管理 | 完 | ★★★★☆ | 自動命名、メッセージ履歴、手動リネーム |
| 8 | 認証 | 完 | ★★★★★ | Cognito SRP、管理画面 TOTP MFA |
| 9 | Bedrock Guardrails | 完 | ★★★★☆ | 有害コンテンツ（6カテゴリ）のフィルタリング |
| 10 | Web / iOS | 完 | ★★★★☆ | Tauri（デスクトップ）、Capacitor（iOS）対応 |

#### ⚠️ リリース前に確認・修正が必要

| # | 項目 | 状況 | 対応 |
|----|------|------|------|
| 1 | 画像送信 | 実装済みだが、ファイルサイズ圧縮なし | base64 前に 240x180 リサイズ確認 |
| 2 | エラー画面 | 汎用的すぎる（「うまくいかなかった…」）| エラー種別ごとのメッセージ追加 |
| 3 | モバイル UI | Android/iOS で Full-screen VoiceChat が正常か | 実機テスト（iPhone/Android）実施 |
| 4 | キャラクター表示 | modelSelector は実装済みだが、ユーザーが選んだ後の同期がスムーズか | appStore.activeModelMeta の永続化確認 |

---

### 1-2. Phase 2 機能（v1.5 以後）

| # | 機能 | 工数 | KPI | 優先度 |
|----|------|------|-----|--------|
| 1 | マルチモデル + キャラクター設定反映 | 中 | ユーザー粘着度（キャラ変更率） | ★★★★ |
| 2 | メモ管理（現在は skeleton 実装） | 小 | 機能利用度 | ★★★★ |
| 3 | グループチャット（フレンド機能） | 大 | グループ形成率 | ★★★ |
| 4 | Places API 統合 | 小 | 場所検索利用度 | ★★★ |
| 5 | 感情分析の高度化（user_mood） | 中 | エンゲージメント改善 | ★★★ |
| 6 | デバイス通知（Web Push） | 中 | リテンション向上 | ★★★ |

---

### 1-3. 外すべき機能（v1.0 から削除）

#### ❌ マイAi-Ba(α) 音声会話

**現状**: 実装完了（STT→LLM→TTS パイプライン、リップシンク対応）

**削除理由**:
1. **品質が未熟** — リップシンク実装済みだが、実運用でユーザーが違和感を感じやすい
2. **エンドツーエンド レイテンシが高い** — 音声入力 → LLM → 音声合成で平均 5-10秒（テキストチャットは 1-3秒）
3. **オーディオハードウェア依存性** — マイク/スピーカーの品質による体験のばらつきが大きい
4. **コア体験でない** — テキストチャットで十分なユーザーが初期段階では大多数
5. **デバッグが複雑** — 3層パイプラインの各段階で問題が生じやすい

**延期タイミング**:
- 初期 500ユーザーから DAU > 100 の段階
- ユーザーテスト結果「音声会話が欲しい」が 30% 以上の時点

---

#### ❌ Chrome 拡張（Meeting Noter + 仮想カメラ）

**現状**:
- Meeting Noter（文字起こし + AI 議事録 + トピック保存）— 実装中
- 仮想カメラ（フェイストラッキング → Live2D → カメラ配信）— PoC 段階

**削除理由**:
1. **スコープ拡散** — コア Ai-Ba アプリとは異なる UX/市場（会議ユースケース特化）
2. **メンテナンスコスト高い** — Chrome 拡張API の仕様変更（Manifest V3）対応が頻繁
3. **初期ユーザーニーズが低い** — B2C ローンチ段階では会議記録ツール需要は限定的
4. **Ai-Ba 拡張に専念** — 同じ Cognito 認証を共有する点は利点だが、機能複雑化が課題
5. **仮想カメラは 3段階実装計画が必要**:
   - Phase 1（2-3日）: ブラウザ完結（Canvas.captureStream）
   - Phase 2（3-5日）: Chrome 拡張（getUserMedia 差し替え）
   - Phase 3（1-2週間）: Tauri + OS ドライバ（全アプリ対応）

**延期タイミング**:
- v2.0（6ヶ月以後）のコンテンツ機能追加後
- B2B（企業向け）チャネル確立後

---

#### ❌ グループチャット（フレンド機能）

**現状**: 実装済み（WebSocket によるリアルタイムメッセージング）

**削除理由**:
1. **コア機能でない** — MVP では「個人 AI 相棒」としての単一ユーザー体験に集中
2. **リアルタイム通信の保守負荷** — WebSocket 接続管理、同期ロジック複雑
3. **初期モデレーション負荷** — グループチャットは有害コンテンツリスク が高い
4. **LLM 参加方式が曖昧** — AI がグループチャットに参加するのか、補助するのか設計不完全

**延期タイミング**:
- v1.5（4-5ヶ月）のコミュニティ機能検討時

---

#### ❌ MCP 統合（外部ツール連携）

**現状**: Lambda 関数 実装済み（connect / disconnect / status / registry）

**削除理由**:
1. **ニッチユースケース** — 初期ユーザーは Google Calendar/Tasks/Web 検索で十分
2. **セットアップが複雑** — MCP サーバー起動・認証・登録のセットアップをユーザーが行うハードル高い
3. **デバッグ難しい** — LLM が MCP ツールを正しく呼び出すかの検証が難しい

**延期タイミング**:
- 10K ユーザー以後、enterprise ニーズが明確になった段階

---

## 2. Impact/Effort マトリクス

### 優先度付けの基準
- **Impact**: ユーザー獲得（TAM）、リテンション、revenue への影響度（1-5）
- **Effort**: 開発工数（小: 1-3日、中: 1-2週間、大: 1ヶ月以上）
- **優先度**: Impact × (1 / Effort) で算出

### 施策マトリクス

```
HIGH IMPACT / LOW EFFORT（ここから着手）
┌─────────────────────────────────────────────────────────────┐
│ 1. Stripe サブスクリプション統合                               │
│    Impact: 5（収益化）/ Effort: 中（2週間）                  │
│    → Webhook / Customer Portal / DynamoDB 連携                │
│                                                               │
│ 2. メッセージレート制限（フリーティア）                         │
│    Impact: 5（コンバージョン）/ Effort: 小（3-5日）           │
│    → DynamoDB USAGE テーブル / RateLimit 実装                │
│                                                               │
│ 3. 利用規約 + プライバシーポリシー                              │
│    Impact: 5（法的リスク軽減）/ Effort: 小（2-3日）           │
│    → 法務 review + MD ドキュメント作成                       │
│                                                               │
│ 4. Google Analytics 4 統合                                     │
│    Impact: 4（KPI 監視）/ Effort: 小（2-3日）                │
│    → イベント: チャット / スキル利用 / エラー / 購読         │
│                                                               │
│ 5. エラー画面改善                                              │
│    Impact: 4（UX 改善）/ Effort: 小（3-5日）                 │
│    → エラー種別ごとメッセージ + リトライボタン               │
│                                                               │
│ 6. CloudWatch ダッシュボード（管理画面）                       │
│    Impact: 4（監視）/ Effort: 小（2-3日）                    │
│    → API レスポンスタイム / エラー率 / コスト                │
└─────────────────────────────────────────────────────────────┘

MEDIUM IMPACT / MEDIUM EFFORT
┌─────────────────────────────────────────────────────────────┐
│ 1. オンボーディング チュートリアル                             │
│    Impact: 4（Day 1 retention）/ Effort: 中（1-2週間）       │
│    → ウェルカムスクリーン / インタラクティブツアー           │
│                                                               │
│ 2. TTS 品質改善（Aivis Cloud リップシンク）                   │
│    Impact: 3（利用体験）/ Effort: 中（1-2週間）              │
│    → 既に実装済み。ストリーミング最適化 / バグ修正           │
│                                                               │
│ 3. Sentry / CloudWatch ログ統合（エラー監視）                 │
│    Impact: 3（問題解決速度）/ Effort: 中（1-2週間）          │
│    → フロント / Lambda ログ集約 / アラート設定               │
│                                                               │
│ 4. キャラクター選択 UI（モデルプレビュー）                    │
│    Impact: 3（ユーザー粘着度）/ Effort: 中（1週間）          │
│    → 3D ロータビュー / キャラ説明表示                        │
└─────────────────────────────────────────────────────────────┘

LOW IMPACT / HIGH EFFORT（後回し）
┌─────────────────────────────────────────────────────────────┐
│ 1. マイAi-Ba(α) 音声会話 完成度向上                           │
│    Impact: 2（差別化）/ Effort: 大（2-3週間）                │
│    → リップシンク最適化 / レイテンシ削減 / 品質テスト        │
│                                                               │
│ 2. Chrome 拡張 Meeting Noter                                  │
│    Impact: 2（ニッチ）/ Effort: 大（3-4週間）                │
│    → Manifest V3 対応 / RTC キャプション統一 / 記者録作成    │
│                                                               │
│ 3. グループチャット 完成度向上                                 │
│    Impact: 2（社会性）/ Effort: 大（3-4週間）                │
│    → WebSocket 同期 / AI 参加ロジック / モデレーション       │
│                                                               │
│ 4. 仮想カメラ Phase 2/3                                        │
│    Impact: 1（ニッチ）/ Effort: 大（1-2週間以上）            │
│    → Chrome 拡張 / Tauri + OS ドライバ対応                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 追加すべき機能（商用化に必須）

### 3-1. 課金・収益化フレームワーク

#### 目標
- MVP リリース 3ヶ月で 500ユーザー、そのうち 30% が Pro 契約

#### 料金体系

```yaml
Tier Free:
  Price: ¥0
  Message Limit:
    Daily: 10
    Monthly: 200
  Features:
    - AIチャット（Haiku）
    - Calendar/Tasks 連携
    - 3層記憶
    - Web 検索・天気
    - トピック管理（最大 10個）
  Support: コミュニティフォーラム

Tier Pro:
  Price: ¥9.99/月（App Store / Google Play）
  Message Limit: 無制限
  Features:
    - AIチャット（Haiku / Sonnet / Opus 選択可）
    - Calendar/Tasks/Places 連携
    - 3層記憶 + AgentCore 無制限
    - Web 検索・天気
    - トピック管理（無制限）
    - ブリーフィング（無制限）
    - ストレージ 100MB → 500MB
  Support: Email priority（24h response）

Tier Enterprise:
  Price: ¥99.99/月（カスタム可）
  Features:
    - 全 Pro 機能
    - API key access（REST / WebSocket）
    - カスタムモデル対応
    - SSO / AD 連携
    - Custom SLA
  Target: 法人・教育機関
```

#### 実装フロー

```
1. DynamoDB テーブル設計
   ┌─ PK: USER#{userId}
   ├─ SK: SUBSCRIPTION
   └─ Attributes: tier, status, nextBillingDate, cancelledAt, ...

2. Lambda 関数追加
   ┌─ POST /billing/webhook（Stripe webhook）
   ├─ GET /billing/subscription（サブスク状態確認）
   ├─ POST /billing/checkout（チェックアウト開始）
   └─ DELETE /billing/subscription（キャンセル）

3. フロントエンド
   ┌─ SettingsScreen に課金セクション追加
   ├─ メッセージレート制限チェック（llmClient）
   └─ アップグレード CTA（バナー + モーダル）

4. メッセージレート制限
   DynamoDB USAGE#{userId}#{YYYYMM} でカウント
   → llmClient.sendMessage() で超過チェック
   → フリーティア超過時は RateLimit エラーを返す

5. Stripe 統合フロー
   ┌─ フロント: Settings → "Pro にアップグレード" ボタン
   ├─ → Lambda POST /billing/checkout
   ├─ → Stripe Checkout Session 返却
   ├─ → Stripe Hosted Checkout ページ（App Store / Google Play 決済との併行）
   ├─ Webhook（成功）→ Lambda POST /billing/webhook
   ├─ → DynamoDB SUBSCRIPTION 更新
   └─ → AppStore/Play Store と同期（App-level purchase 優先）
```

#### 推定収益（月 10K DAU 時点）

```
Conversion Rate: 30% → 3K Pro ユーザー
ARPU: ¥9.99/月
MRR: ¥29,970

Operating Cost:
  - Bedrock: $30-50 × 30% conversion = $18
  - Lambda/DB: $20-30 × 30% conversion = $12
  - Infrastructure: $5
  Total: $35/month (¥3,850)

Gross Margin: (¥29,970 - ¥3,850) / ¥29,970 = 87%
（注: Stripe 手数料 3.6% + 決済システム複雑化により実際は 70-75%）
```

---

### 3-2. 法務・コンプライアンス

#### 利用規約（Terms of Service）

```markdown
# 利用規約

## 1. AI 出力の責任免除
- Ai-Ba が生成した情報は参考情報であり、医学的判断・法的助言ではありません
- 重要な判断は専門家に相談してください

## 2. ユーザーデータの利用
- ユーザーの会話内容は LLM 学習に使用しません（Bedrock により自動削除）
-永久記憶・中期記憶はユーザーのみがアクセス可能

## 3. 禁止事項
- 違法・有害コンテンツの入力
- AI の出力を信頼できない情報源として第三者に紹介
- API 不正使用（スクレイピング等）

## 4. 免責事項
- サービス中断の責任（定期メンテナンス含む）
- データ損失・損害賠償について Ai-Ba は責任を持たない（Back up 責任はユーザー）

## 5. サービス料金
- Free: 無料（広告なし）
- Pro: ¥9.99/月（自動更新）
- キャンセルは いつでも可能（次月から適用）
```

#### プライバシーポリシー

```markdown
# プライバシーポリシー

## 1. 個人情報の定義
- ID、メールアドレス、プロフィール名
- Google Calendar/Tasks から取得した情報（同意ベース）

## 2. 処理の目的
- サービス提供（AI チャット、スキル実行）
- 永久記憶・中期記憶の保存・検索
- ユーザー分析（Google Analytics）

## 3. 保持期間
- セッションデータ: 7日 TTL（自動削除）
- 永久記憶: 無期限（ユーザーが削除可能）
- 中期記憶: 30日（AgentCore ポリシー）

## 4. サードパーティ連携
- Google OAuth（Calendar/Tasks/Places）: OAuth Token は暗号化・SSM に保管
- Bedrock: AWS プライバシーポリシーに従う
- CloudFront/S3: ログ最小保持

## 5. GDPR / 日本個人情報保護法対応
- 個人情報へのアクセス権（GETデータエクスポート API）
- 削除権（DELETE /users/{userId}）
- 異議申し立て（管理画面から GDPR request）
```

#### Cookie・同意管理

```
実装:
1. Cookie banner（初回訪問時）
   - "必須"（認証 / セッション）: デフォルト ON
   - "分析"（GA4）: デフォルト OFF（ユーザー同意必要）

2. localStorage の明示
   - appStore（Zustand persist）の説明
   - デバイス同期用として必要な旨を明示

3. Consent Management（OneTrust / CookieBot）
   - CMP 導入は初期段階では不要（簡易 Cookie banner で十分）
```

---

### 3-3. ユーザー分析・監視

#### Google Analytics 4 設定

```yaml
Events:
  chat_send:
    - message_length: (5, 50, 200)
    - has_image: boolean
    - model_key: (haiku, sonnet, opus)
    - session_id: string

  skill_used:
    - skill_name: (calendar, tasks, search, weather, places, memo)
    - success: boolean

  theme_created:
    - auto_named: boolean

  model_changed:
    - from_model: string
    - to_model: string

  subscription_converted:
    - from_tier: (free, trial)
    - to_tier: pro

  error_occurred:
    - error_type: (network, parse, rate_limit, api_error)
    - error_message: string

  briefing_triggered:
    - trigger_type: (startup, visibility_change, polling)

Segments:
  - Active Users: chat >= 1 in last 7 days
  - Paying Users: subscription.tier == 'pro'
  - High Engagement: chat >= 10 in last 7 days
  - Churned: last_activity < 30 days ago

Dashboards:
  1. User Acquisition
     - New users / day
     - Sign-up to first chat (funnel)
     - Conversion to paid

  2. Engagement
     - DAU / MAU
     - Avg chats / user / day
     - Most used skills

  3. Retention
     - Day 1 / 7 / 30 retention
     - Churn rate
     - Cohort analysis

  4. Monetization
     - MRR trend
     - ARPU
     - Churn MRR
```

#### CloudWatch ダッシュボード（管理画面）

```
Sections:
1. API Health
   - Bedrock API: Response time / Error rate / Token usage
   - Lambda: Duration / Cold starts / Errors
   - DynamoDB: Consumed capacity / Throttling
   - WebSocket: Connections / Errors

2. Cost Analysis
   - Bedrock cost / day (forecast)
   - Lambda cost / day
   - DynamoDB cost / day

3. User Metrics
   - DAU / hour heatmap
   - Skill usage distribution
   - Model selection distribution

4. Alerts
   - API error rate > 5%
   - Response time > 5s
   - Daily cost spike
```

#### エラーモニタリング（Sentry）

```
Setup:
1. Sentry project 作成（frontend / lambda）
2. フロントエンド: @sentry/react 導入
3. Lambda: @sentry/serverless 導入

Captured Events:
- JSONパース失敗（responseParser）
- WebSocket 接続断
- Bedrock API エラー（429, 500等）
- ImageBlock 不正
- DynamoDB Query 失敗

Alert Rules:
- New issue created: Slack notification
- Event rate spike: escalate to on-call
```

---

### 3-4. UX 改善（オンボーディング・リテンション）

#### オンボーディングフロー

```
新規ユーザー（認証後）
  ↓
[Step 1: ウェルカムスクリーン（2秒）]
  "こんにちは！私は Ai-Ba、君の AI 相棒です"
  [ボタ: "さあ始めよう" / "後で"]
  ↓
[Step 2: 初チャット（ガイド付き）]
  "試しに『今日の予定を教えて』と言ってみてください"
  [提案: カレンダー接続バナー]
  ↓
[Step 3: スキル紹介（オプション）]
  "こんなこともできます："
  - Google Calendar（予定確認）
  - Google Tasks（ToDo管理）
  - Web 検索（情報検索）
  [スキップ可能]
  ↓
[Step 4: トピック作成サジェスト]
  "会話を整理するため、トピックを作成しますか？"
  [ボタ: "作成" / "スキップ"]
  ↓
Main Chat UI（analytics.track('onboarding_complete')）

メトリクス:
  - Funnel: Step 1 → 2 → 3 → 4 の各ステップ完了率
  - Time to first chat: オンボーディング開始から初チャットまで
  - Conversion: オンボーディング完了 → 3日継続利用
```

#### プッシュ通知（Web Push）

```
Triggers:
1. ブリーフィング提案（起動後 3秒）
   - 「おはよう！今日の予定を確認しますか？」
   - [開く] → app に移動 + briefing 送信

2. メッセージ未読（12時間以上）
   - 「最近メッセージが少なくなった。元気ですか？」
   - [返信] → チャット focus

3. Pro 乗り換え促進（Free ユーザー、月50メッセージ超）
   - 「Pro なら無制限にチャットできます」
   - [詳細] → Pro ページ

Implementation:
  - ServiceWorker + Web Push API
  - Firebase Cloud Messaging（FCM）不要（Web Push API で十分）
  - 通知頻度制御：1日最大 3回まで
```

#### リテンション ハック

```
Short-term（Day 1-7）:
  - ブリーフィング at 起動時（自動）
  - オンボーディング → スキル利用 → ハビット形成

Mid-term（Day 7-30）:
  - ストリークシステム：「連続7日使用」でバッジ🔥
  - リマインダー通知：3日未使用 → 「最近見かけませんね」

Long-term（Day 30+）:
  - 永久記憶の活用：「最近、〇〇について話してなかったけど」
  - モデル提案：「新しいキャラが追加されました」
  - ユーザー分析基づく提案：「Web検索をよく使うようなので…」
```

---

## 4. 技術的課題と対応

### 4-1. スケーラビリティ

#### 現状
- Lambda 35関数 × DynamoDB（GSI×2）で月 10K DAU に対応予定
- Prompt Caching により Bedrock API コスト 20-30% 削減

#### 対応策

```
1. Database
   - DynamoDB: オンデマンド課金に変更（スケーラビリティ自動）
   - GSI: 既に 2個設定済み（USER#THEME#、USER#ACTIVE_SESSION）
   - TTL: セッション 7日、中期記憶 30日で自動削除

2. Lambda Concurrency
   - 現在: アカウント制限 1000（AWS default）
   - モニタリング: CloudWatch で concurrent execution 監視
   - リスク: 1000 concurrent 超過時は throttling

3. WebSocket
   - API Gateway WebSocket: 1M 接続上限（理論値）
   - 実運用: 接続管理ロジック確認（broadcast に多数は不向き）
   - 代替: RabbitMQ（複雑度↑）or SNS topic（コスト↑）は初期不要

4. キャッシュ戦略
   - Prompt Caching: cachePoint 2箇所（効果測定）← CloudWatch log で cache hit rate 計測
   - Redis: 初期段階では不要（DynamoDB TTL で十分）
```

#### コスト試算（月 10K DAU）

```
Scenario: Pro 30% conversion = 3K active users, 5 chats/day

Bedrock (Haiku, Prompt Caching)
  - Input tokens: 3K users × 5 chats × 500 tokens × 30 days = 225M tokens
  - Output tokens: 3K users × 5 chats × 300 tokens × 30 days = 135M tokens
  - Cache write: 225M × 25% (new cache) × 1.25x cost = $2.81
  - Cache read: 225M × 75% (cached) × 0.1x cost = $0.17
  - Regular input: 135M × $0.003 / 1M = $0.41
  - Regular output: 135M × $0.015 / 1M = $2.03
  Total: ~$5.4/day = $162/month

Lambda (90s timeout, 512MB, ARM64)
  - Request duration: 3K users × 5 chats = 15K requests/day
  - Avg duration: 2s (Chat: 1.5s + Skill: 0.5s average)
  - Compute: 15K × 2s × 512MB / 3200MB-sec = 4,687 seconds/day
  - GB-seconds: 4,687 × 0.512 / 1024 = 2.34 GB-second
  - Cost: 2.34 × $0.0000166667 × 30 = $0.012 = <$1/month

DynamoDB (On-demand)
  - Write units: 15K requests × 2 writes (MSG + session) = 30K
  - Read units: 15K requests × 5 reads (memory + settings + context) = 75K
  - Pricing: (30K + 75K) × $1.25 / 1M = $0.13/day = ~$4/month

CloudFront (Model CDN)
  - Model files: ~50MB per user (Live2D) × transfer once
  - Request/month: 10K users × 1 download = 10K
  - Data transfer: 10K × 50MB = 500GB/month
  - Cost: 500 × $0.085 = $42.5/month

**Total Monthly: $208.5** (Bedrock $162 + Lambda $1 + DynamoDB $4 + CloudFront $42.5)
**Per user cost: $0.021** ($208.5 / 10K DAU)
**Free tier: ¥0 × 0.7 = ¥0**
**Pro tier: ¥9.99 × 0.3 = ¥2.997**
**Total revenue: ¥2,997 / 10K users = ¥0.3/user/month**

（注: 数値は 2026-03 時点の Bedrock pricing に基づく）
```

---

### 4-2. セキュリティ強化

#### 実装済み
- ✅ システムプロンプト非露出（バックエンド生成）
- ✅ Bedrock Guardrails（6カテゴリ）
- ✅ DynamoDB PITR
- ✅ Cognito SRP

#### 追加施策

```
1. HTTPS + HSTS
   Status: CloudFront + S3 で実装済みと想定
   Action: Terraform で HSTS max-age=31536000 確認

2. Content Security Policy（CSP）
   Implementation:
     default-src 'self';
     script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; (PixiJS)
     style-src 'self' 'unsafe-inline'; (Tailwind)
     font-src 'self' fonts.googleapis.com;
     connect-src 'self' *.bedrock-runtime.*.amazonaws.com;
   Action: CloudFront custom header 追加

3. 入力サニタイゼーション
   Status: responseParser で JSON パースのみ、HTML は表示しない（Markdown のみ）
   Action: xss パッケージで Markdown → HTML サニタイズ

4. レート制限
   Implementation:
     - Free: 10 msg/day, 100 msg/month
     - Pro: unlimited
     - API throttling: 429 Return
   Action: llmClient でリクエスト時に DynamoDB USAGE テーブル確認

5. 監査ログ
   Implementation:
     - CloudTrail: AWS API コール
     - CloudWatch Logs: Lambda function logs（90日保持）
     - S3: モデルファイル access logs
   Action: CDK で retention policy 設定
```

---

## 5. 最小ビアブル・プロダクト（MVP）チェックリスト

### リリース前に完了必須

```
【コア機能】
☑ AIチャット（Live2D + WebSocket ストリーミング）
☑ 3層記憶モデル（永久 / 中期 / 短期）
☑ Google Calendar + Tasks スキル
☑ トピック管理
☑ Web + iOS（Capacitor）対応
☑ Cognito 認証 + TOTP MFA

【収益化・法務】
☐ Stripe 統合（サブスク）
☐ メッセージレート制限
☐ 利用規約 + プライバシーポリシー
☐ Cookie バナー + GA4 同意

【セキュリティ】
☑ Bedrock Guardrails
☐ HTTPS + HSTS
☐ CSP ヘッダー
☐ 入力サニタイゼーション（XSS対策）

【監視・分析】
☐ Google Analytics 4（基本イベント）
☐ CloudWatch ダッシュボード
☐ エラーログ収集（CloudWatch Logs）

【UX / QA】
☐ オンボーディング チュートリアル（簡易版）
☐ エラー画面改善
☐ iOS テスト（iPhone 12+, iOS 15+）
☐ Chrome / Safari / Firefox テスト
☐ Lighthouse（LCP < 3s, CLS < 0.1）

【非必須 - v2.0 以降】
☓ 音声会話
☓ Chrome 拡張
☓ グループチャット
☓ 高度なリテンション施策（ストリーク等）
```

---

## 6. 6ヶ月ロードマップ

### Phase 1: MVP Hardening（Week 1-8）

```
目標: 商用リリース準備

Tasks:
 ☐ Stripe 統合（1週間）
 ☐ メッセージレート制限実装（3日）
 ☐ 利用規約 + プライバシーポリシー作成（3日）
 ☐ GA4 統計イベント実装（3日）
 ☐ CloudWatch ダッシュボード構築（3日）
 ☐ エラー画面 UX 改善（3日）
 ☐ オンボーディング チュートリアル（1週間）
 ☐ QA / テスト（2週間）
 ☐ 社内テスト + フィードバック反映（1週間）

Output:
  - Stripe checkout flow 完成
  - Free tier: 10 msg/day 制限
  - 利用規約掲載
  - Google Analytics で DAU / Retention 計測可能
```

### Phase 2: Early Access（Week 9-20）

```
目標: 初期ユーザー 500人獲得

Tasks:
 ☐ App Store + Google Play 登録（1週間）
 ☐ プレス資料 + PR（1週間）
 ☐ Product Hunt / Twitter マーケティング（2週間）
 ☐ 外部テスター 50人募集（2週間）
 ☐ Feedback 反映（2週間）
 ☐ リテンション KPI 監視（4週間）

Metrics:
  - Sign-ups: 100 → 500
  - DAU: 30 → 150
  - Day 7 Retention: 40% 以上
  - Pro conversion: 20% (100 paying users)
```

### Phase 3: Open Public Beta（Week 21-26）

```
目標: 公開リリース

Tasks:
 ☐ 制限なしリリース（1日）
 ☐ 継続的マーケティング（4週間）
 ☐ エンタープライズ営業 開始（4週間）
 ☐ 音声会話（Phase 1） ユースケース調査（2週間）

Metrics:
  - Sign-ups: 500 → 3000
  - DAU: 150 → 1000
  - NPS: 30 以上を目指す
  - MRR: ¥30K 達成
```

---

## 7. 重要な意思決定ポイント

### 決定 1: 音声会話 — v1.0 から削除か？

**推奨**: YES、v1.0 から削除

**理由**:
1. テキストチャットで十分
2. STT/TTS のレイテンシと品質改善に 2-3週間要する
3. オーディオハードウェア依存性が高い
4. 初期ユーザーテストで「必須ではない」を確認後に着手

**代案**: 簡易版（Web Speech API のみ）で alpha リリース

---

### 決定 2: メッセージレート制限 — メッセージ数か Cost？

**推奨**: メッセージ数制限

**理由**:
1. ユーザーに分かりやすい（「1日 10メッセージ」）
2. コスト変動の影響を軽減（Bedrock token 価格の変動に対応）
3. Premium tier との差別化が明確

---

### 決定 3: グループチャット — MVP に含めるか？

**推奨**: 外す（v1.5）

**理由**:
1. コア機能（個人 AI）でない
2. WebSocket 保守負荷が高い
3. モデレーション負荷

---

### 決定 4: MCP 統合 — MVP に含めるか？

**推奨**: 外す（v2.0）

**理由**:
1. ニッチユースケース
2. セットアップ複雑
3. Google Calendar/Tasks で十分

---

## 8. KPI と目標

### ユーザー獲得

```
Week 0-8: MVP Hardening（内部）
  - Sign-ups: 0 → 10（テスター）

Week 9-20: Early Access（招待制）
  - Sign-ups: 10 → 500
  - DAU: 3 → 150
  - Conversion to Pro: 20% (100 paying users)
  - MRR: ¥1K

Week 21-26: Open Beta（公開）
  - Sign-ups: 500 → 3000
  - DAU: 150 → 1000
  - Conversion to Pro: 30% (300 paying users)
  - MRR: ¥3K
```

### エンゲージメント

```
Day 1 Retention: > 50%
Day 7 Retention: > 40%
Day 30 Retention: > 20%

Avg Chats/User/Day: 2 (Free) ~ 5 (Pro)
Skill Utilization: 30% (Calendar/Tasks)
```

### 収益化

```
Free: 70% of users
Pro: 30% of users
ARPU: ¥3 (blended)
LTV: ¥90 (12-month, 30% churn)
CAC: ¥20 (organic)
```

### 技術指標

```
API Response Time: < 3s (p95)
API Error Rate: < 1%
Uptime: 99.9%
Cache Hit Rate (Prompt Caching): > 75%
Cold Start Ratio: < 10%
```

---

## 9. リスクと対策

| リスク | 影響 | 確率 | 対策 |
|--------|------|------|------|
| **Bedrock API 価格上昇** | コスト 30%↑ | 中 | Prompt Caching 最適化、maxTokens 削減 |
| **競合（Claude for Web）** | ユーザー吸収 | 高 | Live2D + 記憶機能で差別化 |
| **iOS App Store 審査落ち** | リリース遅延 | 低 | ガイドライン確認、自動更新ロジック整備 |
| **ユーザー流出（Day 7 Ret < 30%）** | KPI 未達 | 中 | オンボーディング改善、プッシュ通知 |
| **Security incident** | 信頼失墜 | 低 | Guardrails + 監査ログ充実 |
| **DynamoDB Throttling** | ユーザー体験低下 | 低 | オンデマンド課金、リード レプリカ検討 |

---

## 付録: 市場規模と競合分析

### TAM（Total Addressable Market）

```
Target: AI チャットアシスタント市場

Global:
  - AI chatbot users: 100M+ (2025)
  - Monthly active users: 50M+
  - Growth rate: 40% CAGR

Japan:
  - AI chatbot awareness: 80% (2025)
  - Regular users: 5M+
  - Growth rate: 50% CAGR

Ai-Ba TAM:
  - Target: 個人 AI 相棒（記憶・学習機能付き）
  - Addressable: 1M（Japan） + 10M（Global）
  - 初期は Japan focused
```

### 競合分析

| プロダクト | 強み | 弱み | 対抗策 |
|-----------|------|------|-------|
| **Claude Web** | 最先端 AI / 無料 | 会話履歴なし / キャラなし | Live2D + 3層記憶で差別化 |
| **ChatGPT** | 圧倒的ユーザー数 | 有料（$20/月） / キャラなし | エモーショナル接続（Live2D） |
| **Replika** | キャラクター / 記憶 | 低品質 AI / 高レート | Superior LLM（Haiku 4.5） |
| **Character.AI** | キャラクター / Social | UI 複雑 / 遅い | シンプル UX + 高速応答 |

---

## 参考資料

- [Stripe API Documentation](https://stripe.com/docs/api)
- [Google Analytics 4 Setup Guide](https://support.google.com/analytics/answer/9304153)
- [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [GDPR Guide for Product Teams](https://gdpr-info.eu/)

---

**作成日**: 2026-03-12
**作成者**: Product Manager
**レビュー**: Team Lead (要確認)
**次更新**: 2026-03-26（Phase 2 開始時）
