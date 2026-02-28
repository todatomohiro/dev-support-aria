import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** あいまいな文字（0/O/1/I/L）を除外した英数字 */
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

/**
 * ランダムなユーザーコードを生成
 */
function generateRandomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join('')
}

/**
 * ユーザーコードの一意性を GSI1 で確認
 */
async function isCodeUnique(code: string): Promise<boolean> {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: {
      ':pk': { S: `USER_CODE#${code}` },
      ':sk': { S: 'USER_CODE' },
    },
    Limit: 1,
  }))
  return (result.Items ?? []).length === 0
}

/**
 * POST /friends/code — ユーザーコードを生成（既存があればそれを返す）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    // 既存のコードがあればそれを返す
    const existing = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: 'USER_CODE' }),
    }))

    if (existing.Item) {
      const record = unmarshall(existing.Item)
      return response(200, { code: record.code })
    }

    // 一意なコードを生成（最大10回リトライ）
    let code = ''
    for (let i = 0; i < 10; i++) {
      const candidate = generateRandomCode()
      if (await isCodeUnique(candidate)) {
        code = candidate
        break
      }
    }

    if (!code) {
      return response(500, { error: 'ユーザーコードの生成に失敗しました' })
    }

    // 保存（永続的 — 使い切りでない）
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: 'USER_CODE',
        GSI1PK: `USER_CODE#${code}`,
        GSI1SK: 'USER_CODE',
        code,
        createdAt: Date.now(),
      }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }))

    return response(200, { code })
  } catch (error) {
    console.error('ユーザーコード生成エラー:', error)
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
