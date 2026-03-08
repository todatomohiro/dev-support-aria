/**
 * Bedrock モデル ID 定数
 *
 * バックグラウンド処理（要約・事実抽出）で使用するモデル ID を一元管理。
 * モデル更新時はここを変更するだけで全 Lambda に反映される。
 */

/** バックグラウンド処理用モデル ID（要約・事実抽出） */
export const BACKGROUND_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0'

/** チャット用モデル ID マッピング */
export const CHAT_MODEL_ID_MAP: Record<string, string> = {
  haiku: BACKGROUND_MODEL_ID,
  sonnet: 'jp.anthropic.claude-sonnet-4-6',
  opus: 'global.anthropic.claude-opus-4-6-v1',
}
