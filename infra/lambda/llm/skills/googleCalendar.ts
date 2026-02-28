import { getGoogleTokens } from './tokenManager'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

/**
 * Google カレンダーから指定期間の予定を取得
 */
export async function listEvents(
  userId: string,
  input: Record<string, unknown>
): Promise<string> {
  const tokens = await getGoogleTokens(userId)
  if (!tokens) {
    return 'Google カレンダーが連携されていません。設定画面から Google アカウントを連携してください。'
  }

  const { timeMin, timeMax, maxResults = 10 } = input as {
    timeMin: string
    timeMax: string
    maxResults?: number
  }

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const res = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events?${params}`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
    },
  })

  if (!res.ok) {
    const errorBody = await res.text()
    console.error('[GoogleCalendar] イベント取得エラー:', errorBody)
    throw new Error('カレンダーの予定を取得できませんでした')
  }

  const data = await res.json() as {
    items?: Array<{
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      location?: string
      description?: string
    }>
  }

  const items = data.items ?? []
  if (items.length === 0) {
    return '指定期間に予定はありません。'
  }

  const eventList = items.map((item) => {
    const start = item.start?.dateTime ?? item.start?.date ?? ''
    const end = item.end?.dateTime ?? item.end?.date ?? ''
    let line = `- ${item.summary ?? '（タイトルなし）'}: ${start} 〜 ${end}`
    if (item.location) line += ` [場所: ${item.location}]`
    return line
  }).join('\n')

  return `予定一覧:\n${eventList}`
}

/**
 * Google カレンダーに新しい予定を作成
 */
export async function createEvent(
  userId: string,
  input: Record<string, unknown>
): Promise<string> {
  const tokens = await getGoogleTokens(userId)
  if (!tokens) {
    return 'Google カレンダーが連携されていません。設定画面から Google アカウントを連携してください。'
  }

  const { summary, startDateTime, endDateTime, description, location } = input as {
    summary: string
    startDateTime: string
    endDateTime: string
    description?: string
    location?: string
  }

  const event: Record<string, unknown> = {
    summary,
    start: { dateTime: startDateTime, timeZone: 'Asia/Tokyo' },
    end: { dateTime: endDateTime, timeZone: 'Asia/Tokyo' },
  }
  if (description) event.description = description
  if (location) event.location = location

  console.log('[GoogleCalendar] Creating event:', JSON.stringify(event))

  const res = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  const responseBody = await res.text()
  console.log(`[GoogleCalendar] Response status: ${res.status}, body: ${responseBody}`)

  if (!res.ok) {
    console.error('[GoogleCalendar] イベント作成エラー:', responseBody)
    throw new Error(`カレンダーに予定を作成できませんでした: ${responseBody}`)
  }

  const created = JSON.parse(responseBody) as {
    summary?: string
    start?: { dateTime?: string }
    end?: { dateTime?: string }
    htmlLink?: string
    id?: string
  }

  return `予定を作成しました: 「${created.summary}」(${created.start?.dateTime} 〜 ${created.end?.dateTime}) [ID: ${created.id}]`
}
