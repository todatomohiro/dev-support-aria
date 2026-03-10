import { getGoogleTokens } from './tokenManager'
import { formatTaskList, buildCreateTaskBody, formatCreatedTask, formatCompletedTask, buildListTasksParams, filterTasksByDate } from './googleTasksFormatter'

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1'

/**
 * Google Tasks からタスク一覧を取得
 */
export async function listTasks(
  userId: string,
  input: Record<string, unknown>
): Promise<string> {
  const tokens = await getGoogleTokens(userId)
  if (!tokens) {
    return 'Google アカウントが連携されていません。設定画面から Google アカウントを連携してください。'
  }

  const { dueMin, dueMax, showCompleted, maxResults } = input as {
    dueMin?: string
    dueMax?: string
    showCompleted?: boolean
    maxResults?: number
  }

  const params = buildListTasksParams({ showCompleted, maxResults })
  const url = `${TASKS_API_BASE}/lists/@default/tasks?${params}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })

  if (!res.ok) {
    const errorBody = await res.text()
    console.error('[GoogleTasks] タスク取得エラー:', errorBody)
    throw new Error('ToDo リストを取得できませんでした')
  }

  const data = await res.json() as { items?: Array<{ id?: string; title?: string; notes?: string; due?: string; status?: string; completed?: string }> }
  const filtered = filterTasksByDate(data.items ?? [], dueMin, dueMax)
  return formatTaskList(filtered)
}

/**
 * Google Tasks に新しいタスクを作成
 */
export async function createTask(
  userId: string,
  input: Record<string, unknown>
): Promise<string> {
  const tokens = await getGoogleTokens(userId)
  if (!tokens) {
    return 'Google アカウントが連携されていません。設定画面から Google アカウントを連携してください。'
  }

  const { title, notes, due } = input as { title: string; notes?: string; due?: string }
  const task = buildCreateTaskBody({ title, notes, due })

  console.log('[GoogleTasks] Creating task:', JSON.stringify(task))

  const res = await fetch(`${TASKS_API_BASE}/lists/@default/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(task),
  })

  const responseBody = await res.text()
  console.log(`[GoogleTasks] Response status: ${res.status}, body: ${responseBody}`)

  if (!res.ok) {
    console.error('[GoogleTasks] タスク作成エラー:', responseBody)
    throw new Error(`ToDo を作成できませんでした: ${responseBody}`)
  }

  const created = JSON.parse(responseBody) as { id?: string; title?: string; due?: string }
  return formatCreatedTask(created)
}

/**
 * Google Tasks のタスクを完了にする
 */
export async function completeTask(
  userId: string,
  input: Record<string, unknown>
): Promise<string> {
  const tokens = await getGoogleTokens(userId)
  if (!tokens) {
    return 'Google アカウントが連携されていません。設定画面から Google アカウントを連携してください。'
  }

  const { taskId } = input as { taskId: string }
  if (!taskId) {
    return 'タスクIDが指定されていません'
  }

  const res = await fetch(`${TASKS_API_BASE}/lists/@default/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'completed' }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    console.error('[GoogleTasks] タスク完了エラー:', errorBody)
    throw new Error(`ToDo を完了にできませんでした: ${errorBody}`)
  }

  const updated = await res.json() as { title?: string; id?: string }
  return formatCompletedTask(updated)
}
