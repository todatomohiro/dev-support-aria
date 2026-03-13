/**
 * アクティビティパターン分析ロジック（純粋関数）
 *
 * Lambda ハンドラーとフロントエンドテストの両方から利用される。
 * AWS SDK 等の外部依存なし。
 */

/** セッション区切りとみなすギャップ（分） */
const SESSION_GAP_MINUTES = 30

/** ブリーフィングウィンドウのビン前オフセット（分） */
const WINDOW_PRE_MINUTES = 60

/** ブリーフィングウィンドウのビン後オフセット（分） */
const WINDOW_POST_MINUTES = 60

/** パターンとして採用する最低出現率（0〜1） */
const MIN_PATTERN_RATIO = 0.15

/** パターンとして採用する最低出現回数（少数データでの過検出防止） */
const MIN_PATTERN_COUNT = 2

/** セッション開始時刻をビン化する粒度（分） */
const BIN_SIZE_MINUTES = 30

/** morning 〜 afternoon のオフセット（分） */
const AFTERNOON_OFFSET_MINUTES = 240

/** afternoon ウィンドウの後方幅（分） */
const AFTERNOON_TAIL_MINUTES = 120

/** night ウィンドウのビン前オフセット（分） */
const NIGHT_PRE_MINUTES = 60

/** 睡眠ギャップと見なす最小時間（分） */
const MIN_SLEEP_GAP_MINUTES = 120

/**
 * セッション開始時刻を表す型
 */
export interface SessionStart {
  /** "HH:mm" 形式 */
  time: string
  /** 0=日曜, 1=月曜, ..., 6=土曜 */
  dayOfWeek: number
  /** 日付 "YYYY-MM-DD"（recomputeConfidence でユニーク日数カウントに使用） */
  date?: string
}

/**
 * ブリーフィングウィンドウを表す型
 */
export interface BriefingWindow {
  /** ウィンドウ開始 "HH:mm" */
  from: string
  /** ウィンドウ終了（セッション開始時刻） "HH:mm" */
  to: string
  /** このウィンドウの信頼度（出現率 0〜1） */
  confidence: number
  /** フェーズ名（morning / afternoon / night / midday_support / evening_support） */
  phase?: string
  /** main or support */
  phaseType?: 'main' | 'support'
}

/**
 * 1日分のアクティビティからセッション開始時刻を抽出
 *
 * SESSION_GAP_MINUTES 以上の空白の後に活動がある場合、その活動開始をセッション開始とみなす。
 * 当日最初の活動も常にセッション開始。
 */
export function extractSessionStarts(date: string, sortedMinutes: string[]): SessionStart[] {
  if (sortedMinutes.length === 0) return []

  const dayOfWeek = new Date(date).getDay()
  const starts: SessionStart[] = []

  // 最初の活動は常にセッション開始
  const firstTime = sortedMinutes[0].slice(11, 16) // "HH:mm"
  starts.push({ time: firstTime, dayOfWeek, date })

  // 以降、前の活動からのギャップを検出
  for (let i = 1; i < sortedMinutes.length; i++) {
    const prevMinutes = timeToMinutes(sortedMinutes[i - 1].slice(11, 16))
    const currMinutes = timeToMinutes(sortedMinutes[i].slice(11, 16))
    const gap = currMinutes - prevMinutes

    if (gap >= SESSION_GAP_MINUTES) {
      starts.push({ time: sortedMinutes[i].slice(11, 16), dayOfWeek, date })
    }
  }

  return starts
}

/**
 * セッション開始時刻群からブリーフィングウィンドウを算出（morning 基準アルゴリズム）
 *
 * 1. ビン間の最長ギャップ（睡眠期間）を検出
 * 2. morning = ギャップ直後6h以内の最頻ビン
 * 3. late_night = ギャップ直前3h以内の最頻ビン
 * 4. afternoon = morning + 4h（固定オフセット）
 * 5. midday_support = morning〜afternoon 間にセッション15%以上
 * 6. evening_support = afternoon〜late_night 間にセッション15%以上
 */
export function analyzePattern(
  starts: SessionStart[],
  totalDays: number,
): BriefingWindow[] {
  if (totalDays === 0 || starts.length === 0) return []

  // ビン化: 各時刻を BIN_SIZE_MINUTES 区切りに丸める
  const bins = new Map<string, number>()
  for (const s of starts) {
    const binned = binTime(s.time)
    bins.set(binned, (bins.get(binned) ?? 0) + 1)
  }

  // 睡眠ギャップを検出して morning/late_night の探索範囲を決定
  const gap = findSleepGap(bins)
  if (!gap) return []

  // 1. morning: ギャップ直後〜+6h の最頻ビン
  const morningBin = findPeakBin(bins, gap.wakeUpMin, gap.wakeUpMin + 360)
  if (!morningBin || !meetsThreshold(morningBin.count, totalDays)) {
    return []
  }

  const morningMin = timeToMinutes(morningBin.bin)
  const windows: BriefingWindow[] = []

  // morning ウィンドウ（ビン ± 1h = 2h 幅）
  windows.push({
    from: minutesToTime(Math.max(0, morningMin - WINDOW_PRE_MINUTES)),
    to: minutesToTime(Math.min(1440, morningMin + WINDOW_POST_MINUTES)),
    confidence: roundConfidence(morningBin.count, totalDays),
    phase: 'morning',
    phaseType: 'main',
  })

  // 2. night: ギャップ直前3h以内の最頻ビン（ウィンドウはビン前3h + ビン後1h = 4h幅）
  const lateNightBin = findPeakBin(bins, gap.sleepMin - 180, gap.sleepMin)
  let lateNightMin: number | null = null
  if (lateNightBin && meetsThreshold(lateNightBin.count, totalDays)) {
    lateNightMin = timeToMinutes(lateNightBin.bin)
    windows.push({
      from: minutesToTime(((lateNightMin - NIGHT_PRE_MINUTES) % 1440 + 1440) % 1440),
      to: minutesToTime(((lateNightMin + WINDOW_POST_MINUTES) % 1440 + 1440) % 1440),
      confidence: roundConfidence(lateNightBin.count, totalDays),
      phase: 'night',
      phaseType: 'main',
    })
  }

  // 3. afternoon = morning + 4h（独自幅: center - PRE 〜 center + TAIL）
  const afternoonCenter = morningMin + AFTERNOON_OFFSET_MINUTES
  const afternoonFrom = Math.max(0, afternoonCenter - WINDOW_PRE_MINUTES)
  const afternoonTo = Math.min(1440, afternoonCenter + AFTERNOON_TAIL_MINUTES)

  const afternoonCount = countSessionsInRange(bins, afternoonFrom, afternoonTo)
  windows.push({
    from: minutesToTime(afternoonFrom),
    to: minutesToTime(afternoonTo),
    confidence: afternoonCount > 0
      ? roundConfidence(afternoonCount, totalDays)
      : roundConfidence(morningBin.count, totalDays),
    phase: 'afternoon',
    phaseType: 'main',
  })

  // 4. midday_support: morning〜afternoon の間にセッション15%以上（morning ウィンドウ後から）
  const middayStart = morningMin + WINDOW_POST_MINUTES
  if (afternoonFrom > middayStart) {
    const middayBin = findPeakBin(bins, middayStart, afternoonFrom)
    if (middayBin && meetsThreshold(middayBin.count, totalDays)) {
      const middayMin = timeToMinutes(middayBin.bin)
      windows.push({
        from: minutesToTime(Math.max(0, middayMin - WINDOW_PRE_MINUTES)),
        to: minutesToTime(Math.min(1440, middayMin + WINDOW_POST_MINUTES)),
        confidence: roundConfidence(middayBin.count, totalDays),
        phase: 'midday_support',
        phaseType: 'support',
      })
    }
  }

  // 5. evening_support: afternoon〜late_night の間にセッション15%以上
  if (lateNightMin !== null) {
    const eveningEnd = Math.max(0, lateNightMin - NIGHT_PRE_MINUTES)
    if (eveningEnd > afternoonTo) {
      const eveningBin = findPeakBin(bins, afternoonTo, eveningEnd)
      if (eveningBin && meetsThreshold(eveningBin.count, totalDays)) {
        const eveningMin = timeToMinutes(eveningBin.bin)
        windows.push({
          from: minutesToTime(Math.max(0, eveningMin - WINDOW_PRE_MINUTES)),
          to: minutesToTime(Math.min(1440, eveningMin + WINDOW_POST_MINUTES)),
          confidence: roundConfidence(eveningBin.count, totalDays),
          phase: 'evening_support',
          phaseType: 'support',
        })
      }
    }
  }

  // 時刻順でソート
  windows.sort((a, b) => timeToMinutes(a.from) - timeToMinutes(b.from))

  return windows
}

/**
 * ビン間の最長ギャップ（睡眠期間）を検出
 *
 * 全ビンを時刻順にソートし、円環上の最長ギャップを探す。
 * ギャップ直後 = 起床時刻（morning 探索開始）、ギャップ直前 = 就寝時刻（late_night 探索終了）。
 */
function findSleepGap(bins: Map<string, number>): { wakeUpMin: number; sleepMin: number } | null {
  const sortedMinutes = [...bins.keys()]
    .map((b) => timeToMinutes(b))
    .sort((a, b) => a - b)

  if (sortedMinutes.length < 2) return null

  let maxGap = 0
  let gapAfterIdx = 0

  for (let i = 0; i < sortedMinutes.length; i++) {
    const nextIdx = (i + 1) % sortedMinutes.length
    const current = sortedMinutes[i]
    const next = sortedMinutes[nextIdx]
    const gap = nextIdx === 0 ? 1440 - current + next : next - current

    if (gap > maxGap) {
      maxGap = gap
      gapAfterIdx = nextIdx
    }
  }

  if (maxGap < MIN_SLEEP_GAP_MINUTES) return null

  const gapBeforeIdx = (gapAfterIdx - 1 + sortedMinutes.length) % sortedMinutes.length

  return {
    wakeUpMin: sortedMinutes[gapAfterIdx],
    sleepMin: sortedMinutes[gapBeforeIdx] + BIN_SIZE_MINUTES,
  }
}

/**
 * 指定範囲内で最頻ビンを検出
 *
 * fromMin > toMin の場合は日跨ぎ（円環）として扱う。
 */
function findPeakBin(
  bins: Map<string, number>,
  fromMin: number,
  toMin: number,
): { bin: string; count: number } | null {
  const from = ((fromMin % 1440) + 1440) % 1440
  const to = ((toMin % 1440) + 1440) % 1440

  let best: { bin: string; count: number } | null = null
  for (const [bin, count] of bins) {
    const m = timeToMinutes(bin)
    const inRange = from <= to
      ? m >= from && m < to
      : m >= from || m < to
    if (inRange && (!best || count > best.count)) {
      best = { bin, count }
    }
  }
  return best
}

/**
 * 指定範囲内のセッション合計数を返す
 */
function countSessionsInRange(bins: Map<string, number>, fromMin: number, toMin: number): number {
  let total = 0
  for (const [bin, count] of bins) {
    const m = timeToMinutes(bin)
    if (m >= fromMin && m < toMin) {
      total += count
    }
  }
  return total
}

/** 最低出現回数 + 最低出現率を満たすか判定 */
function meetsThreshold(count: number, totalDays: number): boolean {
  return count >= MIN_PATTERN_COUNT && count / totalDays >= MIN_PATTERN_RATIO
}

/** confidence を小数第2位に丸める */
function roundConfidence(count: number, totalDays: number): number {
  return Math.round((count / totalDays) * 100) / 100
}

/**
 * "HH:mm" → 0時からの分数
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * 0時からの分数 → "HH:mm"
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * 時刻を BIN_SIZE_MINUTES 粒度にビン化（切り捨て）
 */
function binTime(time: string): string {
  const total = timeToMinutes(time)
  const binned = Math.floor(total / BIN_SIZE_MINUTES) * BIN_SIZE_MINUTES
  return minutesToTime(binned)
}

/**
 * ベースウィンドウ（位置）に対して、特定曜日のセッションデータから confidence を再計算
 *
 * ウィンドウ位置は全日統合で決定し、confidence のみ曜日別に算出する
 * ハイブリッド方式で使用する。
 */
export function recomputeConfidence(
  baseWindows: BriefingWindow[],
  dayStarts: SessionStart[],
  dayCount: number,
): BriefingWindow[] {
  if (dayCount === 0) return baseWindows.map((w) => ({ ...w, confidence: 0 }))

  return baseWindows.map((w) => {
    const fromMin = timeToMinutes(w.from)
    const toMin = timeToMinutes(w.to)
    // ウィンドウ内にセッションがあったユニーク日数をカウント
    const datesInWindow = new Set<string>()
    for (const s of dayStarts) {
      const m = timeToMinutes(binTime(s.time))
      const inRange = fromMin <= toMin
        ? m >= fromMin && m < toMin
        : m >= fromMin || m < toMin
      if (inRange) {
        datesInWindow.add(s.date ?? 'unknown')
      }
    }
    return { ...w, confidence: roundConfidence(datesInWindow.size, dayCount) }
  })
}
