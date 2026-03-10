/**
 * アクティビティパターン分析ロジック（純粋関数）
 *
 * Lambda ハンドラーとフロントエンドテストの両方から利用される。
 * AWS SDK 等の外部依存なし。
 */

/** セッション区切りとみなすギャップ（分） */
const SESSION_GAP_MINUTES = 30

/** ブリーフィングウィンドウの先行時間（分） */
const WINDOW_LEAD_MINUTES = 30

/** パターンとして採用する最低出現率（0〜1） */
const MIN_PATTERN_RATIO = 0.3

/** セッション開始時刻をビン化する粒度（分） */
const BIN_SIZE_MINUTES = 15

/**
 * セッション開始時刻を表す型
 */
export interface SessionStart {
  /** "HH:mm" 形式 */
  time: string
  /** 0=日曜, 1=月曜, ..., 6=土曜 */
  dayOfWeek: number
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
  starts.push({ time: firstTime, dayOfWeek })

  // 以降、前の活動からのギャップを検出
  for (let i = 1; i < sortedMinutes.length; i++) {
    const prevMinutes = timeToMinutes(sortedMinutes[i - 1].slice(11, 16))
    const currMinutes = timeToMinutes(sortedMinutes[i].slice(11, 16))
    const gap = currMinutes - prevMinutes

    if (gap >= SESSION_GAP_MINUTES) {
      starts.push({ time: sortedMinutes[i].slice(11, 16), dayOfWeek })
    }
  }

  return starts
}

/**
 * セッション開始時刻群からブリーフィングウィンドウを算出
 *
 * 1. 時刻を BIN_SIZE_MINUTES 粒度でビン化
 * 2. 出現率が MIN_PATTERN_RATIO 以上のビンを採用
 * 3. 各ビンの WINDOW_LEAD_MINUTES 前からウィンドウを設定
 */
export function analyzePattern(starts: SessionStart[], totalDays: number): BriefingWindow[] {
  if (totalDays === 0 || starts.length === 0) return []

  // ビン化: 各時刻を BIN_SIZE_MINUTES 区切りに丸める
  const bins = new Map<string, number>()
  for (const s of starts) {
    const binned = binTime(s.time)
    bins.set(binned, (bins.get(binned) ?? 0) + 1)
  }

  // 出現率フィルタ
  const windows: BriefingWindow[] = []
  for (const [binned, count] of bins.entries()) {
    const confidence = count / totalDays
    if (confidence >= MIN_PATTERN_RATIO) {
      const binnedMinutes = timeToMinutes(binned)
      const fromMinutes = Math.max(0, binnedMinutes - WINDOW_LEAD_MINUTES)
      windows.push({
        from: minutesToTime(fromMinutes),
        to: binned,
        confidence: Math.round(confidence * 100) / 100,
      })
    }
  }

  // 時刻順でソート
  windows.sort((a, b) => timeToMinutes(a.from) - timeToMinutes(b.from))

  return windows
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
