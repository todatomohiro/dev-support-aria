# 要件定義書

## はじめに

本ドキュメントは、クロスプラットフォーム対応の「執事アプリケーション」の要件を定義します。このアプリケーションは、チャットベースのUIを通じてユーザーの質問に回答し、Live2D技術を用いた執事キャラクターが感情豊かなモーションで応答を演出するユーザーサポートシステムです。PC（Windows/Mac）およびスマートフォン（iOS/Android）で動作します。

## 用語集

- **Butler_App**: 執事アプリケーション全体のシステム
- **Chat_UI**: ユーザーとのメッセージのやり取りを表示するチャットインターフェース
- **Live2D_Renderer**: Live2D Cubism SDKを用いてキャラクターを描画するレンダリングエンジン
- **LLM_Client**: Gemini APIまたはClaude APIと通信し、回答を取得するクライアント
- **Motion_Controller**: Live2Dモーションの再生を制御するコントローラー
- **Response_Parser**: LLMからのJSON形式レスポンスを解析するパーサー
- **Model_Importer**: ユーザーが作成したLive2Dモデルをインポートする機能
- **構造化出力**: LLMからのレスポンスをJSON形式で取得する仕組み
- **モーションタグ**: JSON内の`motion`フィールドに指定されるモーション識別子

## 要件

### 要件1: チャットインターフェースの提供

**ユーザーストーリー:** ユーザーとして、視覚的にわかりやすいチャットUIで質問と回答を確認したい。そうすることで、会話の流れを追いやすくなる。

#### 受入基準

1. THE Chat_UI SHALL ユーザーメッセージと執事の回答を時系列順に表示する
2. THE Chat_UI SHALL メッセージ履歴をスクロール可能な形式で表示する
3. WHEN ユーザーがメッセージを入力する, THE Chat_UI SHALL 入力フィールドとメッセージ送信ボタンを提供する
4. WHEN メッセージが送信される, THE Chat_UI SHALL 送信されたメッセージを即座にチャット履歴に追加する
5. WHILE LLMからの回答を待機している, THE Chat_UI SHALL ローディングインジケーターを表示する

### 要件2: Live2Dキャラクターの描画

**ユーザーストーリー:** ユーザーとして、画面上に執事キャラクターが表示されることで、より親しみやすいサポート体験を得たい。

#### 受入基準

1. THE Live2D_Renderer SHALL Cubism SDK for Webを使用してLive2Dモデルを描画する
2. THE Live2D_Renderer SHALL キャラクターを透過背景で描画する
3. WHEN アプリケーションが起動する, THE Live2D_Renderer SHALL 待機モーションをループ再生する
4. THE Live2D_Renderer SHALL PC版とスマートフォン版の両方で正常に動作する
5. THE Live2D_Renderer SHALL 画面サイズに応じてキャラクターの表示サイズを調整する

### 要件3: LLMによる回答生成

**ユーザーストーリー:** ユーザーとして、質問に対して執事の個性を持った適切な回答を得たい。そうすることで、単なる機械的な応答ではなく、キャラクターとの対話を楽しめる。

#### 受入基準

1. WHEN ユーザーがメッセージを送信する, THE LLM_Client SHALL Gemini APIまたはClaude APIにリクエストを送信する
2. THE LLM_Client SHALL システムプロンプトに「ユーザーをサポートする優秀な執事」のキャラクター設定を含める
3. THE LLM_Client SHALL LLMからの回答をJSON形式で取得する
4. IF APIリクエストが失敗する, THEN THE LLM_Client SHALL エラーメッセージをユーザーに通知する
5. THE LLM_Client SHALL APIキーを安全に管理する

### 要件4: 構造化出力の解析

**ユーザーストーリー:** システムとして、LLMからの回答を確実に解析し、テキストとモーション情報を分離したい。そうすることで、表示とモーション再生を適切に制御できる。

#### 受入基準

1. THE Response_Parser SHALL LLMからのJSON形式レスポンスを解析する
2. THE Response_Parser SHALL `text`フィールドから回答テキストを抽出する
3. THE Response_Parser SHALL `motion`フィールドからモーションタグを抽出する
4. IF JSONの解析に失敗する, THEN THE Response_Parser SHALL デフォルトの回答テキストとモーションを返す
5. THE Response_Parser SHALL 解析結果をChat_UIとMotion_Controllerに渡す

### 要件5: モーション連動機構

**ユーザーストーリー:** ユーザーとして、執事キャラクターが回答内容に応じた感情表現をすることで、より生き生きとした対話体験を得たい。

#### 受入基準

1. WHEN Response_Parserがモーションタグを抽出する, THE Motion_Controller SHALL 対応するLive2Dモーションを再生する
2. THE Motion_Controller SHALL 少なくとも以下のモーションタグをサポートする: `bow`（お辞儀）, `smile`（笑顔）, `think`（考える）, `nod`（うなずく）, `idle`（待機）
3. IF 指定されたモーションタグが存在しない, THEN THE Motion_Controller SHALL デフォルトの待機モーションを再生する
4. THE Motion_Controller SHALL モーション再生完了後に待機モーションに戻る
5. WHILE モーションが再生中である, THE Motion_Controller SHALL 新しいモーションリクエストをキューに追加する

### 要件6: クロスプラットフォーム対応

**ユーザーストーリー:** ユーザーとして、PC（Windows/Mac）とスマートフォン（iOS/Android）の両方で同じアプリケーションを使用したい。

#### 受入基準

1. THE Butler_App SHALL PC版としてElectronまたはTauriを使用してパッケージングされる
2. THE Butler_App SHALL スマートフォン版としてCapacitorを使用してパッケージングされる
3. THE Butler_App SHALL Windows、Mac、iOS、Androidの各プラットフォームで動作する
4. THE Butler_App SHALL プラットフォーム固有のUIガイドラインに準拠する
5. THE Butler_App SHALL 各プラットフォームで一貫したユーザー体験を提供する

### 要件7: Live2Dモデルのインポート機能

**ユーザーストーリー:** ユーザーとして、自分で作成したLive2Dモデルをインポートして、キャラクターを差し替えたい。そうすることで、アプリケーションをカスタマイズできる。

#### 受入基準

1. THE Model_Importer SHALL ユーザーが選択したLive2Dモデルファイル一式（.model3.json、テクスチャ、モーションファイル）を読み込む
2. WHEN ユーザーがモデルをインポートする, THE Model_Importer SHALL モデルファイルの妥当性を検証する
3. IF モデルファイルが不正である, THEN THE Model_Importer SHALL エラーメッセージを表示する
4. WHEN モデルのインポートが成功する, THE Live2D_Renderer SHALL 新しいモデルを描画に使用する
5. THE Model_Importer SHALL インポートされたモデルの設定を永続化する

### 要件8: 構造化出力のラウンドトリップ検証

**ユーザーストーリー:** システムとして、LLMからの構造化出力が正しく解析され、再構築できることを保証したい。

#### 受入基準

1. THE Response_Parser SHALL JSON形式の文字列を解析してResponseオブジェクトに変換する
2. THE Response_Parser SHALL Responseオブジェクトを再度JSON形式の文字列にシリアライズする機能を提供する
3. すべての有効なResponseオブジェクトについて、解析→シリアライズ→解析を行った結果が元のオブジェクトと等価である（ラウンドトリッププロパティ）
4. THE Response_Parser SHALL 必須フィールド（`text`、`motion`）の存在を検証する
5. IF 必須フィールドが欠落している, THEN THE Response_Parser SHALL デフォルト値を補完する

### 要件9: APIキーの安全な管理

**ユーザーストーリー:** ユーザーとして、APIキーが安全に保存され、不正アクセスから保護されることを期待する。

#### 受入基準

1. THE Butler_App SHALL APIキーを環境変数または暗号化されたストレージに保存する
2. THE Butler_App SHALL APIキーをソースコードにハードコーディングしない
3. THE Butler_App SHALL 初回起動時にAPIキーの入力を求める
4. WHEN ユーザーがAPIキーを入力する, THE Butler_App SHALL 入力フィールドをマスク表示する
5. THE Butler_App SHALL APIキーをログやエラーメッセージに出力しない

### 要件10: エラーハンドリングとユーザー通知

**ユーザーストーリー:** ユーザーとして、エラーが発生した際に何が問題なのかを理解し、適切に対処したい。

#### 受入基準

1. IF ネットワークエラーが発生する, THEN THE Butler_App SHALL 「ネットワーク接続を確認してください」というメッセージを表示する
2. IF API呼び出しがレート制限に達する, THEN THE Butler_App SHALL 「しばらく待ってから再試行してください」というメッセージを表示する
3. IF Live2Dモデルの読み込みに失敗する, THEN THE Butler_App SHALL デフォルトの静的画像を表示する
4. WHEN エラーが発生する, THE Motion_Controller SHALL 困惑または謝罪のモーションを再生する
5. THE Butler_App SHALL すべてのエラーをログファイルに記録する

### 要件11: レスポンシブデザイン

**ユーザーストーリー:** ユーザーとして、使用しているデバイスの画面サイズに最適化されたUIを体験したい。

#### 受入基準

1. THE Chat_UI SHALL スマートフォンの縦画面レイアウトに対応する
2. THE Chat_UI SHALL タブレットおよびPCの横画面レイアウトに対応する
3. WHEN 画面サイズが変更される, THE Butler_App SHALL UIレイアウトを動的に調整する
4. THE Live2D_Renderer SHALL 小画面デバイスでキャラクターサイズを縮小する
5. THE Chat_UI SHALL タッチ操作とマウス操作の両方をサポートする

### 要件12: パフォーマンスと応答性

**ユーザーストーリー:** ユーザーとして、アプリケーションが快適に動作し、待ち時間が最小限であることを期待する。

#### 受入基準

1. WHEN ユーザーがメッセージを送信する, THE Butler_App SHALL 500ミリ秒以内にUIを更新する
2. THE Live2D_Renderer SHALL 60FPSでキャラクターアニメーションを描画する
3. THE Butler_App SHALL メモリ使用量を500MB以下に抑える
4. WHEN LLM APIからの応答を受信する, THE Butler_App SHALL 100ミリ秒以内にレスポンスの解析を完了する
5. THE Butler_App SHALL アプリケーション起動から3秒以内にチャット可能な状態になる

## 非機能要件

### 拡張性

- THE Butler_App SHALL ユーザーが独自のLive2Dモデルをインポートできるアーキテクチャを採用する
- THE Butler_App SHALL モーションタグとモーションファイルのマッピングを設定ファイルで管理する
- THE Butler_App SHALL 新しいLLMプロバイダーを追加可能な設計とする

### 保守性

- THE Butler_App SHALL TypeScriptを使用して型安全性を確保する
- THE Butler_App SHALL コンポーネントベースのアーキテクチャを採用する
- THE Butler_App SHALL 各モジュールの責務を明確に分離する

### セキュリティ

- THE Butler_App SHALL ユーザーデータをローカルストレージに保存する際に暗号化する
- THE Butler_App SHALL HTTPS通信のみを使用してAPI呼び出しを行う
- THE Butler_App SHALL 外部からの不正なモデルファイル読み込みを防ぐ検証機構を持つ
