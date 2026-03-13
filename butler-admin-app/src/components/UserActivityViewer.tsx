import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { adminApi } from '@/services/adminApi'
import { BriefingSchedule } from '@/components/BriefingSchedule'

/** 曜日ラベル */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 時間ラベル（0〜23） */
const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** 日別アクティビティ */
export interface DayActivity {
  date: string
  dayOfWeek: number
  hours: number[]       // 各時間のアクティブ分数（0-60）
  minutes: string[]     // 生のタイムスタンプ配列
  totalMinutes: number
}

/** APIレスポンスの1レコード */
interface ActivityRecord {
  date: string
  activeMinutes: string[]
}

/** APIレスポンスをDayActivity配列に変換 */
function parseActivities(records: ActivityRecord[]): DayActivity[] {
  return records.map((record) => {
    const date = new Date(record.date)
    const dayOfWeek = date.getDay()
    const hours = new Array(24).fill(0) as number[]

    // 分をカウント（"HH:mm" → hours[HH]++）
    const uniqueMinutes = [...new Set(record.activeMinutes)]
    for (const ts of uniqueMinutes) {
      // "YYYY-MM-DDTHH:mm" → HH を取得
      const hourStr = ts.slice(11, 13)
      const h = parseInt(hourStr, 10)
      if (!isNaN(h) && h >= 0 && h < 24) {
        hours[h] = (hours[h] ?? 0) + 1
      }
    }

    return {
      date: record.date,
      dayOfWeek,
      hours,
      minutes: uniqueMinutes.sort(),
      totalMinutes: uniqueMinutes.length,
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

/** ヒートマップセルの色クラス */
function getCellColor(value: number): string {
  if (value === 0) return 'bg-gray-100'
  if (value <= 5) return 'bg-blue-100'
  if (value <= 15) return 'bg-blue-200'
  if (value <= 30) return 'bg-blue-400'
  return 'bg-blue-600'
}

/** サマリー統計 */
interface Stats {
  totalDays: number
  avgMinutes: number
  peakHour: number
  lateNightTotal: number
  lateNightRecent: number
}

function calcStats(data: DayActivity[]): Stats {
  const totalDays = data.length
  const totalMinutes = data.reduce((s, d) => s + d.totalMinutes, 0)
  const avgMinutes = totalDays > 0 ? Math.round(totalMinutes / totalDays) : 0

  const hourTotals = new Array(24).fill(0) as number[]
  data.forEach((d) => d.hours.forEach((v, h) => { hourTotals[h] = (hourTotals[h] ?? 0) + v }))
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals))

  const hasLateNight = (d: DayActivity) => (d.hours[0] ?? 0) + (d.hours[1] ?? 0) + (d.hours[2] ?? 0) + (d.hours[3] ?? 0) > 0
  const lateNightTotal = data.filter(hasLateNight).length
  const recent7 = data.slice(-7)
  const lateNightRecent = recent7.filter(hasLateNight).length

  return { totalDays, avgMinutes, peakHour, lateNightTotal, lateNightRecent }
}

/** ユーザーアクティビティ閲覧画面 */
export function UserActivityViewer() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const idToken = useAuthStore((s) => s.idToken)

  const [data, setData] = useState<DayActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [selectedDay, setSelectedDay] = useState<DayActivity | null>(null)
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)
  const [backendDayWindows, setBackendDayWindows] = useState<Record<string, { from: string; to: string; confidence: number }[]> | undefined>()
  const [briefingHistory, setBriefingHistory] = useState<{ date: string; triggeredWindows: { windowFrom: string; windowTo: string; firedAt: string }[] }[] | undefined>()

  const fetchData = useCallback(async (numDays: number) => {
    if (!idToken || !userId) return
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.getUserActivity(idToken, userId, numDays)
      setData(parseActivities(result.activities))
      setBackendDayWindows(result.dayWindows)
      setBriefingHistory(result.briefingHistory)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アクティビティの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [idToken, userId])

  useEffect(() => {
    fetchData(days)
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => calcStats(data), [data])

  const handleCellHover = (e: React.MouseEvent, day: DayActivity, hour: number) => {
    const v = day.hours[hour]
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setTooltip({
      text: `${day.date} ${String(hour).padStart(2, '0')}:00〜${String(hour).padStart(2, '0')}:59 — ${v}分`,
      x: rect.left,
      y: rect.top - 30,
    })
  }

  return (
    <div>
      {/* ヘッダー */}
      <button
        onClick={() => navigate(`/users/${userId}`)}
        className="text-sm text-blue-600 hover:text-blue-800 mb-4 cursor-pointer"
      >
        &larr; ユーザー詳細に戻る
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">アクティビティログ</h2>
          <p className="text-sm text-gray-500 mt-1">直近{days}日間のライフスタイルデータ</p>
        </div>
        <select
          value={days}
          onChange={(e) => { setDays(parseInt(e.target.value, 10)); setSelectedDay(null) }}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value={14}>直近14日</option>
          <option value={30}>直近30日</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {loading && <p className="text-gray-400 mb-4">読み込み中...</p>}

      {/* サマリーカード */}
      {!loading && data.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">データ日数</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalDays}</p>
              <p className="text-xs text-gray-400 mt-1">/ {days}日中</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">1日あたり平均</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{stats.avgMinutes}</p>
              <p className="text-xs text-gray-400 mt-1">アクティブ分</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">最頻活動時間帯</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {String(stats.peakHour).padStart(2, '0')}:00
              </p>
              <p className="text-xs text-gray-400 mt-1">
                〜 {String(stats.peakHour + 1).padStart(2, '0')}:00
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">深夜活動 (0-4時)</p>
              <p className={`text-2xl font-bold mt-1 ${stats.lateNightRecent >= 3 ? 'text-red-600' : 'text-gray-900'}`}>
                {stats.lateNightTotal}
              </p>
              <p className="text-xs text-gray-400 mt-1">日 / 直近7日中 {stats.lateNightRecent}日</p>
            </div>
          </div>

          {/* ヒートマップ */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">時間帯別アクティビティ</h3>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>少</span>
                <div className="flex gap-0.5">
                  <div className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" />
                  <div className="w-3 h-3 rounded-sm bg-blue-100" />
                  <div className="w-3 h-3 rounded-sm bg-blue-200" />
                  <div className="w-3 h-3 rounded-sm bg-blue-400" />
                  <div className="w-3 h-3 rounded-sm bg-blue-600" />
                </div>
                <span>多</span>
                <span className="ml-2 text-gray-400">（1セル = 1時間 / 最大60分）</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* 時間ラベル */}
                <div className="flex mb-1">
                  <div className="w-20 shrink-0" />
                  <div className="flex-1 grid gap-0.5" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                    {HOURS.map((h) => (
                      <div key={h} className="text-center text-xs text-gray-400">
                        {h % 3 === 0 ? h : ''}
                      </div>
                    ))}
                  </div>
                </div>

                {/* データ行 */}
                <div className="space-y-0.5">
                  {data.map((day) => {
                    const weekdayColor = day.dayOfWeek === 0 ? 'text-red-500' : day.dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-600'
                    const isSelected = selectedDay?.date === day.date

                    return (
                      <div
                        key={day.date}
                        className={`flex items-center cursor-pointer rounded ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                        onClick={() => setSelectedDay(day)}
                      >
                        <div className={`w-20 shrink-0 text-xs ${weekdayColor} pr-2 text-right`}>
                          {day.date.slice(5, 7)}/{day.date.slice(8, 10)} ({WEEKDAYS[day.dayOfWeek]})
                        </div>
                        <div
                          className="flex-1 grid gap-0.5"
                          style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
                        >
                          {HOURS.map((h) => (
                            <div
                              key={h}
                              className={`h-4 rounded-sm ${getCellColor(day.hours[h] ?? 0)} transition-transform hover:scale-150 hover:z-10`}
                              onMouseEnter={(e) => handleCellHover(e, day, h)}
                              onMouseLeave={() => setTooltip(null)}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 日別詳細 */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">日別タイムライン</h3>
            {selectedDay ? (
              <DailyTimeline day={selectedDay} />
            ) : (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <p className="text-center text-gray-400 text-sm py-4">
                  ヒートマップの行をクリックすると、その日の分単位アクティビティが表示されます
                </p>
              </div>
            )}
          </div>

          {/* ブリーフィングスケジュール */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">ブリーフィングスケジュール</h3>
            <BriefingSchedule data={data} backendDayWindows={backendDayWindows} briefingHistory={briefingHistory} />
          </div>

          {/* インサイト（Phase 2 プレビュー） */}
          <InsightPreview data={data} />
        </>
      )}

      {!loading && data.length === 0 && !error && (
        <>
          <div className="bg-white rounded-lg shadow p-6 text-center text-gray-400">
            アクティビティデータがありません
          </div>
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">ブリーフィングスケジュール</h3>
            <BriefingSchedule data={[]} />
          </div>
        </>
      )}

      {/* ツールチップ */}
      {tooltip && (
        <div
          className="fixed bg-gray-900 text-white text-xs rounded px-2 py-1 shadow-lg z-50 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}

/** 日別タイムライン表示 */
function DailyTimeline({ day }: { day: DayActivity }) {
  const activeSet = useMemo(() => new Set(day.minutes.map((m) => m.slice(11))), [day])

  // アクティブな時間帯のみ表示
  const activeHours = HOURS.filter((h) => (day.hours[h] ?? 0) > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-900">
          {day.date} ({WEEKDAYS[day.dayOfWeek]})
        </h4>
        <span className="text-sm text-gray-500">合計 {day.totalMinutes} 分アクティブ</span>
      </div>
      <div className="space-y-1">
        {activeHours.map((h) => (
          <div key={h} className="flex items-center gap-2">
            <span className="w-12 text-xs text-gray-500 text-right shrink-0">
              {String(h).padStart(2, '0')}:00
            </span>
            <div className="flex-1 flex gap-px">
              {Array.from({ length: 60 }, (_, m) => {
                const key = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                return (
                  <div
                    key={m}
                    className={`h-3 flex-1 rounded-sm ${activeSet.has(key) ? 'bg-blue-500' : 'bg-gray-100'}`}
                    title={key}
                  />
                )
              })}
            </div>
            <span className="w-10 text-xs text-gray-400 text-right shrink-0">
              {day.hours[h] ?? 0}分
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** パターン変化インサイト（Phase 2 プレビュー） */
function InsightPreview({ data }: { data: DayActivity[] }) {
  const insights = useMemo(() => {
    if (data.length < 7) return []

    const result: string[] = []
    const recent3 = data.slice(-3)
    const baseline = data.slice(0, -3)

    // 深夜活動チェック
    const hasLateNight = (d: DayActivity) => (d.hours[0] ?? 0) + (d.hours[1] ?? 0) + (d.hours[2] ?? 0) + (d.hours[3] ?? 0) > 0
    const baselineLateRate = baseline.length > 0 ? baseline.filter(hasLateNight).length / baseline.length : 0
    const recentLateCount = recent3.filter(hasLateNight).length

    if (baselineLateRate < 0.15 && recentLateCount >= 2) {
      result.push(`深夜活動の増加: 直近3日間のうち${recentLateCount}日で 0:00〜4:00 の活動が検出されています（ベースライン期間では ${Math.round(baselineLateRate * 100)}%）`)
    }

    // 活動開始時刻の変化
    const getFirstActiveHour = (d: DayActivity) => d.hours.findIndex((v) => v > 0)
    const baselineStarts = baseline.map(getFirstActiveHour).filter((h) => h >= 0)
    const recentStarts = recent3.map(getFirstActiveHour).filter((h) => h >= 0)

    if (baselineStarts.length > 0 && recentStarts.length > 0) {
      const baseAvg = Math.round(baselineStarts.reduce((a, b) => a + b, 0) / baselineStarts.length)
      const recentAvg = Math.round(recentStarts.reduce((a, b) => a + b, 0) / recentStarts.length)
      if (recentAvg - baseAvg >= 2) {
        result.push(`活動開始時刻の変化: 通常 ${baseAvg}:00 頃に開始 → 直近3日は ${recentAvg}:00 頃に遅延`)
      }
    }

    return result
  }, [data])

  if (insights.length === 0) return null

  return (
    <div className="bg-white rounded-lg shadow p-6 border-l-4 border-amber-400">
      <div className="flex items-start gap-3">
        <span className="text-amber-500 text-xl mt-0.5">&#9888;</span>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            検出されたパターン変化（Phase 2 プレビュー）
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-gray-600">
            {insights.map((insight, i) => (
              <li key={i}>&bull; {insight}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-400">
            ※ この情報は将来的にブリーフィングのシステムプロンプトに注入されます
          </p>
        </div>
      </div>
    </div>
  )
}
