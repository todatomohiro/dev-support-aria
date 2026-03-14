import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
import * as path from 'path'

interface AdminNestedStackProps extends cdk.NestedStackProps {
  /** メインテーブル */
  table: dynamodb.ITable
  /** REST API */
  api: apigateway.RestApi
  /** Cognito Authorizer */
  authorizer: apigateway.IAuthorizer
  /** Cognito User Pool */
  userPool: cognito.IUserPool
  /** Live2D モデル用 S3 バケット */
  modelsBucket: s3.IBucket
  /** モデル CDN ベース URL */
  modelsCdnBase: string
}

/**
 * 管理画面系 Lambda + API ルートを分離したネステッドスタック
 *
 * 親スタックのリソース上限（500）を回避するために分離。
 * Admin Lambda 11個 + API ルート + DynamoDB/Cognito/S3 権限を含む。
 */
export class AdminNestedStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: AdminNestedStackProps) {
    super(scope, id, props)

    const { table, api, authorizer, userPool, modelsBucket, modelsCdnBase } = props

    // ── Lambda 共通設定 ──
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

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    }

    // ── Admin Lambda 関数 ──
    const adminMeFn = new lambdaNode.NodejsFunction(this, 'AdminMeFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'me.ts'),
    })

    const adminUsersListFn = new lambdaNode.NodejsFunction(this, 'AdminUsersListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'usersList.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
      },
    })

    const adminUsersDetailFn = new lambdaNode.NodejsFunction(this, 'AdminUsersDetailFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'usersDetail.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
      },
    })

    const adminUsersRoleFn = new lambdaNode.NodejsFunction(this, 'AdminUsersRoleFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'usersRole.ts'),
    })

    const adminUsersActivityFn = new lambdaNode.NodejsFunction(this, 'AdminUsersActivityFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'usersActivity.ts'),
    })

    const adminUsersMemoryFn = new lambdaNode.NodejsFunction(this, 'AdminUsersMemoryFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'usersMemory.ts'),
    })

    // ── Admin — DynamoDB 権限 ──
    table.grantReadData(adminMeFn)
    table.grantReadData(adminUsersListFn)
    table.grantReadData(adminUsersDetailFn)
    table.grantReadData(adminUsersActivityFn)
    table.grantReadWriteData(adminUsersMemoryFn)
    table.grantReadWriteData(adminUsersRoleFn)

    // Admin — Cognito ListUsers/AdminGetUser 権限
    const cognitoReadPolicy = new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    })
    adminUsersListFn.addToRolePolicy(cognitoReadPolicy)
    adminUsersDetailFn.addToRolePolicy(cognitoReadPolicy)

    // ── Admin API ルート ──
    // API リソースツリーを構築: /admin/...
    const adminResource = api.root.addResource('admin')

    // /admin/me
    const adminMeResource = adminResource.addResource('me')
    adminMeResource.addMethod('GET', new apigateway.LambdaIntegration(adminMeFn), authMethodOptions)

    // /admin/users
    const adminUsersResource = adminResource.addResource('users')
    adminUsersResource.addMethod('GET', new apigateway.LambdaIntegration(adminUsersListFn), authMethodOptions)

    // /admin/users/{userId}
    const adminUserByIdResource = adminUsersResource.addResource('{userId}')
    adminUserByIdResource.addMethod('GET', new apigateway.LambdaIntegration(adminUsersDetailFn), authMethodOptions)

    // /admin/users/{userId}/role
    const adminUserRoleResource = adminUserByIdResource.addResource('role')
    adminUserRoleResource.addMethod('PUT', new apigateway.LambdaIntegration(adminUsersRoleFn), authMethodOptions)

    // /admin/users/{userId}/plan
    const adminUserPlanResource = adminUserByIdResource.addResource('plan')
    adminUserPlanResource.addMethod('PUT', new apigateway.LambdaIntegration(adminUsersRoleFn), authMethodOptions)

    // /admin/users/{userId}/activity
    const adminUserActivityResource = adminUserByIdResource.addResource('activity')
    adminUserActivityResource.addMethod('GET', new apigateway.LambdaIntegration(adminUsersActivityFn), authMethodOptions)

    // /admin/users/{userId}/memory
    const adminUserMemoryResource = adminUserByIdResource.addResource('memory')
    adminUserMemoryResource.addMethod('GET', new apigateway.LambdaIntegration(adminUsersMemoryFn), authMethodOptions)
    adminUserMemoryResource.addMethod('DELETE', new apigateway.LambdaIntegration(adminUsersMemoryFn), authMethodOptions)

    // ── Admin Models Lambda 関数 ──
    const adminModelsPrepareFn = new lambdaNode.NodejsFunction(this, 'AdminModelsPrepareFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'models', 'prepare.ts'),
    })
    adminModelsPrepareFn.addEnvironment('MODELS_BUCKET', modelsBucket.bucketName)

    const adminModelsFinalizeFn = new lambdaNode.NodejsFunction(this, 'AdminModelsFinalizeFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'models', 'finalize.ts'),
      timeout: cdk.Duration.seconds(30),
    })
    adminModelsFinalizeFn.addEnvironment('MODELS_BUCKET', modelsBucket.bucketName)

    const adminModelsListFn = new lambdaNode.NodejsFunction(this, 'AdminModelsListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'models', 'list.ts'),
    })

    const adminModelsUpdateFn = new lambdaNode.NodejsFunction(this, 'AdminModelsUpdateFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'models', 'update.ts'),
    })

    const adminModelsAvatarUploadFn = new lambdaNode.NodejsFunction(this, 'AdminModelsAvatarUploadFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'models', 'avatarUpload.ts'),
    })
    adminModelsAvatarUploadFn.addEnvironment('MODELS_BUCKET', modelsBucket.bucketName)
    adminModelsAvatarUploadFn.addEnvironment('MODELS_CDN_BASE', modelsCdnBase)

    const adminModelsDeleteFn = new lambdaNode.NodejsFunction(this, 'AdminModelsDeleteFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'admin', 'models', 'delete.ts'),
    })
    adminModelsDeleteFn.addEnvironment('MODELS_BUCKET', modelsBucket.bucketName)

    // Models — DynamoDB 権限
    table.grantReadData(adminModelsPrepareFn)
    table.grantReadWriteData(adminModelsFinalizeFn)
    table.grantReadData(adminModelsListFn)
    table.grantReadWriteData(adminModelsUpdateFn)
    table.grantReadWriteData(adminModelsAvatarUploadFn)
    table.grantReadWriteData(adminModelsDeleteFn)

    // Models — S3 権限
    modelsBucket.grantPut(adminModelsPrepareFn)
    modelsBucket.grantRead(adminModelsFinalizeFn)
    modelsBucket.grantRead(adminModelsListFn)
    modelsBucket.grantPut(adminModelsAvatarUploadFn)
    modelsBucket.grantReadWrite(adminModelsDeleteFn)

    // ユーザー向けモデル一覧 Lambda
    const modelsListFn = new lambdaNode.NodejsFunction(this, 'ModelsListFn', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '..', 'lambda', 'models', 'list.ts'),
    })
    modelsListFn.addEnvironment('MODELS_CDN_BASE', modelsCdnBase)
    table.grantReadData(modelsListFn)

    // /admin/models API ルート
    const adminModelsResource = adminResource.addResource('models')
    adminModelsResource.addMethod('GET', new apigateway.LambdaIntegration(adminModelsListFn), authMethodOptions)
    adminModelsResource.addMethod('POST', new apigateway.LambdaIntegration(adminModelsPrepareFn), authMethodOptions)

    // /admin/models/{modelId}
    const adminModelByIdResource = adminModelsResource.addResource('{modelId}')
    adminModelByIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(adminModelsUpdateFn), authMethodOptions)
    adminModelByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(adminModelsDeleteFn), authMethodOptions)

    // /admin/models/{modelId}/finalize
    const adminModelFinalizeResource = adminModelByIdResource.addResource('finalize')
    adminModelFinalizeResource.addMethod('POST', new apigateway.LambdaIntegration(adminModelsFinalizeFn), authMethodOptions)

    // /admin/models/{modelId}/avatar
    const adminModelAvatarResource = adminModelByIdResource.addResource('avatar')
    adminModelAvatarResource.addMethod('POST', new apigateway.LambdaIntegration(adminModelsAvatarUploadFn), authMethodOptions)

    // /models（ユーザー向け）
    const modelsResource = api.root.addResource('models')
    modelsResource.addMethod('GET', new apigateway.LambdaIntegration(modelsListFn), authMethodOptions)
  }
}
