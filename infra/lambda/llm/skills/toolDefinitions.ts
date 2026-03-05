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
  {
    toolSpec: {
      name: 'web_search',
      description: 'インターネットで情報を検索します。ユーザーが「〜について調べて」「〜の最新情報」などと聞いた場合に使用してください。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '検索クエリ',
            },
          },
          required: ['query'],
        },
      },
    },
  },
]

/**
 * メモ機能のツール定義（有効時のみ TOOL_DEFINITIONS に追加）
 */
export const MEMO_TOOL_DEFINITIONS: Tool[] = [
  {
    toolSpec: {
      name: 'save_memo',
      description: 'ユーザーが「これメモして」「覚えておいて」「メモに保存して」と言った場合に使用します。会話の内容やユーザーが指定した内容をメモとして保存します。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'メモのタイトル（50文字以内）',
            },
            content: {
              type: 'string',
              description: 'メモの内容（500文字以内）',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'タグ（最大10個、各20文字以内）',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'search_memos',
      description: 'ユーザーが「メモを探して」「〜のメモある？」と聞いた場合に使用します。キーワードでメモを検索します。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '検索キーワード',
            },
          },
          required: ['query'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'list_memos',
      description: 'ユーザーが「メモ一覧を見せて」「最近のメモは？」と聞いた場合に使用します。メモの一覧を取得します。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: '取得件数（デフォルト: 10）',
            },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'delete_memo',
      description: 'ユーザーが「メモを消して」「このメモ削除して」と言った場合に使用します。指定されたメモを削除します。必ずユーザーに確認してから実行してください。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            memoId: {
              type: 'string',
              description: '削除するメモのID',
            },
          },
          required: ['memoId'],
        },
      },
    },
  },
]
