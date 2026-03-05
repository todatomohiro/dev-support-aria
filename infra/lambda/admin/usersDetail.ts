import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const dynamo = new DynamoDBClient({})
const cognito = new CognitoIdentityProviderClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const USER_POOL_ID = process.env.USER_POOL_ID!

/**
 * GET /admin/users/{userId} — ユーザー詳細（Cognito + DynamoDB）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  try {
    // Cognito ユーザー情報取得（sub で検索）
    const cognitoResult = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${targetUserId}"`,
      Limit: 1,
    }))

    const cognitoUser = cognitoResult.Users?.[0]
    if (!cognitoUser) {
      return response(404, { error: 'User not found' })
    }

    // DynamoDB から並列取得: ROLE + テーマ数 + 設定有無
    const [roleResult, themesResult, settingsResult] = await Promise.all([
      dynamo.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${targetUserId}` },
          SK: { S: 'ROLE' },
        },
      })),
      dynamo.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${targetUserId}` },
          ':sk': { S: 'THEME_SESSION#' },
        },
        Select: 'COUNT',
      })),
      dynamo.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${targetUserId}` },
          SK: { S: 'SETTINGS' },
        },
        ProjectionExpression: 'PK',
      })),
    ])

    const role = roleResult.Item ? unmarshall(roleResult.Item).role : 'user'
    const email = cognitoUser.Attributes?.find(a => a.Name === 'email')?.Value ?? ''

    return response(200, {
      user: {
        userId: targetUserId,
        email,
        status: cognitoUser.UserStatus ?? 'UNKNOWN',
        enabled: cognitoUser.Enabled ?? false,
        role,
        createdAt: cognitoUser.UserCreateDate?.toISOString() ?? '',
        themeCount: themesResult.Count ?? 0,
        hasSettings: !!settingsResult.Item,
      },
    })
  } catch (error) {
    console.error('ユーザー詳細取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
