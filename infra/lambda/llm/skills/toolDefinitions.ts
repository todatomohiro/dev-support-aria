import type { Tool } from '@aws-sdk/client-bedrock-runtime'

/**
 * Converse API に渡すツール定義
 */
export const TOOL_DEFINITIONS: Tool[] = [
  {
    toolSpec: {
      name: 'list_events',
      description: 'Google カレンダーから指定期間の予定を取得します。ユーザーが「今日の予定」「明日のスケジュール」などと聞いた場合に使用してください。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            timeMin: {
              type: 'string',
              description: '取得開始日時（ISO 8601 形式、例: 2026-02-28T00:00:00+09:00）',
            },
            timeMax: {
              type: 'string',
              description: '取得終了日時（ISO 8601 形式、例: 2026-02-28T23:59:59+09:00）',
            },
            maxResults: {
              type: 'number',
              description: '取得する最大件数（デフォルト: 10）',
            },
          },
          required: ['timeMin', 'timeMax'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'create_event',
      description: 'Google カレンダーに新しい予定を作成します。ユーザーが予定の詳細（タイトル、日時）を確認した後に使用してください。確認なしに勝手に予定を作成しないでください。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: '予定のタイトル',
            },
            startDateTime: {
              type: 'string',
              description: '開始日時（ISO 8601 形式、例: 2026-02-28T14:00:00+09:00）',
            },
            endDateTime: {
              type: 'string',
              description: '終了日時（ISO 8601 形式、例: 2026-02-28T15:00:00+09:00）',
            },
            description: {
              type: 'string',
              description: '予定の説明（任意）',
            },
            location: {
              type: 'string',
              description: '場所（任意）',
            },
          },
          required: ['summary', 'startDateTime', 'endDateTime'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'search_places',
      description: '場所やお店を検索します。ユーザーが「近くのカフェ」「渋谷のレストラン」などと聞いた場合に使用してください。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '検索クエリ（例: 渋谷 カフェ）',
            },
            locationBias: {
              type: 'object',
              description: '検索の中心座標（任意）',
              properties: {
                lat: { type: 'number' },
                lng: { type: 'number' },
              },
            },
          },
          required: ['query'],
        },
      },
    },
  },
]
