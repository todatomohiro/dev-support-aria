import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
import type { Construct } from 'constructs'
import * as path from 'path'

export class ButlerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ── DynamoDB テーブル ──
    const table = new dynamodb.Table(this, 'ButlerTable', {
      tableName: 'butler-assistant',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttlExpiry',
    })

    // ── GSI（フレンドコード逆引き、会話一覧ソート）──
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // ── Cognito User Pool ──
    const userPool = new cognito.UserPool(this, 'ButlerUserPool', {
      userPoolName: 'butler-assistant-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // App Client（SPA 用 — SRP 認証、client secret なし）
    const userPoolClient = userPool.addClient('ButlerAppClient', {
      userPoolClientName: 'butler-assistant-web',
      generateSecret: false,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      authFlows: {
        userSrp: true,
      },
    })

    // ── Lambda 関数 ──
    const lambdaDefaults: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    }

    const settingsGetFn = new lambdaNode.NodejsFunction(this, 'SettingsGetFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'settings', 'get.ts'),
      functionName: 'butler-settings-get',
    })

    const settingsPutFn = new lambdaNode.NodejsFunction(this, 'SettingsPutFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'settings', 'put.ts'),
      functionName: 'butler-settings-put',
    })

    const messagesListFn = new lambdaNode.NodejsFunction(this, 'MessagesListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'messages', 'list.ts'),
      functionName: 'butler-messages-list',
    })

    const messagesPutFn = new lambdaNode.NodejsFunction(this, 'MessagesPutFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'messages', 'put.ts'),
      functionName: 'butler-messages-put',
    })

    // ── Friends Lambda 関数 ──
    const friendsGenerateCodeFn = new lambdaNode.NodejsFunction(this, 'FriendsGenerateCodeFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'friends', 'generateCode.ts'),
      functionName: 'butler-friends-generate-code',
    })

    const friendsGetCodeFn = new lambdaNode.NodejsFunction(this, 'FriendsGetCodeFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'friends', 'getCode.ts'),
      functionName: 'butler-friends-get-code',
    })

    const friendsLinkFn = new lambdaNode.NodejsFunction(this, 'FriendsLinkFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'friends', 'link.ts'),
      functionName: 'butler-friends-link',
    })

    const friendsListFn = new lambdaNode.NodejsFunction(this, 'FriendsListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'friends', 'list.ts'),
      functionName: 'butler-friends-list',
    })

    const friendsUnfriendFn = new lambdaNode.NodejsFunction(this, 'FriendsUnfriendFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'friends', 'unfriend.ts'),
      functionName: 'butler-friends-unfriend',
    })

    // ── Groups Lambda 関数 ──
    const groupsCreateFn = new lambdaNode.NodejsFunction(this, 'GroupsCreateFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'groups', 'create.ts'),
      functionName: 'butler-groups-create',
    })

    const groupsAddMemberFn = new lambdaNode.NodejsFunction(this, 'GroupsAddMemberFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'groups', 'addMember.ts'),
      functionName: 'butler-groups-add-member',
    })

    const groupsLeaveFn = new lambdaNode.NodejsFunction(this, 'GroupsLeaveFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'groups', 'leave.ts'),
      functionName: 'butler-groups-leave',
    })

    const groupsMembersFn = new lambdaNode.NodejsFunction(this, 'GroupsMembersFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'groups', 'members.ts'),
      functionName: 'butler-groups-members',
    })

    // ── Themes Lambda 関数 ──
    const themesCreateFn = new lambdaNode.NodejsFunction(this, 'ThemesCreateFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'themes', 'create.ts'),
      functionName: 'butler-themes-create',
    })

    const themesListFn = new lambdaNode.NodejsFunction(this, 'ThemesListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'themes', 'list.ts'),
      functionName: 'butler-themes-list',
    })

    const themesDeleteFn = new lambdaNode.NodejsFunction(this, 'ThemesDeleteFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'themes', 'delete.ts'),
      functionName: 'butler-themes-delete',
    })

    const themesUpdateFn = new lambdaNode.NodejsFunction(this, 'ThemesUpdateFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'themes', 'update.ts'),
      functionName: 'butler-themes-update',
    })

    const themesMessagesFn = new lambdaNode.NodejsFunction(this, 'ThemesMessagesFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'themes', 'messages.ts'),
      functionName: 'butler-themes-messages',
    })

    // ── Conversations Lambda 関数（/groups ルートで利用）──
    const conversationsListFn = new lambdaNode.NodejsFunction(this, 'ConversationsListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'conversations', 'list.ts'),
      functionName: 'butler-conversations-list',
    })

    const conversationsMessagesListFn = new lambdaNode.NodejsFunction(this, 'ConversationsMessagesListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'conversations', 'messagesList.ts'),
      functionName: 'butler-conversations-messages-list',
    })

    const conversationsMessagesSendFn = new lambdaNode.NodejsFunction(this, 'ConversationsMessagesSendFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'conversations', 'messagesSend.ts'),
      functionName: 'butler-conversations-messages-send',
    })

    const conversationsMessagesPollFn = new lambdaNode.NodejsFunction(this, 'ConversationsMessagesPollFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'conversations', 'messagesPoll.ts'),
      functionName: 'butler-conversations-messages-poll',
    })

    const conversationsMessagesReadFn = new lambdaNode.NodejsFunction(this, 'ConversationsMessagesReadFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'conversations', 'messagesRead.ts'),
      functionName: 'butler-conversations-messages-read',
    })

    // ── WebSocket Lambda 関数 ──
    const wsAuthorizerFn = new lambdaNode.NodejsFunction(this, 'WsAuthorizerFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'ws', 'authorizer.ts'),
      functionName: 'butler-ws-authorizer',
      environment: {
        TABLE_NAME: table.tableName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    })

    const wsConnectFn = new lambdaNode.NodejsFunction(this, 'WsConnectFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'ws', 'connect.ts'),
      functionName: 'butler-ws-connect',
    })

    const wsDisconnectFn = new lambdaNode.NodejsFunction(this, 'WsDisconnectFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'ws', 'disconnect.ts'),
      functionName: 'butler-ws-disconnect',
    })

    table.grantReadWriteData(wsConnectFn)
    table.grantReadWriteData(wsDisconnectFn)

    // ── WebSocket API ──
    const wsApi = new apigatewayv2.WebSocketApi(this, 'ButlerWsApi', {
      apiName: 'butler-assistant-ws',
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration('WsConnectIntegration', wsConnectFn),
        authorizer: new apigatewayv2Authorizers.WebSocketLambdaAuthorizer('WsLambdaAuthorizer', wsAuthorizerFn, {
          identitySource: ['route.request.querystring.token'],
        }),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration('WsDisconnectIntegration', wsDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration('WsDefaultIntegration', wsConnectFn),
      },
    })

    const wsStage = new apigatewayv2.WebSocketStage(this, 'WsProdStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true,
    })

    // メッセージ送信 Lambda に WebSocket プッシュ権限を付与
    conversationsMessagesSendFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [wsApi.arnForExecuteApiV2('*', '/*')],
    }))

    // メッセージ送信 Lambda に WebSocket エンドポイントを設定
    conversationsMessagesSendFn.addEnvironment('WEBSOCKET_ENDPOINT', wsStage.callbackUrl)

    // 既読更新 Lambda に WebSocket プッシュ権限を付与
    conversationsMessagesReadFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [wsApi.arnForExecuteApiV2('*', '/*')],
    }))
    conversationsMessagesReadFn.addEnvironment('WEBSOCKET_ENDPOINT', wsStage.callbackUrl)

    // グループメンバー追加 Lambda に WebSocket プッシュ権限を付与
    groupsAddMemberFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [wsApi.arnForExecuteApiV2('*', '/*')],
    }))
    groupsAddMemberFn.addEnvironment('WEBSOCKET_ENDPOINT', wsStage.callbackUrl)

    // グループ退出 Lambda に WebSocket プッシュ権限を付与
    groupsLeaveFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [wsApi.arnForExecuteApiV2('*', '/*')],
    }))
    groupsLeaveFn.addEnvironment('WEBSOCKET_ENDPOINT', wsStage.callbackUrl)

    // TTS Lambda（Polly 用 — DynamoDB 不要）
    const ttsSynthesizeFn = new lambdaNode.NodejsFunction(this, 'TtsSynthesizeFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      entry: path.join(__dirname, '..', 'lambda', 'tts', 'synthesize.ts'),
      functionName: 'butler-tts-synthesize',
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    })

    // Polly 音声合成権限
    ttsSynthesizeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }))

    // ── シークレット（SSM Parameter Store 優先、環境変数フォールバック）──
    const ssmPrefix = '/butler-assistant'
    const getSecret = (name: string, envKey: string): string => {
      // 環境変数が明示的に設定されていればそちらを使用
      if (process.env[envKey]) return process.env[envKey]!
      // SSM Parameter Store から取得（デプロイ時に解決）
      try {
        return ssm.StringParameter.valueForStringParameter(this, `${ssmPrefix}/${name}`)
      } catch {
        return ''
      }
    }

    const memoryId = getSecret('MEMORY_ID', 'MEMORY_ID')
    const googleClientId = getSecret('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID')
    const googleClientSecret = getSecret('GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET')
    const googleIosClientId = getSecret('GOOGLE_IOS_CLIENT_ID', 'GOOGLE_IOS_CLIENT_ID')
    const googlePlacesApiKey = getSecret('GOOGLE_PLACES_API_KEY', 'GOOGLE_PLACES_API_KEY')
    const braveSearchApiKey = getSecret('BRAVE_SEARCH_API_KEY', 'BRAVE_SEARCH_API_KEY')

    // 要約 Lambda（Haiku 4.5 で会話ローリング要約を生成）
    const llmSummarizeFn = new lambdaNode.NodejsFunction(this, 'LlmSummarizeFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      entry: path.join(__dirname, '..', 'lambda', 'llm', 'summarize.ts'),
      functionName: 'butler-llm-summarize',
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    })

    table.grantReadWriteData(llmSummarizeFn)

    // Bedrock Converse 権限（Haiku 4.5 inference profile）
    llmSummarizeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }))

    // 事実抽出 Lambda（セッション終了時に永久記憶を抽出）
    const extractFactsFn = new lambdaNode.NodejsFunction(this, 'ExtractFactsFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      entry: path.join(__dirname, '..', 'lambda', 'llm', 'extractFacts.ts'),
      functionName: 'butler-extract-facts',
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    })

    table.grantReadWriteData(extractFactsFn)

    // Bedrock Converse 権限（Haiku 4.5 inference profile）
    extractFactsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }))

    // セッション終了検出 Lambda（EventBridge 15分ルールで起動）
    const sessionFinalizerFn = new lambdaNode.NodejsFunction(this, 'SessionFinalizerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      entry: path.join(__dirname, '..', 'lambda', 'llm', 'sessionFinalizer.ts'),
      functionName: 'butler-session-finalizer',
      environment: {
        TABLE_NAME: table.tableName,
        EXTRACT_FACTS_FUNCTION_NAME: extractFactsFn.functionName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    })

    table.grantReadData(sessionFinalizerFn)
    extractFactsFn.grantInvoke(sessionFinalizerFn)

    // EventBridge ルール: 15分ごとに sessionFinalizer を起動
    new events.Rule(this, 'SessionFinalizerRule', {
      ruleName: 'butler-session-finalizer-schedule',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new eventsTargets.LambdaFunction(sessionFinalizerFn)],
    })

    // LLM Lambda（Bedrock Converse API + Tool Use + AgentCore Memory 検索）
    const llmChatFn = new lambdaNode.NodejsFunction(this, 'LlmChatFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(90),
      memorySize: 256,
      entry: path.join(__dirname, '..', 'lambda', 'llm', 'chat.ts'),
      functionName: 'butler-llm-chat',
      environment: {
        MEMORY_ID: memoryId,
        TABLE_NAME: table.tableName,
        GOOGLE_CLIENT_ID: googleClientId,
        GOOGLE_CLIENT_SECRET: googleClientSecret,
        GOOGLE_IOS_CLIENT_ID: googleIosClientId,
        GOOGLE_PLACES_API_KEY: googlePlacesApiKey,
        BRAVE_SEARCH_API_KEY: braveSearchApiKey,
        SUMMARIZE_FUNCTION_NAME: llmSummarizeFn.functionName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    })

    // Bedrock Converse 権限（inference profile + foundation model）
    llmChatFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }))

    // LLM Lambda から DynamoDB への読み書き権限（トークン管理）
    table.grantReadWriteData(llmChatFn)

    // AgentCore Memory 検索権限
    llmChatFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:RetrieveMemoryRecords'],
      resources: ['*'],
    }))

    // 要約 Lambda 非同期起動権限
    llmSummarizeFn.grantInvoke(llmChatFn)

    // Memory Events Lambda（AgentCore Memory にイベント記録）
    const memoryEventsFn = new lambdaNode.NodejsFunction(this, 'MemoryEventsFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      entry: path.join(__dirname, '..', 'lambda', 'memory', 'events.ts'),
      functionName: 'butler-memory-events',
      environment: {
        MEMORY_ID: memoryId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    })

    // AgentCore Memory イベント作成権限
    memoryEventsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:CreateEvent'],
      resources: ['*'],
    }))

    // ── Skills Lambda 関数（OAuth 管理）──

    const skillsCallbackFn = new lambdaNode.NodejsFunction(this, 'SkillsCallbackFn', {
      ...lambdaDefaults,
      timeout: cdk.Duration.seconds(15),
      entry: path.join(__dirname, '..', 'lambda', 'skills', 'callback.ts'),
      functionName: 'butler-skills-callback',
      environment: {
        TABLE_NAME: table.tableName,
        GOOGLE_CLIENT_ID: googleClientId,
        GOOGLE_CLIENT_SECRET: googleClientSecret,
        GOOGLE_IOS_CLIENT_ID: googleIosClientId,
      },
    })

    const skillsConnectionsFn = new lambdaNode.NodejsFunction(this, 'SkillsConnectionsFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'skills', 'connections.ts'),
      functionName: 'butler-skills-connections',
    })

    const skillsDisconnectFn = new lambdaNode.NodejsFunction(this, 'SkillsDisconnectFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'skills', 'disconnect.ts'),
      functionName: 'butler-skills-disconnect',
      environment: {
        TABLE_NAME: table.tableName,
        GOOGLE_CLIENT_ID: googleClientId,
        GOOGLE_CLIENT_SECRET: googleClientSecret,
      },
    })

    // DynamoDB への読み書き権限
    table.grantReadData(settingsGetFn)
    table.grantReadWriteData(settingsPutFn)
    table.grantReadData(messagesListFn)
    table.grantReadWriteData(messagesPutFn)
    table.grantReadWriteData(skillsCallbackFn)
    table.grantReadData(skillsConnectionsFn)
    table.grantReadWriteData(skillsDisconnectFn)

    // Friends — DynamoDB 権限
    table.grantReadWriteData(friendsGenerateCodeFn)
    table.grantReadData(friendsGetCodeFn)
    table.grantReadWriteData(friendsLinkFn)
    table.grantReadData(friendsListFn)
    table.grantReadWriteData(friendsUnfriendFn)

    // Groups — DynamoDB 権限
    table.grantReadWriteData(groupsCreateFn)
    table.grantReadWriteData(groupsAddMemberFn)
    table.grantReadWriteData(groupsLeaveFn)
    table.grantReadData(groupsMembersFn)

    // Themes — DynamoDB 権限
    table.grantReadWriteData(themesCreateFn)
    table.grantReadData(themesListFn)
    table.grantReadWriteData(themesDeleteFn)
    table.grantReadWriteData(themesUpdateFn)
    table.grantReadData(themesMessagesFn)

    // Conversations（/groups ルート）— DynamoDB 権限
    table.grantReadData(conversationsListFn)
    table.grantReadData(conversationsMessagesListFn)
    table.grantReadWriteData(conversationsMessagesSendFn)
    table.grantReadData(conversationsMessagesPollFn)
    table.grantReadWriteData(conversationsMessagesReadFn)

    // ── API Gateway ──
    const api = new apigateway.RestApi(this, 'ButlerApi', {
      restApiName: 'Butler Assistant API',
      description: 'Butler Assistant App backend API',
      defaultCorsPreflightOptions: {
        allowOrigins: ['http://localhost:5173', 'capacitor://localhost', 'https://butler-assistant.example.com'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
    })

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ButlerAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'butler-cognito-authorizer',
    })

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    }

    // /settings
    const settingsResource = api.root.addResource('settings')
    settingsResource.addMethod('GET', new apigateway.LambdaIntegration(settingsGetFn), authMethodOptions)
    settingsResource.addMethod('PUT', new apigateway.LambdaIntegration(settingsPutFn), authMethodOptions)

    // /messages
    const messagesResource = api.root.addResource('messages')
    messagesResource.addMethod('GET', new apigateway.LambdaIntegration(messagesListFn), authMethodOptions)
    messagesResource.addMethod('POST', new apigateway.LambdaIntegration(messagesPutFn), authMethodOptions)

    // /tts/synthesize
    const ttsResource = api.root.addResource('tts')
    const ttsSynthesizeResource = ttsResource.addResource('synthesize')
    ttsSynthesizeResource.addMethod('POST', new apigateway.LambdaIntegration(ttsSynthesizeFn), authMethodOptions)

    // /llm/chat
    const llmResource = api.root.addResource('llm')
    const llmChatResource = llmResource.addResource('chat')
    llmChatResource.addMethod('POST', new apigateway.LambdaIntegration(llmChatFn), authMethodOptions)

    // /memory/events
    const memoryResource = api.root.addResource('memory')
    const memoryEventsResource = memoryResource.addResource('events')
    memoryEventsResource.addMethod('POST', new apigateway.LambdaIntegration(memoryEventsFn), authMethodOptions)

    // /skills/connections (GET)
    const skillsResource = api.root.addResource('skills')
    const skillsConnectionsResource = skillsResource.addResource('connections')
    skillsConnectionsResource.addMethod('GET', new apigateway.LambdaIntegration(skillsConnectionsFn), authMethodOptions)

    // /skills/google/callback (POST), /skills/google/disconnect (DELETE)
    const skillsGoogleResource = skillsResource.addResource('google')
    const skillsGoogleCallbackResource = skillsGoogleResource.addResource('callback')
    skillsGoogleCallbackResource.addMethod('POST', new apigateway.LambdaIntegration(skillsCallbackFn), authMethodOptions)
    const skillsGoogleDisconnectResource = skillsGoogleResource.addResource('disconnect')
    skillsGoogleDisconnectResource.addMethod('DELETE', new apigateway.LambdaIntegration(skillsDisconnectFn), authMethodOptions)

    // /friends
    const friendsResource = api.root.addResource('friends')
    friendsResource.addMethod('GET', new apigateway.LambdaIntegration(friendsListFn), authMethodOptions)

    // /friends/code
    const friendsCodeResource = friendsResource.addResource('code')
    friendsCodeResource.addMethod('GET', new apigateway.LambdaIntegration(friendsGetCodeFn), authMethodOptions)
    friendsCodeResource.addMethod('POST', new apigateway.LambdaIntegration(friendsGenerateCodeFn), authMethodOptions)

    // /friends/link
    const friendsLinkResource = friendsResource.addResource('link')
    friendsLinkResource.addMethod('POST', new apigateway.LambdaIntegration(friendsLinkFn), authMethodOptions)

    // /friends/{friendUserId}
    const friendByIdResource = friendsResource.addResource('{friendUserId}')
    friendByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(friendsUnfriendFn), authMethodOptions)

    // /groups
    const groupsResource = api.root.addResource('groups')
    groupsResource.addMethod('GET', new apigateway.LambdaIntegration(conversationsListFn), authMethodOptions)
    groupsResource.addMethod('POST', new apigateway.LambdaIntegration(groupsCreateFn), authMethodOptions)

    // /groups/{id}/messages
    const groupByIdResource = groupsResource.addResource('{id}')
    const groupMessagesResource = groupByIdResource.addResource('messages')
    groupMessagesResource.addMethod('GET', new apigateway.LambdaIntegration(conversationsMessagesListFn), authMethodOptions)
    groupMessagesResource.addMethod('POST', new apigateway.LambdaIntegration(conversationsMessagesSendFn), authMethodOptions)

    // /groups/{id}/messages/new
    const groupMessagesNewResource = groupMessagesResource.addResource('new')
    groupMessagesNewResource.addMethod('GET', new apigateway.LambdaIntegration(conversationsMessagesPollFn), authMethodOptions)

    // /groups/{id}/messages/read
    const groupMessagesReadResource = groupMessagesResource.addResource('read')
    groupMessagesReadResource.addMethod('POST', new apigateway.LambdaIntegration(conversationsMessagesReadFn), authMethodOptions)

    // /groups/{id}/members
    const groupMembersResource = groupByIdResource.addResource('members')
    groupMembersResource.addMethod('GET', new apigateway.LambdaIntegration(groupsMembersFn), authMethodOptions)
    groupMembersResource.addMethod('POST', new apigateway.LambdaIntegration(groupsAddMemberFn), authMethodOptions)

    // /groups/{id}/members/me
    const groupMembersMeResource = groupMembersResource.addResource('me')
    groupMembersMeResource.addMethod('DELETE', new apigateway.LambdaIntegration(groupsLeaveFn), authMethodOptions)

    // /themes
    const themesResource = api.root.addResource('themes')
    themesResource.addMethod('GET', new apigateway.LambdaIntegration(themesListFn), authMethodOptions)
    themesResource.addMethod('POST', new apigateway.LambdaIntegration(themesCreateFn), authMethodOptions)

    // /themes/{themeId}
    const themeByIdResource = themesResource.addResource('{themeId}')
    themeByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(themesDeleteFn), authMethodOptions)
    themeByIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(themesUpdateFn), authMethodOptions)

    // /themes/{themeId}/messages
    const themeMessagesResource = themeByIdResource.addResource('messages')
    themeMessagesResource.addMethod('GET', new apigateway.LambdaIntegration(themesMessagesFn), authMethodOptions)

    // ── Outputs ──
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    })

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
    })

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    })

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB table name',
    })

    new cdk.CfnOutput(this, 'WsApiUrl', {
      value: wsStage.url,
      description: 'WebSocket API URL',
    })
  }
}
