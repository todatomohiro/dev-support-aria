/**
 * アクティビティパターン分析ロジックのテスト
 *
 * バックエンド Lambda（infra/lambda/users/activityPattern.ts）の
 * 純粋関数（extractSessionStarts, analyzePattern）をテストする。
 */
import { describe, it, expect } from 'vitest'
import { extractSessionStarts, analyzePattern } from '../../../../infra/lambda/users/activityPatternAnalyzer'

describe('extractSessionStarts', () => {
  it('最初のアクティビティをセッション開始として検出する', () => {
    const starts = extractSessionStarts('2026-03-09', [
      '2026-03-09T09:00',
      '2026-03-09T09:01',
      '2026-03-09T09:02',
    ])
    expect(starts).toHaveLength(1)
    expect(starts[0].time).toBe('09:00')
    expect(starts[0].dayOfWeek).toBe(1) // 月曜
  })

  it('30分以上のギャップ後の活動を新セッションとして検出する', () => {
    const starts = extractSessionStarts('2026-03-09', [
      '2026-03-09T09:00',
      '2026-03-09T09:15',
      '2026-03-09T09:30',
      // 31分ギャップ
      '2026-03-09T10:01',
      '2026-03-09T10:02',
    ])
    expect(starts).toHaveLength(2)
    expect(starts[0].time).toBe('09:00')
    expect(starts[1].time).toBe('10:01')
  })

  it('複数のセッションを正しく検出する', () => {
    const starts = extractSessionStarts('2026-03-09', [
      '2026-03-09T08:50',
      '2026-03-09T09:00',
      '2026-03-09T09:10',
      // 昼休み
      '2026-03-09T13:30',
      '2026-03-09T13:45',
      // 夜
      '2026-03-09T20:00',
    ])
    expect(starts).toHaveLength(3)
    expect(starts[0].time).toBe('08:50')
    expect(starts[1].time).toBe('13:30')
    expect(starts[2].time).toBe('20:00')
  })

  it('29分のギャップはセッション区切りとしない', () => {
    const starts = extractSessionStarts('2026-03-09', [
      '2026-03-09T09:00',
      '2026-03-09T09:29', // 29分ギャップ
    ])
    expect(starts).toHaveLength(1)
  })

  it('ちょうど30分のギャップはセッション区切りとする', () => {
    const starts = extractSessionStarts('2026-03-09', [
      '2026-03-09T09:00',
      '2026-03-09T09:30', // ちょうど30分
    ])
    expect(starts).toHaveLength(2)
  })

  it('空の配列は空を返す', () => {
    expect(extractSessionStarts('2026-03-09', [])).toHaveLength(0)
  })

  it('曜日を正しく設定する（日曜）', () => {
    const starts = extractSessionStarts('2026-03-08', ['2026-03-08T10:00'])
    expect(starts[0].dayOfWeek).toBe(0) // 日曜
  })

  it('曜日を正しく設定する（土曜）', () => {
    const starts = extractSessionStarts('2026-03-14', ['2026-03-14T10:00'])
    expect(starts[0].dayOfWeek).toBe(6) // 土曜
  })
})

describe('analyzePattern', () => {
  it('出現率が30%以上のパターンをウィンドウとして返す', () => {
    // 10日分のデータで、9:05開始が8回 → 80%（ビン化で09:00）
    const starts = Array.from({ length: 8 }, () => ({
      time: '09:05',
      dayOfWeek: 1,
    }))

    const windows = analyzePattern(starts, 10)
    expect(windows).toHaveLength(1)
    expect(windows[0].to).toBe('09:00')
    expect(windows[0].confidence).toBe(0.8)
  })

  it('ウィンドウの from は to の30分前', () => {
    const starts = Array.from({ length: 5 }, () => ({
      time: '13:10',
      dayOfWeek: 1,
    }))

    const windows = analyzePattern(starts, 10)
    expect(windows).toHaveLength(1)
    expect(windows[0].to).toBe('13:00')
    expect(windows[0].from).toBe('12:30')
  })

  it('出現率が30%未満のパターンは除外する', () => {
    // 10日分のデータで、9:00開始が2回 → 20% < 30%
    const starts = [
      { time: '09:00', dayOfWeek: 1 },
      { time: '09:05', dayOfWeek: 2 },
    ]

    const windows = analyzePattern(starts, 10)
    expect(windows).toHaveLength(0)
  })

  it('複数のウィンドウを時刻順で返す', () => {
    const starts = [
      // 13:00台 × 4
      ...Array.from({ length: 4 }, () => ({ time: '13:10', dayOfWeek: 1 })),
      // 09:00台 × 5
      ...Array.from({ length: 5 }, () => ({ time: '09:05', dayOfWeek: 1 })),
      // 20:00台 × 3
      ...Array.from({ length: 3 }, () => ({ time: '20:02', dayOfWeek: 1 })),
    ]

    const windows = analyzePattern(starts, 10)
    expect(windows.length).toBeGreaterThanOrEqual(2)
    // 時刻順で並ぶ
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i - 1].from <= windows[i].from).toBe(true)
    }
  })

  it('日数が0の場合は空を返す', () => {
    expect(analyzePattern([], 0)).toHaveLength(0)
  })

  it('セッション開始がない場合は空を返す', () => {
    expect(analyzePattern([], 10)).toHaveLength(0)
  })

  it('ウィンドウの from は0分未満にならない', () => {
    const starts = Array.from({ length: 5 }, () => ({
      time: '00:10',
      dayOfWeek: 1,
    }))

    const windows = analyzePattern(starts, 10)
    expect(windows).toHaveLength(1)
    expect(windows[0].from).toBe('00:00')
  })
})
