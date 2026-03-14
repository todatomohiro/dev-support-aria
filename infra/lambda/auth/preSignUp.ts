import type { PreSignUpTriggerEvent } from 'aws-lambda'

/**
 * Cognito Pre Sign-up Lambda トリガー
 * サインアップ時にメールアドレスを自動確認する（開発環境用）
 */
export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  event.response.autoConfirmUser = true
  event.response.autoVerifyEmail = true
  return event
}
