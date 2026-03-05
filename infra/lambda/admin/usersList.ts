import { DynamoDBClient, BatchGetItemCommand } from '@aws-sdk/client-dynamodb'
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const dynamo = new DynamoDBClient({})
const cognito = new CognitoIdentityProviderClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const USER_POOL_ID = process.env.USER_POOL_ID!

/**
 * GET /admin/users — ユーザー一覧（Cognito ListUsers + DynamoDB ROLE BatchGet）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  try {
    const paginationToken = event.queryStringParameters?.token
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 20, 60)

    // Cognito からユーザー一覧取得
    const cognitoResult = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: limit,
      PaginationToken: paginationToken || undefined,
    }))

    const users = cognitoResult.Users ?? []
    if (users.length === 0) {
      return response(200, { users: [], nextToken: null })
    }

    // DynamoDB から ROLE を一括取得
    const keys = users.map(u => {
      const sub = u.Attributes?.find(a => a.Name === 'sub')?.Value
      return {
        PK: { S: `USER#${sub}` },
        SK: { S: 'ROLE' },
      }
    })

    const roleMap = new Map<string, string>()
    const batchResult = await dynamo.send(new BatchGetItemCommand({
      RequestItems: {
        [TABLE_NAME]: { Keys: keys },
      },
    }))

    for (const item of batchResult.Responses?.[TABLE_NAME] ?? []) {
      const record = unmarshall(item)
      const userId = (record.PK as string).replace('USER#', '')
      roleMap.set(userId, record.role)
    }

    // レスポンス構築
    const result = users.map(u => {
      const sub = u.Attributes?.find(a => a.Name === 'sub')?.Value ?? ''
      const email = u.Attributes?.find(a => a.Name === 'email')?.Value ?? ''
      return {
        userId: sub,
        email,
        status: u.UserStatus ?? 'UNKNOWN',
        enabled: u.Enabled ?? false,
        role: roleMap.get(sub) ?? 'user',
        createdAt: u.UserCreateDate?.toISOString() ?? '',
      }
    })

    return response(200, {
      users: result,
      nextToken: cognitoResult.PaginationToken ?? null,
    })
  } catch (error) {
    console.error('ユーザー一覧取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
