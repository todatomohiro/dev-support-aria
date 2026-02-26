/**
 * アプリケーションエラー基底クラス
 */
export abstract class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * ネットワークエラー
 */
export class NetworkError extends AppError {
  constructor(message: string = 'ネットワーク接続を確認してください', details?: unknown) {
    super(message, 'NETWORK_ERROR', details)
  }
}

/**
 * APIエラー
 */
export class APIError extends AppError {
  constructor(
    message: string,
    public readonly statusCode: number,
    details?: unknown
  ) {
    super(message, 'API_ERROR', details)
  }
}

/**
 * レート制限エラー
 */
export class RateLimitError extends AppError {
  constructor(
    message: string = 'しばらく待ってから再試行してください',
    public readonly retryAfter?: number
  ) {
    super(message, 'RATE_LIMIT_ERROR', { retryAfter })
  }
}

/**
 * 解析エラー
 */
export class ParseError extends AppError {
  constructor(message: string = '回答の処理中にエラーが発生しました', details?: unknown) {
    super(message, 'PARSE_ERROR', details)
  }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly validationErrors: Array<{ field: string; message: string }>
  ) {
    super(message, 'VALIDATION_ERROR', { errors: validationErrors })
  }
}

/**
 * モデル読み込みエラー
 */
export class ModelLoadError extends AppError {
  constructor(message: string = 'モデルの読み込みに失敗しました', details?: unknown) {
    super(message, 'MODEL_LOAD_ERROR', details)
  }
}

/**
 * エラーログ
 */
export interface ErrorLog {
  timestamp: number
  errorType: string
  errorCode: string
  message: string
  details?: unknown
  stackTrace?: string
  userAction?: string
}
