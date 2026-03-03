import type { ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime'
import { listEvents, createEvent } from './googleCalendar'
import { searchPlaces } from './places'
import { webSearch } from './webSearch'
import { callMCPTool } from '../../mcp/mcpClient'

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
  mcpConnection?: MCPConnectionInfo
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
      case 'search_places':
        resultText = await searchPlaces(input)
        break
      case 'web_search':
        resultText = await webSearch(input)
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
