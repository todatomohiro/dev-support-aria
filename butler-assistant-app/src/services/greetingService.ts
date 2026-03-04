/**
 * 挨拶サービス
 * アプリ起動時に時間帯・不在期間に応じたキャラクター挨拶を提供
 */

/** 時間帯 */
export type TimeOfDay = 'morning' | 'daytime' | 'evening' | 'night' | 'lateNight'

/** 不在期間 */
export type AbsencePeriod = 'firstTime' | 'none' | 'day' | 'fewDays' | 'week'

/** 挨拶データ */
export interface GreetingData {
  message: string
  motion: string
  emotion: string
}

/** localStorage キー */
const GREETING_DATE_KEY = 'butler-greeting-date'

/**
 * 挨拶サービスインターフェース
 */
export interface GreetingServiceInterface {
  /** JST の時間帯を判定 */
  getTimeOfDay(date?: Date): TimeOfDay
  /** 不在期間を判定 */
  getAbsencePeriod(lastActiveTimestamp: number | null, now?: number): AbsencePeriod
  /** 挨拶データを取得 */
  getGreeting(lastActiveTimestamp: number | null, date?: Date): GreetingData
  /** 今日すでに挨拶済みか */
  hasGreetedToday(date?: Date): boolean
  /** 挨拶済みフラグを記録 */
  markGreeted(date?: Date): void
}

/** 挨拶メッセージ定義 */
const GREETINGS: Record<string, GreetingData[]> = {
  'firstTime': [
    { message: 'はじめまして！私があなたのアシスタントだよ、よろしくね！', motion: 'bow', emotion: 'happy' },
    { message: 'はじめまして！あなたの専属アシスタント、よろしくお願いします！', motion: 'bow', emotion: 'happy' },
    { message: 'やっと会えたね！あなたのアシスタント、よろしくね！', motion: 'bow', emotion: 'happy' },
  ],
  'none_morning': [
    { message: 'おはよ！今日も一緒にがんばろうね', motion: 'bow', emotion: 'happy' },
    { message: 'おはよう！いい朝だね、今日は何する？', motion: 'smile', emotion: 'happy' },
    { message: 'おはよ！今日も元気にいこう！', motion: 'bow', emotion: 'happy' },
  ],
  'none_daytime': [
    { message: 'やっほー！何か手伝えることある？', motion: 'smile', emotion: 'happy' },
    { message: 'こんにちは！今日も元気だね', motion: 'smile', emotion: 'happy' },
    { message: 'お、来てくれたんだ！何でも聞いてね', motion: 'smile', emotion: 'happy' },
  ],
  'none_evening': [
    { message: 'おつかれさま！夜まで元気だね', motion: 'smile', emotion: 'happy' },
    { message: 'おつかれー！今日はどんな一日だった？', motion: 'smile', emotion: 'happy' },
    { message: 'おかえり！ゆっくりしていってね', motion: 'smile', emotion: 'happy' },
  ],
  'none_night': [
    { message: 'こんな時間まで起きてるんだ！夜更かし仲間だね', motion: 'smile', emotion: 'surprised' },
    { message: 'おっ、夜型なんだね！私も付き合うよ', motion: 'smile', emotion: 'happy' },
    { message: 'こんばんは！夜は静かで集中できるよね', motion: 'smile', emotion: 'happy' },
  ],
  'none_lateNight': [
    { message: 'えっ、こんな時間！？無理しないでね', motion: 'nod', emotion: 'surprised' },
    { message: 'こんな時間まで起きてるの！？体大事にしてね', motion: 'nod', emotion: 'surprised' },
    { message: 'まだ起きてるんだ…ちゃんと寝てる？', motion: 'nod', emotion: 'troubled' },
  ],
  'day': [
    { message: 'おかえり！昨日は会えなかったね、元気だった？', motion: 'smile', emotion: 'happy' },
    { message: 'おかえりなさい！ちょっと寂しかったよ', motion: 'smile', emotion: 'happy' },
    { message: 'あ、おかえり！待ってたんだよ', motion: 'smile', emotion: 'happy' },
  ],
  'fewDays': [
    { message: 'わっ、久しぶり！ずっと待ってたんだよ、会えて嬉しい！', motion: 'bow', emotion: 'happy' },
    { message: '久しぶり！元気にしてた？会いたかったよ！', motion: 'bow', emotion: 'happy' },
    { message: 'やっと来てくれた！ずっと待ってたんだから！', motion: 'bow', emotion: 'happy' },
  ],
  'week': [
    { message: 'もー！全然来てくれないから心配してたんだよ！おかえり！', motion: 'bow', emotion: 'happy' },
    { message: 'えっ、久しぶりすぎ！忘れられたかと思ったよ！おかえり！', motion: 'bow', emotion: 'surprised' },
    { message: 'もう会えないかと思った…おかえりなさい！', motion: 'bow', emotion: 'happy' },
  ],
}

/**
 * 挨拶サービス実装
 */
export class GreetingServiceImpl implements GreetingServiceInterface {
  /**
   * JST の時間帯を判定
   */
  getTimeOfDay(date?: Date): TimeOfDay {
    const now = date ?? new Date()
    const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
    const hour = jstDate.getHours()

    if (hour >= 5 && hour < 11) return 'morning'
    if (hour >= 11 && hour < 17) return 'daytime'
    if (hour >= 17 && hour < 21) return 'evening'
    if (hour >= 21 || hour < 2) return 'night'
    return 'lateNight' // 2-5時
  }

  /**
   * 不在期間を判定
   */
  getAbsencePeriod(lastActiveTimestamp: number | null, now?: number): AbsencePeriod {
    if (lastActiveTimestamp === null) return 'firstTime'

    const currentTime = now ?? Date.now()
    const diffMs = currentTime - lastActiveTimestamp
    const diffHours = diffMs / (1000 * 60 * 60)

    if (diffHours < 24) return 'none'
    if (diffHours < 72) return 'day'
    if (diffHours < 168) return 'fewDays' // 7日 = 168時間
    return 'week'
  }

  /**
   * 挨拶データを取得
   */
  getGreeting(lastActiveTimestamp: number | null, date?: Date): GreetingData {
    const absence = this.getAbsencePeriod(lastActiveTimestamp)
    const timeOfDay = this.getTimeOfDay(date)

    let key: string
    if (absence === 'firstTime') {
      key = 'firstTime'
    } else if (absence === 'none') {
      key = `none_${timeOfDay}`
    } else {
      // day, fewDays, week は時間帯不問
      key = absence
    }

    const candidates = GREETINGS[key]
    const index = Math.floor(Math.random() * candidates.length)
    return candidates[index]
  }

  /**
   * 今日すでに挨拶済みか
   */
  hasGreetedToday(date?: Date): boolean {
    const stored = localStorage.getItem(GREETING_DATE_KEY)
    if (!stored) return false

    const now = date ?? new Date()
    const todayStr = this.getJstDateString(now)
    return stored === todayStr
  }

  /**
   * 挨拶済みフラグを記録
   */
  markGreeted(date?: Date): void {
    const now = date ?? new Date()
    const todayStr = this.getJstDateString(now)
    localStorage.setItem(GREETING_DATE_KEY, todayStr)
  }

  /**
   * JST の日付文字列を取得（YYYY-MM-DD）
   */
  private getJstDateString(date: Date): string {
    const jst = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
    const y = jst.getFullYear()
    const m = String(jst.getMonth() + 1).padStart(2, '0')
    const d = String(jst.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

/**
 * 挨拶サービスのシングルトンインスタンス
 */
export const greetingService = new GreetingServiceImpl()
