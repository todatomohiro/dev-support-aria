import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

const client = new DynamoDBClient({})
const REGISTRY_TABLE_NAME = process.env.REGISTRY_TABLE_NAME!

/** レジストリコード形式: xxx-xxx-xxx（小文字 a-z のみ） */
const REGISTRY_CODE_PATTERN = /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/

/** レジストリエントリ */
export interface RegistryEntry {
  code: string
  serverUrl: string
  transport: string
  displayName: string
  description?: string
  defaultTtlMinutes: number
  config?: string
  script?: string
  active: boolean
  createdBy?: string
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

/**
 * レジストリコードの形式を検証
 */
export function isValidRegistryCode(code: string): boolean {
  return REGISTRY_CODE_PATTERN.test(code)
}

/**
 * レジストリコードからエントリを解決
 *
 * @throws Error コードが無効、見つからない、無効化済み、期限切れの場合
 */
export async function resolveRegistryCode(code: string): Promise<RegistryEntry> {
  if (!isValidRegistryCode(code)) {
    throw new Error('無効なレジストリコード形式です')
  }

  const result = await client.send(new GetItemCommand({
    TableName: REGISTRY_TABLE_NAME,
    Key: { code: { S: code } },
  }))

  if (!result.Item) {
    throw new Error('レジストリコードが見つかりません')
  }

  const entry = unmarshall(result.Item) as RegistryEntry

  if (!entry.active) {
    throw new Error('このレジストリコードは無効化されています')
  }

  if (entry.expiresAt && entry.expiresAt < new Date().toISOString()) {
    throw new Error('このレジストリコードは有効期限切れです')
  }

  return entry
}
