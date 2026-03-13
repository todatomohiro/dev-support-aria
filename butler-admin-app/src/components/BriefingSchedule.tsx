import { useMemo } from 'react'
import type { DayActivity } from '@/components/UserActivityViewer'

// ── 型定義 ──

/** ブリーフィングウィンドウ */
interface BriefingWindow {
  from: string
  to: string
  confidence: number
  /** アルゴリズムが付与したフェーズ名（表示用） */
  phase?: string
  /** main or support */
  phaseType?: 'main' | 'support'
}

/** パターン分析結果（曜日別） */
interface ActivityPattern {
  dayWindows: Record<string, BriefingWindow[]>
  activeDays: number
  /** データ不足で全日統合にフォールバックしたか */
  isFallback: boolean
}

/** ブリーフィング発火記録 */
interface TriggeredWindow {
  windowFrom: string
  windowTo: string
  firedAt: string
}

/** 発火履歴レコード */
interface BriefingHistoryRecord {
  date: string
  triggeredWindows: TriggeredWindow[]
}

/** 曜日ラベル（0=日〜6=土） */
const DAY_LABELS: Record<string, string> = {
  '1': '月', '2': '火', '3': '水', '4': '木', '5': '金', '6': '土', '0': '日',
}

/** 表示順（月〜日） */
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0']

// ── 定数（バックエンドと同一） ──

/** セッション区切りの最小ギャップ（分） */
const SESSION_GAP_MINUTES = 30
/** ウィンドウのビン前オフセット（分） */
const WINDOW_PRE_MINUTES = 60
/** ウィンドウのビン後オフセット（分） */
const WINDOW_POST_MINUTES = 60
/** パターン採用の最低出現率 */
const MIN_PATTERN_RATIO = 0.15
/** パターン採用の最低出現回数 */
const MIN_PATTERN_COUNT = 2
/** 時刻ビン化の粒度（分） */
const BIN_SIZE_MINUTES = 30
/** morning〜afternoon オフセット（分） */
const AFTERNOON_OFFSET_MINUTES = 240
/** afternoon 後方幅（分） */
const AFTERNOON_TAIL_MINUTES = 120
/** night ウィンドウのビン前オフセット（分） */
const NIGHT_PRE_MINUTES = 60
/** 睡眠ギャップと見なす最小時間（分） */
const MIN_SLEEP_GAP_MINUTES = 120

// ── パターン分析（バックエンド activityPatternAnalyzer.ts のロジックをポート） ──

interface SessionStart {
  time: string // "HH:mm"
  dayOfWeek: number
  date?: string // "YYYY-MM-DD"
}

/** 日別アクティビティからセッション開始時刻を抽出 */
function extractSessionStarts(day: DayActivity): SessionStart[] {
  const sorted = [...day.minutes].sort()
  if (sorted.length === 0) return []

  const starts: SessionStart[] = []
  let prevMin = -999

  for (const ts of sorted) {
    const timeStr = ts.slice(11, 16) // "HH:mm"
    const totalMin = t2m(timeStr)

    if (totalMin - prevMin >= SESSION_GAP_MINUTES) {
      starts.push({ time: timeStr, dayOfWeek: day.dayOfWeek, date: day.date })
    }
    prevMin = totalMin
  }

  return starts
}

// ── ヘルパー ──

function findSleepGap(bins: Map<string, number>): { wakeUpMin: number; sleepMin: number } | null {
  const sortedMinutes = [...bins.keys()].map(b => t2m(b)).sort((a, b) => a - b)
  if (sortedMinutes.length < 2) return null

  let maxGap = 0
  let gapAfterIdx = 0
  for (let i = 0; i < sortedMinutes.length; i++) {
    const nextIdx = (i + 1) % sortedMinutes.length
    const current = sortedMinutes[i]!
    const next = sortedMinutes[nextIdx]!
    const gap = nextIdx === 0 ? 1440 - current + next : next - current
    if (gap > maxGap) {
      maxGap = gap
      gapAfterIdx = nextIdx
    }
  }
  if (maxGap < MIN_SLEEP_GAP_MINUTES) return null

  const gapBeforeIdx = (gapAfterIdx - 1 + sortedMinutes.length) % sortedMinutes.length
  return {
    wakeUpMin: sortedMinutes[gapAfterIdx]!,
    sleepMin: sortedMinutes[gapBeforeIdx]! + BIN_SIZE_MINUTES,
  }
}

function findPeakBin(bins: Map<string, number>, fromMin: number, toMin: number): { bin: string; count: number } | null {
  const from = ((fromMin % 1440) + 1440) % 1440
  const to = ((toMin % 1440) + 1440) % 1440
  let best: { bin: string; count: number } | null = null
  for (const [bin, count] of bins) {
    const m = t2m(bin)
    const inRange = from <= to ? m >= from && m < to : m >= from || m < to
    if (inRange && (!best || count > best.count)) best = { bin, count }
  }
  return best
}

function countSessionsInRange(bins: Map<string, number>, fromMin: number, toMin: number): number {
  let total = 0
  for (const [bin, count] of bins) {
    const m = t2m(bin)
    if (m >= fromMin && m < toMin) total += count
  }
  return total
}

function meetsThreshold(count: number, totalDays: number): boolean {
  return count >= MIN_PATTERN_COUNT && count / totalDays >= MIN_PATTERN_RATIO
}

function roundConfidence(count: number, totalDays: number): number {
  return Math.round((count / totalDays) * 100) / 100
}

/** セッション開始時刻群をパターン分析してウィンドウ生成（睡眠ギャップ基準） */
function analyzePattern(starts: SessionStart[], activeDays: number): BriefingWindow[] {
  if (activeDays === 0 || starts.length === 0) return []

  const bins = new Map<string, number>()
  for (const s of starts) {
    const totalMin = t2m(s.time)
    const binned = Math.floor(totalMin / BIN_SIZE_MINUTES) * BIN_SIZE_MINUTES
    const binH = Math.floor(binned / 60)
    const binM = binned % 60
    const key = `${String(binH).padStart(2, '0')}:${String(binM).padStart(2, '0')}`
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }

  const gap = findSleepGap(bins)
  if (!gap) return []

  const morningBin = findPeakBin(bins, gap.wakeUpMin, gap.wakeUpMin + 360)
  if (!morningBin || !meetsThreshold(morningBin.count, activeDays)) return []
  const morningMin = t2m(morningBin.bin)

  const windows: BriefingWindow[] = []
  windows.push({
    from: minutesToHM(Math.max(0, morningMin - WINDOW_PRE_MINUTES)),
    to: minutesToHM(Math.min(1440, morningMin + WINDOW_POST_MINUTES)),
    confidence: roundConfidence(morningBin.count, activeDays),
    phase: 'morning', phaseType: 'main',
  })

  const lateNightBin = findPeakBin(bins, gap.sleepMin - 180, gap.sleepMin)
  let lateNightMin: number | null = null
  if (lateNightBin && meetsThreshold(lateNightBin.count, activeDays)) {
    lateNightMin = t2m(lateNightBin.bin)
    windows.push({
      from: minutesToHM(((lateNightMin - NIGHT_PRE_MINUTES) % 1440 + 1440) % 1440),
      to: minutesToHM(((lateNightMin + WINDOW_POST_MINUTES) % 1440 + 1440) % 1440),
      confidence: roundConfidence(lateNightBin.count, activeDays),
      phase: 'night', phaseType: 'main',
    })
  }

  const afternoonCenter = morningMin + AFTERNOON_OFFSET_MINUTES
  const afternoonFrom = Math.max(0, afternoonCenter - WINDOW_PRE_MINUTES)
  const afternoonTo = Math.min(1440, afternoonCenter + AFTERNOON_TAIL_MINUTES)
  const afternoonCount = countSessionsInRange(bins, afternoonFrom, afternoonTo)
  windows.push({
    from: minutesToHM(afternoonFrom),
    to: minutesToHM(afternoonTo),
    confidence: afternoonCount > 0 ? roundConfidence(afternoonCount, activeDays) : roundConfidence(morningBin.count, activeDays),
    phase: 'afternoon', phaseType: 'main',
  })

  const middayStart = morningMin + WINDOW_POST_MINUTES
  if (afternoonFrom > middayStart) {
    const middayBin = findPeakBin(bins, middayStart, afternoonFrom)
    if (middayBin && meetsThreshold(middayBin.count, activeDays)) {
      const middayMin = t2m(middayBin.bin)
      windows.push({
        from: minutesToHM(Math.max(0, middayMin - WINDOW_PRE_MINUTES)),
        to: minutesToHM(Math.min(1440, middayMin + WINDOW_POST_MINUTES)),
        confidence: roundConfidence(middayBin.count, activeDays),
        phase: 'midday_support', phaseType: 'support',
      })
    }
  }

  if (lateNightMin !== null) {
    const eveningEnd = ((lateNightMin - NIGHT_PRE_MINUTES) % 1440 + 1440) % 1440
    if (eveningEnd > afternoonTo) {
      const eveningBin = findPeakBin(bins, afternoonTo, eveningEnd)
      if (eveningBin && meetsThreshold(eveningBin.count, activeDays)) {
        const eveningMin = t2m(eveningBin.bin)
        windows.push({
          from: minutesToHM(Math.max(0, eveningMin - WINDOW_PRE_MINUTES)),
          to: minutesToHM(Math.min(1440, eveningMin + WINDOW_POST_MINUTES)),
          confidence: roundConfidence(eveningBin.count, activeDays),
          phase: 'evening_support', phaseType: 'support',
        })
      }
    }
  }

  windows.sort((a, b) => t2m(a.from) - t2m(b.from))
  return windows
}

/**
 * ウィンドウ位置に対して、特定曜日のセッションデータから confidence を再計算
 */
function recomputeConfidence(
  baseWindows: BriefingWindow[],
  dayStarts: SessionStart[],
  dayCount: number,
): BriefingWindow[] {
  if (dayCount === 0) return baseWindows.map((w) => ({ ...w, confidence: 0 }))

  return baseWindows.map((w) => {
    const fromMin = t2m(w.from)
    const toMin = t2m(w.to)
    // ウィンドウ内にセッションがあったユニーク日数をカウント
    const datesInWindow = new Set<string>()
    for (const s of dayStarts) {
      const totalMin = t2m(s.time)
      const binned = Math.floor(totalMin / BIN_SIZE_MINUTES) * BIN_SIZE_MINUTES
      const m = binned
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

/**
 * DayActivity[] からパターンを算出
 *
 * 全日統合でウィンドウ位置を決定し、confidence は曜日別に個別算出する。
 */
function computePattern(data: DayActivity[]): ActivityPattern {
  // 全セッション開始時刻を抽出
  const allStarts: SessionStart[] = []
  for (const day of data) {
    allStarts.push(...extractSessionStarts(day))
  }
  const uniqueDates = new Set(data.map(d => d.date))
  const baseWindows = analyzePattern(allStarts, uniqueDates.size)

  if (baseWindows.length === 0) {
    return { dayWindows: {}, activeDays: data.length, isFallback: false }
  }

  // 曜日別にグループ化
  const byDay = new Map<number, { starts: SessionStart[]; dates: Set<string> }>()
  for (const day of data) {
    if (!byDay.has(day.dayOfWeek)) {
      byDay.set(day.dayOfWeek, { starts: [], dates: new Set() })
    }
    const group = byDay.get(day.dayOfWeek)!
    group.starts.push(...extractSessionStarts(day))
    group.dates.add(day.date)
  }

  // 各曜日でウィンドウ位置を共有しつつ confidence を個別算出
  const dayWindows: Record<string, BriefingWindow[]> = {}
  for (let dow = 0; dow < 7; dow++) {
    const group = byDay.get(dow)
    const dayStarts = group?.starts ?? []
    const dayCount = group?.dates.size ?? 0
    dayWindows[String(dow)] = recomputeConfidence(baseWindows, dayStarts, dayCount)
  }

  return { dayWindows, activeDays: data.length, isFallback: false }
}

// ── 配信率の算出 ──

/** 曜日×ウィンドウの配信率 */
interface DeliveryRate {
  firedDays: number
  totalDays: number
  rate: number
}

/**
 * 発火履歴からウィンドウ別の配信率を算出
 *
 * 配信率 = そのウィンドウで発火した日数 / その曜日の出現日数（分析期間内）
 */
function computeDeliveryRates(
  briefingHistory: BriefingHistoryRecord[],
  data: DayActivity[],
): Map<string, DeliveryRate> {
  // 曜日ごとの日数をカウント
  const dayCountByDow = new Map<number, number>()
  for (const day of data) {
    dayCountByDow.set(day.dayOfWeek, (dayCountByDow.get(day.dayOfWeek) ?? 0) + 1)
  }

  // 曜日×ウィンドウごとの発火日数をカウント
  // キー: "dow:windowFrom" (例: "1:07:00")
  const firedByKey = new Map<string, Set<string>>()
  for (const record of briefingHistory) {
    const dow = new Date(record.date).getDay()
    for (const tw of record.triggeredWindows) {
      const key = `${dow}:${tw.windowFrom}`
      if (!firedByKey.has(key)) firedByKey.set(key, new Set())
      firedByKey.get(key)!.add(record.date)
    }
  }

  const rates = new Map<string, DeliveryRate>()
  for (const [key, dates] of firedByKey) {
    const dow = parseInt(key.split(':')[0] ?? '0', 10)
    const totalDays = dayCountByDow.get(dow) ?? 0
    const firedDays = dates.size
    rates.set(key, {
      firedDays,
      totalDays,
      rate: totalDays > 0 ? firedDays / totalDays : 0,
    })
  }
  return rates
}

// ── 描画ヘルパー ──

/** "HH:mm" → [hours, minutes] を安全にパース */
function parseHM(t: string): [number, number] {
  const parts = t.split(':').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0]
}

function t2m(t: string) {
  const [h, m] = parseHM(t)
  return h * 60 + m
}

function minutesToHM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 分→タイムライン上の %位置（0-24時 = 0-100%） */
function pct(minutes: number) {
  return (minutes / 1440) * 100
}

interface BlockDef {
  from: string
  to: string
  phase: string
  type: 'main' | 'support'
  label: string
  confidence: number | null
  deliveryRate?: DeliveryRate
}

/** ウィンドウ→ブロック定義に変換（アルゴリズムが付与したフェーズ名を使用） */
function windowsToBlocks(windows: BriefingWindow[], dow: string, deliveryRates?: Map<string, DeliveryRate>): BlockDef[] {
  return windows.map(w => {
    const phase = w.phase ?? '?'
    const type = w.phaseType ?? 'main'
    const rateKey = `${dow}:${w.from}`
    return {
      from: w.from,
      to: w.to,
      phase,
      type,
      label: type === 'support' ? 'support' : phase,
      confidence: w.confidence,
      deliveryRate: deliveryRates?.get(rateKey),
    }
  })
}

// ── タイムライン行コンポーネント ──

function TimelineHeader() {
  return (
    <div className="relative h-6 border-b border-gray-300" style={{ marginLeft: 36 }}>
      {Array.from({ length: 24 }, (_, h) => (
        <span
          key={h}
          className="absolute text-[10px] text-gray-400 -translate-x-1/2"
          style={{ left: `${pct(h * 60)}%`, top: 2 }}
        >
          {h}
        </span>
      ))}
    </div>
  )
}

function TimelineRow({ label, blocks }: { label: string; blocks: BlockDef[] }) {
  return (
    <div className="relative h-12 border-b border-gray-200 last:border-b-0">
      {/* ラベル */}
      <div className="absolute left-0 top-0 bottom-0 w-9 flex items-center justify-center text-xs font-semibold border-r border-gray-200 bg-gray-50 z-[5] text-gray-700">
        {label}
      </div>

      {/* 時間エリア */}
      <div className="absolute left-9 right-0 top-0 bottom-0">
        {/* グリッド線 */}
        {Array.from({ length: 25 }, (_, h) => (
          <div key={h} className="absolute top-0 bottom-0 border-l border-gray-200" style={{ left: `${pct(h * 60)}%` }} />
        ))}

        {/* ブロック */}
        {blocks.flatMap((b, i) => {
          const fromMin = t2m(b.from)
          const toMin = t2m(b.to)
          const isMain = b.type === 'main'
          const cls = `absolute top-1.5 bottom-1.5 rounded-[5px] flex items-center justify-center text-[11px] font-semibold z-10 min-w-[56px] px-1.5 cursor-default group
            ${isMain
              ? 'bg-blue-100 border-[1.5px] border-blue-300 text-blue-800'
              : 'bg-amber-50 border-[1.5px] border-amber-300 text-amber-800'
            }`

          const tooltip = (
            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-[11px] font-normal rounded-md px-2.5 py-1.5 whitespace-nowrap z-50 pointer-events-none leading-relaxed">
              <b>{b.phase}</b> ({b.type})<br />
              {b.from} – {b.to}
              {b.deliveryRate && <><br />配信率: {b.deliveryRate.firedDays}/{b.deliveryRate.totalDays} ({Math.round(b.deliveryRate.rate * 100)}%)</>}
              {!b.deliveryRate && b.confidence != null && <><br />confidence: {Math.round(b.confidence * 100)}%</>}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-gray-800" />
            </div>
          )

          const barValue = b.deliveryRate ? b.deliveryRate.rate : b.confidence
          const confBar = barValue != null && (
            <div className="absolute bottom-[3px] left-1 right-1 h-[3px] rounded-full bg-black/[0.06]">
              <div
                className={`h-full rounded-full ${isMain ? 'bg-blue-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.round(barValue * 100)}%` }}
              />
            </div>
          )

          // 日跨ぎ（例: 21:00〜01:00）→ 2ブロックに分割
          if (fromMin > toMin) {
            return [
              <div key={`${i}-a`} className={cls} style={{ left: `${pct(fromMin)}%`, width: `${pct(1440 - fromMin)}%` }}>
                {b.label}
                {confBar}
                {tooltip}
              </div>,
              <div key={`${i}-b`} className={cls} style={{ left: '0%', width: `${pct(toMin)}%` }}>
                {confBar}
              </div>,
            ]
          }

          return (
            <div key={i} className={cls} style={{ left: `${pct(fromMin)}%`, width: `${pct(toMin - fromMin)}%` }}>
              {b.label}
              {confBar}
              {tooltip}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── メインコンポーネント ──

interface BriefingScheduleProps {
  data: DayActivity[]
  /** バックエンドで算出された dayWindows（指定時はクライアント側計算より優先） */
  backendDayWindows?: Record<string, { from: string; to: string; confidence: number; phase?: string; phaseType?: 'main' | 'support' }[]>
  /** ブリーフィング発火履歴 */
  briefingHistory?: BriefingHistoryRecord[]
}

/**
 * ブリーフィングスケジュール可視化コンポーネント
 *
 * UserActivityViewer に統合して、アクティビティデータからブリーフィングの
 * 発火タイミング（学習前 / 学習後）を表示する。
 *
 * backendDayWindows が渡された場合、バックエンドの分析結果をそのまま表示する。
 * 渡されない場合はクライアント側で computePattern() を実行する。
 *
 * briefingHistory が渡された場合、confidence の代わりに配信率を表示する。
 */
export function BriefingSchedule({ data, backendDayWindows, briefingHistory }: BriefingScheduleProps) {
  const clientPattern = useMemo(() => computePattern(data), [data])

  // バックエンドの dayWindows がある場合はそちらを優先
  const pattern = useMemo<ActivityPattern>(() => {
    if (backendDayWindows && Object.keys(backendDayWindows).length > 0) {
      // バックエンドの BriefingWindow には phase/phaseType がないので付与しない
      const dayWindows: Record<string, BriefingWindow[]> = {}
      for (const [dow, windows] of Object.entries(backendDayWindows)) {
        dayWindows[dow] = windows.map(w => ({ ...w }))
      }
      // 全曜日が同一参照かどうかでフォールバック判定
      const values = Object.values(backendDayWindows)
      const isFallback = values.length === 7 && values.every(v =>
        JSON.stringify(v) === JSON.stringify(values[0])
      )
      return { dayWindows, activeDays: data.length, isFallback }
    }
    return clientPattern
  }, [backendDayWindows, clientPattern, data.length])

  // 配信率を算出
  const deliveryRates = useMemo(() => {
    if (!briefingHistory || briefingHistory.length === 0) return undefined
    return computeDeliveryRates(briefingHistory, data)
  }, [briefingHistory, data])

  const hasDeliveryData = deliveryRates && deliveryRates.size > 0

  const isBackend = !!(backendDayWindows && Object.keys(backendDayWindows).length > 0)
  const hasPattern = pattern.activeDays > 0 && Object.keys(pattern.dayWindows).length > 0
  const blocksByDay = useMemo(() => {
    const result: Record<string, BlockDef[]> = {}
    for (const [dow, windows] of Object.entries(pattern.dayWindows)) {
      result[dow] = windowsToBlocks(windows, dow, deliveryRates)
    }
    return result
  }, [pattern.dayWindows, deliveryRates])

  return (
    <div className="space-y-6">

      {/* ── 学習前（フォールバック） ── */}
      <div className={`bg-white rounded-lg shadow p-6 ${hasPattern ? 'opacity-60' : 'ring-2 ring-blue-400'}`}>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-lg font-semibold text-gray-900">学習前</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
            フォールバックモード
          </span>
          {!hasPattern && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-500 text-white">
              現在のモード
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          パターンがない初期状態。固定のウィンドウはなく、前回ブリーフィングから3時間以上経過したタイミングで発火します（1日最大3回）。
        </p>

        {/* ルール説明 */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-gray-800">3時間</div>
            <div className="text-xs text-gray-500">最小インターバル</div>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-gray-800">3回/日</div>
            <div className="text-xs text-gray-500">1日の上限</div>
          </div>
        </div>
      </div>

      {/* ── 学習後（アダプティブ） ── */}
      {hasPattern && (
        <div className="bg-white rounded-lg shadow p-6 ring-2 ring-blue-400">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-gray-900">学習後</h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
              アダプティブモード
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-500 text-white">
              現在のモード
            </span>
            {isBackend && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                バックエンド算出
              </span>
            )}
            <span className="text-sm text-gray-500">
              活動日数: {pattern.activeDays}日
            </span>
            {pattern.isFallback && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600">
                全日統合（曜日別データ不足）
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-4">
            過去の利用パターンから算出したウィンドウ。ユーザーがアプリを開いた時にウィンドウ内であれば発火（同一ウィンドウ1回、1日最大8回）。
          </p>

          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <TimelineHeader />
              {DAY_ORDER.map((dow) => {
                const blocks = blocksByDay[dow]
                if (!blocks || blocks.length === 0) {
                  return (
                    <div key={dow} className="relative h-12 border-b border-gray-200 last:border-b-0">
                      <div className="absolute left-0 top-0 bottom-0 w-9 flex items-center justify-center text-xs font-semibold border-r border-gray-200 bg-gray-50 z-[5] text-gray-700">
                        {DAY_LABELS[dow]}
                      </div>
                      <div className="absolute left-9 right-0 top-0 bottom-0 flex items-center justify-center text-xs text-gray-400">
                        データ不足
                      </div>
                    </div>
                  )
                }
                return <TimelineRow key={dow} label={DAY_LABELS[dow] ?? dow} blocks={blocks} />
              })}
            </div>
          </div>

          {/* ウィンドウ詳細テーブル */}
          <div className="mt-5 border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">検出ウィンドウ一覧</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="px-3 py-2 font-medium">曜日</th>
                  <th className="px-3 py-2 font-medium">ウィンドウ</th>
                  <th className="px-3 py-2 font-medium">フェーズ</th>
                  {hasDeliveryData ? (
                    <th className="px-3 py-2 font-medium">配信率</th>
                  ) : (
                    <th className="px-3 py-2 font-medium">Confidence</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {DAY_ORDER.flatMap((dow) => {
                  const windows = pattern.dayWindows[dow]
                  if (!windows) return []
                  return windows.map((w, i) => {
                    const isSupport = w.phaseType === 'support'
                    const rateKey = `${dow}:${w.from}`
                    const rate = deliveryRates?.get(rateKey)
                    const displayValue = rate ? rate.rate : w.confidence
                    const displayLabel = rate ? `${rate.firedDays}/${rate.totalDays} (${Math.round(rate.rate * 100)}%)` : `${Math.round(w.confidence * 100)}%`
                    return (
                      <tr key={`${dow}-${i}`}>
                        {i === 0 && (
                          <td className="px-3 py-2 font-semibold text-gray-700" rowSpan={windows.length}>
                            {DAY_LABELS[dow]}
                          </td>
                        )}
                        <td className="px-3 py-2 font-mono text-gray-900">{w.from} – {w.to}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            isSupport ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {w.phase ?? '?'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isSupport ? 'bg-amber-400' : 'bg-blue-400'}`}
                                style={{ width: `${Math.round(displayValue * 100)}%` }}
                              />
                            </div>
                            <span className="text-gray-700 font-medium">{displayLabel}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* パターンなし */}
      {!hasPattern && data.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-300">
          <p className="text-sm text-gray-500">
            アクティビティデータはありますが、ブリーフィングウィンドウの検出条件（出現率15%以上）を満たすパターンがありません。
            フォールバックモード（3時間間隔）で動作します。
          </p>
        </div>
      )}

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-5 text-xs text-gray-500 px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded-sm bg-blue-100 border border-blue-300" />
          <span>メイン（morning / afternoon / night）</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded-sm bg-amber-50 border border-amber-300" />
          <span>サポート（midday / evening）</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-1.5 rounded-full bg-gray-200 relative overflow-hidden">
            <div className="h-full w-[70%] rounded-full bg-blue-500" />
          </div>
          <span>{hasDeliveryData ? '配信率（実績）' : 'confidence（出現率）'}</span>
        </div>
      </div>
    </div>
  )
}
