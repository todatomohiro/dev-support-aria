import type { Tool } from '@aws-sdk/client-bedrock-runtime'

/**
 * Google OAuth 依存ツール（カレンダー・タスク）
 * OAuth 未接続ユーザーには注入しない
 */
export const GOOGLE_TOOL_DEFINITIONS: Tool[] = [
  {
    toolSpec: {
      name: 'list_events',
      description: '指定期間のGoogle カレンダー予定を取得。',
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
      description: 'Google カレンダーに新しい予定を作成。必ずユーザーに内容を確認してから実行。',
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
      name: 'list_tasks',
      description: 'Google ToDo リストからタスクを取得。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            dueMin: {
              type: 'string',
              description: '期限の開始日時（RFC 3339 形式、例: 2026-03-10T00:00:00Z）。省略時はすべての未完了タスクを取得',
            },
            dueMax: {
              type: 'string',
              description: '期限の終了日時（RFC 3339 形式）。省略時は制限なし',
            },
            showCompleted: {
              type: 'boolean',
              description: '完了済みタスクも含めるか（デフォルト: false）',
            },
            maxResults: {
              type: 'number',
              description: '取得する最大件数（デフォルト: 20）',
            },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'create_task',
      description: 'Google ToDo リストに新しいタスクを作成。必ずユーザーに内容を確認してから実行。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'タスクのタイトル',
            },
            notes: {
              type: 'string',
              description: 'タスクの詳細メモ（任意）',
            },
            due: {
              type: 'string',
              description: '期限日（ISO 8601 日付形式、例: 2026-03-15）',
            },
          },
          required: ['title'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'complete_task',
      description: 'Google ToDo リストのタスクを完了にする。事前に list_tasks でID確認必須。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: '完了にするタスクのID（list_tasks で取得したID）',
            },
          },
          required: ['taskId'],
        },
      },
    },
  },
]

/**
 * 基本ツール（OAuth 不要）
 */
export const BASE_TOOL_DEFINITIONS: Tool[] = [
  {
    toolSpec: {
      name: 'search_places',
      description: '場所やお店を検索。locationBias で検索中心座標を指定可能。',
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
      description: 'インターネットで情報を検索。',
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
  {
    toolSpec: {
      name: 'get_weather',
      description: '指定座標の天気予報を取得。地域指定がなければ現在地を使用。1回の呼び出しで1地域のみ。',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: '緯度（ユーザーが地域を指定した場合はその地域の緯度を推測して入力。指定がない場合は現在地を使用）',
            },
            longitude: {
              type: 'number',
              description: '経度（ユーザーが地域を指定した場合はその地域の経度を推測して入力。指定がない場合は現在地を使用）',
            },
          },
        },
      },
    },
  },
]

/** 後方互換: 全ツール定義（既存コードが参照している場合向け） */
export const TOOL_DEFINITIONS: Tool[] = [...GOOGLE_TOOL_DEFINITIONS, ...BASE_TOOL_DEFINITIONS]

/**
 * メモ機能のツール定義（有効時のみ TOOL_DEFINITIONS に追加）
 */
export const MEMO_TOOL_DEFINITIONS: Tool[] = [
  {
    toolSpec: {
      name: 'save_memo',
      description: '会話の内容やユーザーが指定した内容をメモとして保存。',
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
      description: 'キーワードでメモを検索。',
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
      description: 'メモの一覧を取得。',
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
      description: '指定されたメモを削除。必ずユーザーに確認してから実行。',
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
