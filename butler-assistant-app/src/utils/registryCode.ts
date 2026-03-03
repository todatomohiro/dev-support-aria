/** レジストリコード形式: xxx-xxx-xxx（小文字 a-z のみ） */
const REGISTRY_CODE_PATTERN = /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/

/**
 * 入力がレジストリコード形式かどうかを判定
 */
export function isRegistryCode(input: string): boolean {
  return REGISTRY_CODE_PATTERN.test(input)
}

/**
 * ハイフンなし9文字の入力を xxx-xxx-xxx 形式に正規化
 *
 * - 既にハイフン付き形式の場合はそのまま返す
 * - 小文字 a-z 以外の文字は除去
 * - 9文字未満の場合は除去後のまま返す（部分一致用）
 */
export function normalizeRegistryCode(input: string): string {
  // 既にハイフン付き形式ならそのまま
  if (REGISTRY_CODE_PATTERN.test(input)) return input

  // 小文字 a-z のみ抽出
  const cleaned = input.toLowerCase().replace(/[^a-z]/g, '')

  // 3文字ごとにハイフン挿入
  const parts: string[] = []
  for (let i = 0; i < cleaned.length && i < 9; i += 3) {
    parts.push(cleaned.slice(i, i + 3))
  }

  return parts.join('-')
}
