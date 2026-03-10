/**
 * Google Tasks フォーマッターのユニットテスト
 *
 * 純粋関数のみテスト（AWS SDK 依存なし）
 */
import { describe, it, expect } from 'vitest'
import {
  formatTaskList,
  buildCreateTaskBody,
  formatCreatedTask,
  formatCompletedTask,
  buildListTasksParams,
  filterTasksByDate,
} from '../../../../infra/lambda/llm/skills/googleTasksFormatter'
import type { TaskItem } from '../../../../infra/lambda/llm/skills/googleTasksFormatter'

describe('GoogleTasks フォーマッター', () => {
  describe('formatTaskList', () => {
    it('空配列の場合「ToDoはありません」を返す', () => {
      expect(formatTaskList([])).toBe('ToDo はありません。')
    })

    it('未完了タスクを⬜で表示する', () => {
      const items: TaskItem[] = [
        { id: 'task1', title: 'レポート作成', status: 'needsAction' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('⬜ レポート作成')
    })

    it('完了タスクを✅で表示する', () => {
      const items: TaskItem[] = [
        { id: 'task1', title: '完了タスク', status: 'completed' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('✅ 完了タスク')
    })

    it('期限がある場合に日付を表示する', () => {
      const items: TaskItem[] = [
        { id: 'task1', title: 'レポート', due: '2026-03-15T00:00:00.000Z', status: 'needsAction' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('[期限: 2026-03-15]')
    })

    it('メモがある場合に表示する', () => {
      const items: TaskItem[] = [
        { id: 'task1', title: '買い物', status: 'needsAction', notes: '牛乳と卵' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('— 牛乳と卵')
    })

    it('タスクIDを表示する', () => {
      const items: TaskItem[] = [
        { id: 'abc123', title: 'テスト', status: 'needsAction' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('(ID: abc123)')
    })

    it('タイトルなしの場合にデフォルト表示する', () => {
      const items: TaskItem[] = [
        { id: 'task1', status: 'needsAction' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('（タイトルなし）')
    })

    it('複数タスクを正しくフォーマットする', () => {
      const items: TaskItem[] = [
        { id: 'task1', title: 'レポート作成', due: '2026-03-15T00:00:00.000Z', status: 'needsAction' },
        { id: 'task2', title: '買い物', status: 'needsAction', notes: '牛乳と卵' },
        { id: 'task3', title: '完了タスク', status: 'completed' },
      ]
      const result = formatTaskList(items)
      expect(result).toContain('ToDo 一覧:')
      expect(result).toContain('⬜ レポート作成 [期限: 2026-03-15]')
      expect(result).toContain('⬜ 買い物')
      expect(result).toContain('✅ 完了タスク')
      // 改行で区切られている
      expect(result.split('\n').length).toBe(4) // ヘッダー + 3タスク
    })

    it('ヘッダー行が含まれる', () => {
      const items: TaskItem[] = [{ id: 'task1', title: 'テスト', status: 'needsAction' }]
      const result = formatTaskList(items)
      expect(result.startsWith('ToDo 一覧:')).toBe(true)
    })
  })

  describe('buildCreateTaskBody', () => {
    it('タイトルのみでボディを構築する', () => {
      const body = buildCreateTaskBody({ title: 'テストタスク' })
      expect(body).toEqual({ title: 'テストタスク' })
    })

    it('メモ付きでボディを構築する', () => {
      const body = buildCreateTaskBody({ title: '買い物', notes: '牛乳と卵' })
      expect(body).toEqual({ title: '買い物', notes: '牛乳と卵' })
    })

    it('日付のみの期限をISO形式に変換する', () => {
      const body = buildCreateTaskBody({ title: 'テスト', due: '2026-03-15' })
      expect(body.due).toBe('2026-03-15T00:00:00.000Z')
    })

    it('ISO形式の期限はそのまま保持する', () => {
      const body = buildCreateTaskBody({ title: 'テスト', due: '2026-03-15T10:00:00+09:00' })
      expect(body.due).toBe('2026-03-15T10:00:00+09:00')
    })

    it('メモが空文字の場合は含めない', () => {
      const body = buildCreateTaskBody({ title: 'テスト', notes: '' })
      expect(body.notes).toBeUndefined()
    })

    it('期限が空文字の場合は含めない', () => {
      const body = buildCreateTaskBody({ title: 'テスト', due: '' })
      expect(body.due).toBeUndefined()
    })
  })

  describe('formatCreatedTask', () => {
    it('タイトルとIDを含む作成結果を返す', () => {
      const result = formatCreatedTask({ id: 'new1', title: 'テストタスク' })
      expect(result).toContain('ToDo を作成しました')
      expect(result).toContain('テストタスク')
      expect(result).toContain('(ID: new1)')
    })

    it('期限付きの場合に期限を表示する', () => {
      const result = formatCreatedTask({ id: 'new2', title: 'レポート', due: '2026-03-15T00:00:00.000Z' })
      expect(result).toContain('[期限: 2026-03-15]')
    })

    it('期限なしの場合は期限を表示しない', () => {
      const result = formatCreatedTask({ id: 'new3', title: 'テスト' })
      expect(result).not.toContain('期限')
    })
  })

  describe('formatCompletedTask', () => {
    it('完了結果を正しくフォーマットする', () => {
      const result = formatCompletedTask({ id: 'task1', title: 'レポート作成' })
      expect(result).toContain('ToDo を完了にしました')
      expect(result).toContain('レポート作成')
      expect(result).toContain('(ID: task1)')
    })
  })

  describe('buildListTasksParams', () => {
    it('デフォルトパラメータを生成する', () => {
      const params = buildListTasksParams({})
      expect(params.get('maxResults')).toBe('100')
      expect(params.get('showCompleted')).toBe('false')
      expect(params.get('showHidden')).toBe('false')
    })

    it('showCompleted を true にできる', () => {
      const params = buildListTasksParams({ showCompleted: true })
      expect(params.get('showCompleted')).toBe('true')
    })

    it('maxResults をカスタマイズできる', () => {
      const params = buildListTasksParams({ maxResults: 5 })
      expect(params.get('maxResults')).toBe('5')
    })
  })

  describe('filterTasksByDate', () => {
    const tasks: TaskItem[] = [
      { id: '1', title: '昨日', due: '2026-03-10T00:00:00.000Z', status: 'needsAction' },
      { id: '2', title: '今日', due: '2026-03-11T00:00:00.000Z', status: 'needsAction' },
      { id: '3', title: '明日', due: '2026-03-12T00:00:00.000Z', status: 'needsAction' },
      { id: '4', title: '期限なし', status: 'needsAction' },
    ]

    it('フィルタなしの場合は全タスクを返す', () => {
      expect(filterTasksByDate(tasks)).toHaveLength(4)
    })

    it('dueMin のみ指定で該当タスクを返す', () => {
      const result = filterTasksByDate(tasks, '2026-03-11T00:00:00Z')
      expect(result.map(t => t.id)).toEqual(['2', '3'])
    })

    it('dueMax のみ指定で該当タスクを返す', () => {
      const result = filterTasksByDate(tasks, undefined, '2026-03-11T00:00:00Z')
      expect(result.map(t => t.id)).toEqual(['1', '2'])
    })

    it('dueMin と dueMax の範囲で該当タスクを返す', () => {
      const result = filterTasksByDate(tasks, '2026-03-11T00:00:00Z', '2026-03-11T23:59:59Z')
      expect(result.map(t => t.id)).toEqual(['2'])
    })

    it('期限なしのタスクはフィルタ時に除外される', () => {
      const result = filterTasksByDate(tasks, '2026-03-10T00:00:00Z', '2026-03-12T23:59:59Z')
      expect(result.map(t => t.id)).toEqual(['1', '2', '3'])
    })
  })
})
