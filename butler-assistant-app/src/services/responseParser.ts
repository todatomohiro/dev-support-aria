import type {
  ParsedResponse,
  StructuredResponse,
  ValidationResult,
  FieldValidationError,
  ResponseParserService,
} from '@/types'
import { SUPPORTED_MOTION_TAGS } from '@/types'
import { measurePerformance } from '@/utils/performance'

/**
 * デフォルトレスポンス
 */
const DEFAULT_RESPONSE: ParsedResponse = {
  text: '申し訳ございません。回答の処理中にエラーが発生しました。',
  motion: 'bow',
  isValid: false,
  errors: ['デフォルト値を使用しています'],
}

/**
 * Response Parser Service 実装
 */
class ResponseParserImpl implements ResponseParserService {
  /**
   * LLMからのJSON文字列を解析
   */
  parse(jsonString: string): ParsedResponse {
    return measurePerformance('レスポンス解析', () => this.parseInternal(jsonString, false))
  }

  /**
   * 内部解析メソッド（再帰防止フラグ付き）
   */
  private parseInternal(jsonString: string, isRetry: boolean): ParsedResponse {
    try {
      // JSONとして解析を試行
      const parsed = JSON.parse(jsonString) as unknown

      // バリデーション
      const validationResult = this.validate(parsed)

      if (!validationResult.isValid) {
        // バリデーションエラーがある場合、デフォルト値で補完
        return this.createResponseWithDefaults(parsed, validationResult.errors)
      }

      const response = parsed as StructuredResponse

      return {
        text: response.text,
        motion: this.normalizeMotion(response.motion),
        emotion: response.emotion,
        isValid: true,
      }
    } catch {
      // 再帰防止：一度だけ抽出を試行
      if (!isRetry) {
        const extracted = this.extractJsonFromString(jsonString)
        if (extracted && extracted !== jsonString) {
          return this.parseInternal(extracted, true)
        }
      }

      // 解析できない場合はデフォルトを返す
      return { ...DEFAULT_RESPONSE }
    }
  }

  /**
   * レスポンスオブジェクトをJSON文字列にシリアライズ
   */
  serialize(response: ParsedResponse): string {
    const output: StructuredResponse = {
      text: response.text,
      motion: response.motion,
    }
    return JSON.stringify(output)
  }

  /**
   * レスポンスの妥当性を検証
   */
  validate(response: unknown): ValidationResult {
    const errors: FieldValidationError[] = []

    if (response === null || typeof response !== 'object') {
      errors.push({
        field: 'root',
        message: 'レスポンスはオブジェクトである必要があります',
      })
      return { isValid: false, errors }
    }

    const obj = response as Record<string, unknown>

    // textフィールドの検証
    if (!('text' in obj)) {
      errors.push({
        field: 'text',
        message: 'textフィールドは必須です',
      })
    } else if (typeof obj.text !== 'string') {
      errors.push({
        field: 'text',
        message: 'textフィールドは文字列である必要があります',
      })
    } else if (obj.text.trim() === '') {
      errors.push({
        field: 'text',
        message: 'textフィールドは空にできません',
      })
    }

    // motionフィールドの検証
    if (!('motion' in obj)) {
      errors.push({
        field: 'motion',
        message: 'motionフィールドは必須です',
      })
    } else if (typeof obj.motion !== 'string') {
      errors.push({
        field: 'motion',
        message: 'motionフィールドは文字列である必要があります',
      })
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * 文字列からJSON部分を抽出
   */
  private extractJsonFromString(str: string): string | null {
    const jsonMatch = str.match(/\{[\s\S]*\}/)
    return jsonMatch ? jsonMatch[0] : null
  }

  /**
   * モーションタグを正規化
   */
  private normalizeMotion(motion: string): string {
    const normalized = motion.toLowerCase().trim()
    if (SUPPORTED_MOTION_TAGS.includes(normalized as (typeof SUPPORTED_MOTION_TAGS)[number])) {
      return normalized
    }
    return 'idle'
  }

  /**
   * デフォルト値で補完したレスポンスを作成
   */
  private createResponseWithDefaults(
    parsed: unknown,
    validationErrors: FieldValidationError[]
  ): ParsedResponse {
    const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >

    const text =
      typeof obj.text === 'string' && obj.text.trim() !== ''
        ? obj.text
        : DEFAULT_RESPONSE.text

    const motion =
      typeof obj.motion === 'string'
        ? this.normalizeMotion(obj.motion)
        : DEFAULT_RESPONSE.motion

    const emotion = typeof obj.emotion === 'string' ? (obj.emotion as ParsedResponse['emotion']) : undefined

    return {
      text,
      motion,
      emotion,
      isValid: false,
      errors: validationErrors.map((e) => `${e.field}: ${e.message}`),
    }
  }
}

/**
 * Response Parser のシングルトンインスタンス
 */
export const responseParser: ResponseParserService = new ResponseParserImpl()

/**
 * テスト用にResponseParserImplクラスをエクスポート
 */
export { ResponseParserImpl }
