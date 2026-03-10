/**
 * Google Tasks のフォーマット・変換処理（純粋関数、AWS SDK 依存なし）
 *
 * テスト容易性のため API 呼び出しロジック (googleTasks.ts) から分離。
 */

/**
 * Google Tasks API のタスクアイテム型
 */
export interface TaskItem {
  id?: string
  title?: string
  notes?: string
  due?: string
  status?: string
  completed?: string
}

/**
 * タスク一覧をフォーマットされた文字列に変換
 */
export function formatTaskList(items: TaskItem[]): string {
  if (items.length === 0) {
    return 'ToDo はありません。'
  }

  const taskList = items.map((item) => {
    const status = item.status === 'completed' ? '✅' : '⬜'
    let line = `${status} ${item.title ?? '（タイトルなし）'}`
    if (item.due) {
      line += ` [期限: ${item.due.slice(0, 10)}]`
    }
    if (item.notes) {
      line += ` — ${item.notes}`
    }
    line += ` (ID: ${item.id})`
    return line
  }).join('\n')

  return `ToDo 一覧:\n${taskList}`
}

/**
 * タスク作成のリクエストボディを構築
 */
export function buildCreateTaskBody(input: {
  title: string
  notes?: string
  due?: string
}): Record<string, unknown> {
  const task: Record<string, unknown> = { title: input.title }
  if (input.notes) task.notes = input.notes
  if (input.due) {
    // Google Tasks API は日付のみ対応（時刻は無視される）
    task.due = input.due.includes('T') ? input.due : `${input.due}T00:00:00.000Z`
  }
  return task
}

/**
 * タスク作成結果をフォーマット
 */
export function formatCreatedTask(created: { id?: string; title?: string; due?: string }): string {
  let result = `ToDo を作成しました: 「${created.title}」`
  if (created.due) {
    result += ` [期限: ${created.due.slice(0, 10)}]`
  }
  result += ` (ID: ${created.id})`
  return result
}

/**
 * タスク完了結果をフォーマット
 */
export function formatCompletedTask(updated: { id?: string; title?: string }): string {
  return `ToDo を完了にしました: 「${updated.title}」 (ID: ${updated.id})`
}

/**
 * listTasks の URLSearchParams を構築
 * ※ dueMin/dueMax はAPI側のフィルタが不安定なため使用せず、コード側でフィルタリング
 */
export function buildListTasksParams(input: {
  showCompleted?: boolean
  maxResults?: number
}): URLSearchParams {
  const { showCompleted = false, maxResults = 100 } = input
  return new URLSearchParams({
    maxResults: String(maxResults),
    showCompleted: String(showCompleted),
    showHidden: 'false',
  })
}

/**
 * タスクを日付範囲でフィルタリング（Google Tasks API の dueMin/dueMax が不安定なため代替）
 */
export function filterTasksByDate(items: TaskItem[], dueMin?: string, dueMax?: string): TaskItem[] {
  if (!dueMin && !dueMax) return items

  const minTime = dueMin ? new Date(dueMin).getTime() : -Infinity
  const maxTime = dueMax ? new Date(dueMax).getTime() : Infinity

  return items.filter((item) => {
    if (!item.due) return false
    const dueTime = new Date(item.due).getTime()
    return dueTime >= minTime && dueTime <= maxTime
  })
}
