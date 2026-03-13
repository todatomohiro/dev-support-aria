/**
 * アクティビティパターン分析ロジックのテスト
 *
 * バックエンド Lambda（infra/lambda/users/activityPatternAnalyzer.ts）の
 * 純粋関数（extractSessionStarts, analyzePattern）をテストする。
 */
import { describe, it, expect } from 'vitest'
import { extractSessionStarts, analyzePattern, recomputeConfidence } from '../../../../infra/lambda/users/activityPatternAnalyzer'

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

describe('analyzePattern（morning 基準 + 睡眠ギャップ検出）', () => {
  /**
   * テストデータ生成のポイント:
   *
   * 睡眠ギャップ検出は「ビン間の最長ギャップ」を探す。
   * 夜間（例: 23:00〜07:00 = 8h）が最長ギャップになるよう、
   * 日中に複数のビンを配置して日中ギャップを短くする必要がある。
   *
   * 典型例: bins=[08:00, 13:00, 22:00]
   *   08:00→13:00 = 5h, 13:00→22:00 = 9h, 22:30→08:00(翌日) = 9.5h
   *   → 最長ギャップ = 22:30→08:00 → wakeUp=08:00, sleep=22:30
   */

  /** 朝型ユーザーの基本データ: morning=08:00, 昼=13:00, 夜=22:00 */
  function morningUserStarts() {
    return [
      ...Array.from({ length: 8 }, () => ({ time: '08:05', dayOfWeek: 1 })),  // bin=08:00
      ...Array.from({ length: 3 }, () => ({ time: '13:05', dayOfWeek: 1 })),  // bin=13:00（日中活動）
      ...Array.from({ length: 4 }, () => ({ time: '22:10', dayOfWeek: 1 })),  // bin=22:00
    ]
  }

  it('morning=8:00 → morning ウィンドウ 07:00-09:00 + afternoon 11:00-14:00', () => {
    const starts = morningUserStarts()
    const windows = analyzePattern(starts, 10)
    expect(windows.length).toBeGreaterThanOrEqual(2)

    // morning: ビン08:00 ± 1h = 07:00-09:00
    const morning = windows.find(w => w.from === '07:00' && w.to === '09:00')
    expect(morning).toBeDefined()
    expect(morning!.confidence).toBe(0.8)

    // afternoon: center=12:00, from=11:00(-1h), to=14:00(+2h)
    const afternoon = windows.find(w => w.from === '11:00' && w.to === '14:00')
    expect(afternoon).toBeDefined()
  })

  it('睡眠ギャップが検出できない（ビンが1つのみ）場合は空を返す', () => {
    const starts = Array.from({ length: 5 }, () => ({
      time: '08:05',
      dayOfWeek: 1,
    }))
    const windows = analyzePattern(starts, 10)
    expect(windows).toHaveLength(0)
  })

  it('morning の出現率が15%未満なら空を返す', () => {
    // bins: 09:00(2回), 13:00(2回), 22:00(2回) → 各 2/20=10% < 15%
    const starts = [
      { time: '09:00', dayOfWeek: 1 },
      { time: '09:05', dayOfWeek: 2 },
      { time: '13:00', dayOfWeek: 1 },
      { time: '13:05', dayOfWeek: 2 },
      { time: '22:00', dayOfWeek: 1 },
      { time: '22:05', dayOfWeek: 2 },
    ]
    const windows = analyzePattern(starts, 20)
    expect(windows).toHaveLength(0)
  })

  it('morning の出現回数が2未満なら空を返す', () => {
    // bins: 09:00(1回), 22:00(1回), 14:00(1回)
    // 睡眠ギャップ: 22:30→09:00(10.5h) → morning search: 09:00→15:00
    // morning候補: 09:00(1回) and 14:00(1回) → どちらも1回 < 2回
    const starts = [
      { time: '09:05', dayOfWeek: 1 },
      { time: '14:05', dayOfWeek: 2 },
      { time: '22:05', dayOfWeek: 3 },
    ]
    const windows = analyzePattern(starts, 5)
    expect(windows).toHaveLength(0)
  })

  it('late_night が検出される（睡眠ギャップ直前の最頻ビン）', () => {
    const starts = morningUserStarts()
    const windows = analyzePattern(starts, 10)

    // night: ビン22:00 ± 1h → 21:00-23:00
    const lateNight = windows.find(w => w.from === '21:00' && w.to === '23:00')
    expect(lateNight).toBeDefined()
    expect(lateNight!.confidence).toBe(0.4)
  })

  it('midday_support: morning〜afternoon 間にセッション15%以上で配置', () => {
    // morning=08:00, midday=09:30, 昼=13:00, 夜=22:00
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '08:05', dayOfWeek: 1 })),  // bin=08:00
      ...Array.from({ length: 3 }, () => ({ time: '09:35', dayOfWeek: 1 })),  // bin=09:30（midday候補）
      ...Array.from({ length: 2 }, () => ({ time: '13:05', dayOfWeek: 1 })),  // bin=13:00（日中活動）
      ...Array.from({ length: 2 }, () => ({ time: '22:10', dayOfWeek: 1 })),  // bin=22:00
    ]
    const windows = analyzePattern(starts, 10)

    // midday: ビン09:30 ± 1h = 08:30-10:30
    const midday = windows.find(w => w.from === '08:30' && w.to === '10:30')
    expect(midday).toBeDefined()
    expect(midday!.confidence).toBe(0.3)
  })

  it('evening_support: afternoon〜late_night 間にセッション15%以上で配置', () => {
    // morning=08:00, 昼=13:00, evening=18:00, 夜=22:00
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '08:05', dayOfWeek: 1 })),  // bin=08:00
      ...Array.from({ length: 2 }, () => ({ time: '13:05', dayOfWeek: 1 })),  // bin=13:00
      ...Array.from({ length: 3 }, () => ({ time: '18:05', dayOfWeek: 1 })),  // bin=18:00（evening候補）
      ...Array.from({ length: 4 }, () => ({ time: '22:10', dayOfWeek: 1 })),  // bin=22:00
    ]
    const windows = analyzePattern(starts, 10)

    // evening: ビン18:00 ± 1h = 17:00-19:00
    const evening = windows.find(w => w.from === '17:00' && w.to === '19:00')
    expect(evening).toBeDefined()
    expect(evening!.confidence).toBe(0.3)
  })

  it('midday_support: 出現率15%未満のセッションは support にならない', () => {
    // morning=08:00, midday候補=09:30(1回のみ=10%), 昼=13:00, 夜=22:00
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '08:05', dayOfWeek: 1 })),
      { time: '09:35', dayOfWeek: 1 }, // 1回のみ → 10% < 15%
      ...Array.from({ length: 2 }, () => ({ time: '13:05', dayOfWeek: 1 })),
      ...Array.from({ length: 2 }, () => ({ time: '22:10', dayOfWeek: 1 })),
    ]
    const windows = analyzePattern(starts, 10)

    const midday = windows.find(w => w.from === '08:30' && w.to === '10:30')
    expect(midday).toBeUndefined()
  })

  it('ウィンドウが時刻順でソートされる', () => {
    const starts = morningUserStarts()
    const windows = analyzePattern(starts, 10)

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

  it('夜型ユーザー（4時就寝・11時起床）でも morning が正しく検出される', () => {
    // bins: 11:00(5回), 16:00(3回), 03:00(3回)
    // ギャップ: 03:30→11:00=7.5h, 11:00→16:00=5h, 16:00→03:00(翌日)=11h
    // 最長ギャップ: 16:00→03:00 (11h) → wakeUp=03:00? いや...
    // 16:30→03:00 = 10.5h → wakeUp=03:00, sleep=16:30
    // morning search: 03:00→09:00 → 該当ビンなし → 空を返す
    //
    // 正しくは: 03:30→11:00=7.5h が睡眠ギャップ
    // bins: 11:00(5回), 15:00(2回), 19:00(2回), 03:00(3回)
    // ギャップ: 03:30→11:00=7.5h, 11:00→15:00=4h, 15:00→19:00=4h, 19:00→03:00=8h
    // 最長: 19:00→03:00(8h)? → wakeUp=03:00
    // いや: 19:30→03:00=7.5h vs 03:30→11:00=7.5h... 同じ
    //
    // もっと現実的に: 夜型ユーザーは11時〜3時まで活動
    // bins: 11:00(5回), 14:00(3回), 18:00(3回), 22:00(3回), 02:00(3回)
    // ギャップ: 02:30→11:00=8.5h(最長=睡眠), 他は3-4h
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '11:05', dayOfWeek: 1 })),  // bin=11:00
      ...Array.from({ length: 3 }, () => ({ time: '14:05', dayOfWeek: 1 })),  // bin=14:00
      ...Array.from({ length: 3 }, () => ({ time: '18:05', dayOfWeek: 1 })),  // bin=18:00
      ...Array.from({ length: 3 }, () => ({ time: '22:05', dayOfWeek: 1 })),  // bin=22:00
      ...Array.from({ length: 3 }, () => ({ time: '02:05', dayOfWeek: 1 })),  // bin=02:00
    ]
    const windows = analyzePattern(starts, 10)

    // 睡眠ギャップ: 02:30→11:00(8.5h) → wakeUp=11:00
    // morning: ビン11:00 ± 1h = 10:00-12:00
    expect(windows.some(w => w.from === '10:00' && w.to === '12:00')).toBe(true)
    // afternoon: center=15:00, from=14:00(-1h), to=17:00(+2h)
    expect(windows.some(w => w.from === '14:00' && w.to === '17:00')).toBe(true)
  })

  it('afternoon の confidence はその範囲のセッション数に基づく', () => {
    // morning=08:00, afternoon範囲(11:00-14:00)内にbin=12:00(3回), 夕方=17:00, 夜=22:00
    // bins: 08:00(5), 12:00(3), 17:00(2), 22:00(2)
    // gaps: 08:00→12:00=4h, 12:00→17:00=5h, 17:00→22:00=5h, 22:30→08:00=9.5h(最長=睡眠)
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '08:05', dayOfWeek: 1 })),  // bin=08:00
      ...Array.from({ length: 3 }, () => ({ time: '12:05', dayOfWeek: 1 })),  // bin=12:00
      ...Array.from({ length: 2 }, () => ({ time: '17:05', dayOfWeek: 1 })),  // bin=17:00
      ...Array.from({ length: 2 }, () => ({ time: '22:10', dayOfWeek: 1 })),  // bin=22:00
    ]
    const windows = analyzePattern(starts, 10)

    const afternoon = windows.find(w => w.from === '11:00' && w.to === '14:00')
    expect(afternoon).toBeDefined()
    expect(afternoon!.confidence).toBe(0.3) // 3/10
  })

  it('afternoon 範囲にセッションがない場合は morning の confidence を継承', () => {
    // morning=08:00, 日中ビン=13:00(2回)（afternoonの外）, 夜=22:00
    // afternoon range: 11:00-14:00 → 13:00 は含まれるので避ける
    // 日中ビン=15:00 にする（afternoonの外）
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '08:05', dayOfWeek: 1 })),  // bin=08:00
      ...Array.from({ length: 2 }, () => ({ time: '15:05', dayOfWeek: 1 })),  // bin=15:00（afternoon外）
      ...Array.from({ length: 2 }, () => ({ time: '22:10', dayOfWeek: 1 })),  // bin=22:00
    ]
    const windows = analyzePattern(starts, 10)

    const afternoon = windows.find(w => w.from === '11:00' && w.to === '14:00')
    expect(afternoon).toBeDefined()
    expect(afternoon!.confidence).toBe(0.5) // morning の confidence を継承
  })

  it('BIN_SIZE=30 でビン化される', () => {
    const starts = [
      ...Array.from({ length: 5 }, () => ({ time: '09:25', dayOfWeek: 1 })),  // bin=09:00
      ...Array.from({ length: 2 }, () => ({ time: '14:05', dayOfWeek: 1 })),  // bin=14:00
      ...Array.from({ length: 2 }, () => ({ time: '22:10', dayOfWeek: 1 })),  // bin=22:00
    ]
    const windows = analyzePattern(starts, 10)

    // ビン09:00 ± 1h = 08:00-10:00
    const morning = windows.find(w => w.from === '08:00' && w.to === '10:00')
    expect(morning).toBeDefined()
  })

  it('睡眠ギャップが2時間未満の場合は空を返す', () => {
    // 全時間帯にビンがあるケース（ギャップ < 120分）
    const starts: { time: string; dayOfWeek: number }[] = []
    for (let h = 0; h < 24; h++) {
      starts.push(
        { time: `${String(h).padStart(2, '0')}:05`, dayOfWeek: 1 },
        { time: `${String(h).padStart(2, '0')}:05`, dayOfWeek: 2 },
      )
    }
    const windows = analyzePattern(starts, 10)
    expect(windows).toHaveLength(0)
  })
})

describe('recomputeConfidence（曜日別 confidence 再計算）', () => {
  /** 全日統合で算出した基本ウィンドウ */
  function getBaseWindows() {
    const allStarts = [
      ...Array.from({ length: 8 }, () => ({ time: '08:05', dayOfWeek: 1 })),
      ...Array.from({ length: 3 }, () => ({ time: '13:05', dayOfWeek: 1 })),
      ...Array.from({ length: 4 }, () => ({ time: '22:10', dayOfWeek: 1 })),
    ]
    return analyzePattern(allStarts, 10)
  }

  it('その曜日のセッションデータに基づいて confidence を再計算する', () => {
    const base = getBaseWindows()
    // 月曜: 2日分のデータ（4日中2日にmorningセッションあり）
    const mondayStarts = [
      { time: '08:05', dayOfWeek: 1, date: '2026-03-02' },
      { time: '08:15', dayOfWeek: 1, date: '2026-03-09' },
      { time: '22:10', dayOfWeek: 1, date: '2026-03-02' },
    ]
    const result = recomputeConfidence(base, mondayStarts, 4)

    // morning window (07:00-09:00): 2日にセッション → 2/4 = 0.5
    const morning = result.find(w => w.from === '07:00' && w.to === '09:00')
    expect(morning).toBeDefined()
    expect(morning!.confidence).toBe(0.5)

    // night window (21:00-23:00): 1日にセッション → 1/4 = 0.25
    const night = result.find(w => w.from === '21:00' && w.to === '23:00')
    expect(night).toBeDefined()
    expect(night!.confidence).toBe(0.25)
  })

  it('同一日に複数セッションがあっても confidence は100%を超えない', () => {
    const base = getBaseWindows()
    // 同じ月曜日に morning 帯で2回セッション開始
    const mondayStarts = [
      { time: '08:05', dayOfWeek: 1, date: '2026-03-02' },
      { time: '08:40', dayOfWeek: 1, date: '2026-03-02' },
    ]
    const result = recomputeConfidence(base, mondayStarts, 1)

    // 同一日なのでユニーク日数=1 → 1/1 = 1.0（100%）
    const morning = result.find(w => w.from === '07:00' && w.to === '09:00')
    expect(morning!.confidence).toBe(1)
  })

  it('セッションがないウィンドウの confidence は 0 になる', () => {
    const base = getBaseWindows()
    // 水曜: afternoon 帯のみセッションあり、morning/night はなし
    const wedStarts = [
      { time: '12:05', dayOfWeek: 3, date: '2026-03-04' },
      { time: '12:35', dayOfWeek: 3, date: '2026-03-11' },
    ]
    const result = recomputeConfidence(base, wedStarts, 4)

    const morning = result.find(w => w.from === '07:00' && w.to === '09:00')
    expect(morning!.confidence).toBe(0)

    const afternoon = result.find(w => w.from === '11:00' && w.to === '14:00')
    expect(afternoon!.confidence).toBe(0.5) // 2日/4日

    const night = result.find(w => w.from === '21:00' && w.to === '23:00')
    expect(night!.confidence).toBe(0)
  })

  it('dayCount が 0 の場合は全ウィンドウの confidence が 0', () => {
    const base = getBaseWindows()
    const result = recomputeConfidence(base, [], 0)
    result.forEach(w => expect(w.confidence).toBe(0))
  })

  it('曜日ごとに異なる confidence を返す', () => {
    const base = getBaseWindows()

    // 月曜: 3日分の morning セッション（4日中）
    const mon = recomputeConfidence(base, [
      { time: '08:05', dayOfWeek: 1, date: '2026-02-16' },
      { time: '08:15', dayOfWeek: 1, date: '2026-02-23' },
      { time: '08:25', dayOfWeek: 1, date: '2026-03-02' },
    ], 4)

    // 火曜: 1日分の morning セッション（4日中）
    const tue = recomputeConfidence(base, [
      { time: '08:05', dayOfWeek: 2, date: '2026-02-17' },
    ], 4)

    const monMorning = mon.find(w => w.from === '07:00')!.confidence
    const tueMorning = tue.find(w => w.from === '07:00')!.confidence

    expect(monMorning).toBe(0.75)  // 3/4
    expect(tueMorning).toBe(0.25)  // 1/4
    expect(monMorning).not.toBe(tueMorning)
  })

  it('ウィンドウ位置（from/to）は変更されない', () => {
    const base = getBaseWindows()
    const result = recomputeConfidence(base, [
      { time: '08:05', dayOfWeek: 1 },
    ], 4)

    expect(result.length).toBe(base.length)
    for (let i = 0; i < base.length; i++) {
      expect(result[i].from).toBe(base[i].from)
      expect(result[i].to).toBe(base[i].to)
    }
  })
})
