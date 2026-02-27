import { DynamoDBClient, PutItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
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
 * POST /messages — メッセージを保存（単体 or バッチ対応）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const body = JSON.parse(event.body)
    const messages: MessageInput[] = Array.isArray(body) ? body : [body]

    if (messages.length === 0) {
      return response(400, { error: 'At least one message is required' })
    }

    if (messages.length === 1) {
      // 単体保存
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
      // バッチ保存（25件ずつ分割）
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

/**
 * 配列を指定サイズごとに分割
 */
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
