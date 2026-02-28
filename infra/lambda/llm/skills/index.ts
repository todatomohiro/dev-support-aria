import type { ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime'
import { listEvents, createEvent } from './googleCalendar'

/**
 * ツール名に基づいてスキルを実行し、toolResult を返す
 */
export async function executeSkill(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId: string,
  userId: string
): Promise<ToolResultContentBlock> {
  try {
    let resultText: string

    switch (toolName) {
      case 'list_events':
        resultText = await listEvents(userId, input)
        break
      case 'create_event':
        resultText = await createEvent(userId, input)
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
