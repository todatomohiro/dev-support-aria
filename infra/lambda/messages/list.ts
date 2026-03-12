import { DynamoDBClient, QueryCommand, PutItemCommand, BatchWriteItemCommand, type QueryCommandInput } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

interface MessageInput {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  motion?: string
}

/**
 * GET /messages — メッセージ一覧を取得
 * POST /messages — メッセージを保存
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (event.httpMethod === 'POST') {
    return handlePut(userId, event.body)
  }
  return handleList(userId, event)
}

/** GET /messages ハンドラー */
async function handleList(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit ?? '100', 10) || 100,
    500
  )
  const before = event.queryStringParameters?.before

  try {
    const queryInput: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':prefix': { S: 'MSG#' },
      },
      ScanIndexForward: false, // 新しい順
      Limit: limit,
    }

    // カーソルページネーション
    if (before) {
      queryInput.ExclusiveStartKey = marshall({
        PK: `USER#${userId}`,
        SK: before,
      })
    }

    const result = await client.send(new QueryCommand(queryInput))

    const messages = (result.Items ?? []).map((item) => {
      const record = unmarshall(item)
      return record.data
    })

    const responseBody: Record<string, unknown> = { messages }
    if (result.LastEvaluatedKey) {
      const lastKey = unmarshall(result.LastEvaluatedKey)
      responseBody.nextCursor = lastKey.SK
    }

    return response(200, responseBody)
  } catch (error) {
    console.error('メッセージ取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** POST /messages ハンドラー */
async function handlePut(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return response(400, { error: 'Request body is required' })
  }
  try {
    const parsed = JSON.parse(body)
    const messages: MessageInput[] = Array.isArray(parsed) ? parsed : [parsed]
    if (messages.length === 0) {
      return response(400, { error: 'At least one message is required' })
    }
    if (messages.length === 1) {
      const msg = messages[0]
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${userId}`,
          SK: `MSG#${String(msg.timestamp).padStart(15, '0')}#${msg.id}`,
          data: msg,
        }, { removeUndefinedValues: true }),
      }))
    } else {
      const chunks = chunkArray(messages, 25)
      for (const chunk of chunks) {
        await client.send(new BatchWriteItemCommand({
          RequestItems: {
            [TABLE_NAME]: chunk.map((msg) => ({
              PutRequest: {
                Item: marshall({
                  PK: `USER#${userId}`,
                  SK: `MSG#${String(msg.timestamp).padStart(15, '0')}#${msg.id}`,
                  data: msg,
                }, { removeUndefinedValues: true }),
              },
            })),
          },
        }))
      }
    }
    return response(200, { success: true, count: messages.length })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('メッセージ保存エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** 配列を指定サイズごとに分割 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
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
