import { DynamoDBClient, GetItemCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /groups/{id}/members — グループメンバー一覧を取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const groupId = event.pathParameters?.id
  if (!groupId) {
    return response(400, { error: 'groupId is required' })
  }

  try {
    // 自分がメンバーか確認
    const membership = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${groupId}` }),
    }))
    if (!membership.Item) {
      return response(403, { error: 'このグループへのアクセス権がありません' })
    }

    // META から参加者リストを取得
    const metaResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `CONV#${groupId}`, SK: 'META' }),
    }))
    if (!metaResult.Item) {
      return response(404, { error: 'グループが見つかりません' })
    }
    const meta = unmarshall(metaResult.Item)
    const participants: string[] = meta.participants

    // 各メンバーの SETTINGS からニックネームを取得（BatchGetItem）
    const keys = participants.map((pid) => marshall({ PK: `USER#${pid}`, SK: 'SETTINGS' }))

    // BatchGetItem は最大100件まで
    const batchResult = await client.send(new BatchGetItemCommand({
      RequestItems: {
        [TABLE_NAME]: { Keys: keys },
      },
    }))

    const settingsMap = new Map<string, string>()
    for (const item of batchResult.Responses?.[TABLE_NAME] ?? []) {
      const record = unmarshall(item)
      const pid = (record.PK as string).replace('USER#', '')
      const nickname = (record.data?.profile?.nickname as string) || 'ユーザー'
      settingsMap.set(pid, nickname)
    }

    const members = participants.map((pid) => ({
      userId: pid,
      nickname: settingsMap.get(pid) ?? 'ユーザー',
    }))

    return response(200, { members, groupName: meta.groupName })
  } catch (error) {
    console.error('メンバー一覧取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  }
}
