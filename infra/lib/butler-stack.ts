import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs'
import * as iam from 'aws-cdk-lib/aws-iam'
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

    // MEMORY_ID（AgentCore Memory — CLI で事前作成）
    const memoryId = process.env.MEMORY_ID ?? ''

    // Google OAuth 認証情報（環境変数で渡す）
    const googleClientId = process.env.GOOGLE_CLIENT_ID ?? ''
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? ''
    const googleIosClientId = process.env.GOOGLE_IOS_CLIENT_ID ?? ''

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
  }
}
