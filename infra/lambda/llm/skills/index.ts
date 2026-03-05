import type { ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime'
import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as crypto from 'crypto'
import { listEvents, createEvent } from './googleCalendar'
import { searchPlaces } from './places'
import { webSearch } from './webSearch'
import { callMCPTool } from '../../mcp/mcpClient'

const memoDynamo = new DynamoDBClient({})
const MEMO_TABLE_NAME = process.env.TABLE_NAME ?? ''

/** MCP接続情報（chat.ts から渡される） */
interface MCPConnectionInfo {
  serverUrl: string
  expiresAt: string
  isExpired: boolean
}

/**
 * ツール名に基づいてスキルを実行し、toolResult を返す
 */
export async function executeSkill(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId: string,
  userId: string,
  mcpConnection?: MCPConnectionInfo,
  userLocation?: { lat: number; lng: number }
): Promise<ToolResultContentBlock> {
  try {
    let resultText: string

    // MCP ツール（mcp_ プレフィックス）の場合は外部サーバーに委譲
    if (toolName.startsWith('mcp_')) {
      if (!mcpConnection) {
        return {
          toolUseId,
          content: [{ text: 'ワーク接続が見つかりません' }],
          status: 'error',
        }
      }
      if (mcpConnection.isExpired) {
        return {
          toolUseId,
          content: [{ text: 'ワーク機能の有効期限が切れています。新しいワーク接続を作成してください。' }],
          status: 'error',
        }
      }

      const mcpToolName = toolName.slice(4) // "mcp_" プレフィックスを除去
      console.log(`[Skill] MCP ツール実行: ${mcpToolName} → ${mcpConnection.serverUrl}`)
      resultText = await callMCPTool(mcpConnection.serverUrl, mcpToolName, input)

      return {
        toolUseId,
        content: [{ text: resultText }],
        status: 'success',
      }
    }

    switch (toolName) {
      case 'list_events':
        resultText = await listEvents(userId, input)
        break
      case 'create_event':
        resultText = await createEvent(userId, input)
        break
      case 'search_places': {
        // LLM が locationBias を指定していなければ userLocation を自動注入
        const placesInput = { ...input }
        if (!placesInput.locationBias && userLocation) {
          placesInput.locationBias = userLocation
        }
        resultText = await searchPlaces(placesInput)
        break
      }
      case 'web_search':
        resultText = await webSearch(input)
        break
      case 'save_memo':
        resultText = await saveMemo(userId, input)
        break
      case 'search_memos':
        resultText = await searchMemos(userId, input)
        break
      case 'list_memos':
        resultText = await listMemos(userId, input)
        break
      case 'delete_memo':
        resultText = await deleteMemo(userId, input)
        break
      default:
        return {
          toolUseId,
          content: [{ text: `不明なツール: ${toolName}` }],
          status: 'error',
        }
    }

    return {
      toolUseId,
      content: [{ text: resultText }],
      status: 'success',
    }
  } catch (error) {
    console.error(`[Skill] ツール実行エラー (${toolName}):`, error)
    const errorMessage = error instanceof Error ? error.message : 'ツール実行中にエラーが発生しました'
    return {
      toolUseId,
      content: [{ text: errorMessage }],
      status: 'error',
    }
  }
}

/**
 * メモを保存（チャット経由 Tool Use）
 */
async function saveMemo(userId: string, input: Record<string, unknown>): Promise<string> {
  const title = typeof input.title === 'string' ? input.title.slice(0, 50) : ''
  const content = typeof input.content === 'string' ? input.content.slice(0, 500) : ''
  const tags = Array.isArray(input.tags) ? input.tags.slice(0, 10).map((t: unknown) => String(t).slice(0, 20)) : []

  if (!title || !content) {
    return 'タイトルと内容は必須です'
  }

  const memoId = crypto.randomUUID()
  const now = new Date().toISOString()

  await memoDynamo.send(new PutItemCommand({
    TableName: MEMO_TABLE_NAME,
    Item: marshall({
      PK: `USER#${userId}`,
      SK: `MEMO#${memoId}`,
      memoId,
      title,
      content,
      tags,
      source: 'chat',
      createdAt: now,
      updatedAt: now,
    }),
  }))

  return JSON.stringify({ success: true, memoId, title })
}

/**
 * メモを検索
 */
async function searchMemos(userId: string, input: Record<string, unknown>): Promise<string> {
  const query = typeof input.query === 'string' ? input.query.toLowerCase() : ''

  const result = await memoDynamo.send(new QueryCommand({
    TableName: MEMO_TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}` },
      ':skPrefix': { S: 'MEMO#' },
    },
    ScanIndexForward: false,
  }))

  let memos = (result.Items ?? []).map((item) => {
    const m = unmarshall(item)
    return { memoId: m.memoId, title: m.title, content: m.content, tags: m.tags ?? [], createdAt: m.createdAt }
  })

  if (query) {
    memos = memos.filter((m) =>
      m.title.toLowerCase().includes(query) ||
      m.content.toLowerCase().includes(query) ||
      m.tags.some((t: string) => t.toLowerCase().includes(query))
    )
  }

  memos.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return JSON.stringify({ memos: memos.slice(0, 10), total: memos.length })
}

/**
 * メモ一覧を取得
 */
async function listMemos(userId: string, input: Record<string, unknown>): Promise<string> {
  const limit = typeof input.limit === 'number' ? Math.min(input.limit, 20) : 10

  const result = await memoDynamo.send(new QueryCommand({
    TableName: MEMO_TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}` },
      ':skPrefix': { S: 'MEMO#' },
    },
    ScanIndexForward: false,
  }))

  const memos = (result.Items ?? []).map((item) => {
    const m = unmarshall(item)
    return { memoId: m.memoId, title: m.title, content: m.content, tags: m.tags ?? [], createdAt: m.createdAt }
  })

  memos.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return JSON.stringify({ memos: memos.slice(0, limit), total: memos.length })
}

/**
 * メモを削除
 */
async function deleteMemo(userId: string, input: Record<string, unknown>): Promise<string> {
  const memoId = typeof input.memoId === 'string' ? input.memoId : ''
  if (!memoId) {
    return 'memoId は必須です'
  }

  await memoDynamo.send(new DeleteItemCommand({
    TableName: MEMO_TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: `MEMO#${memoId}` },
    },
  }))

  return JSON.stringify({ success: true, deleted: true })
}
