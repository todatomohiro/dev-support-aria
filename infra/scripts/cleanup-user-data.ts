/**
 * 全ユーザーのAI記憶・チャット履歴・トピックを一括削除するスクリプト
 *
 * 削除対象:
 *   - PERMANENT_FACTS（永久記憶）
 *   - SESSION#*（セッション・要約）
 *   - MSG#*（メッセージ）
 *   - THEME_SESSION#*（トピック一覧）
 *   - USER#*#THEME#* の全レコード（トピックメッセージ）
 *
 * 保持:
 *   - SETTINGS, ROLE, ACTIVITY#*, FRIEND_CODE#*, FRIEND#*, GROUP#*, MEMO#*
 *
 * 使い方:
 *   npx tsx infra/scripts/cleanup-user-data.ts [--dry-run]
 */

import { DynamoDBClient, ScanCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'

const client = new DynamoDBClient({ region: 'ap-northeast-1' })
const TABLE_NAME = 'butler-assistant'
const DRY_RUN = process.argv.includes('--dry-run')

/** 削除対象の SK プレフィックス */
const DELETE_SK_PREFIXES = [
  'PERMANENT_FACTS',
  'SESSION#',
  'MSG#',
  'THEME_SESSION#',
]

/** 削除対象の PK パターン（トピックメッセージ） */
function isThemePK(pk: string): boolean {
  return /^USER#.+#THEME#.+$/.test(pk)
}

/** アイテムが削除対象かどうか判定 */
function shouldDelete(pk: string, sk: string): boolean {
  // トピックメッセージ（USER#{id}#THEME#{id} の全レコード）
  if (isThemePK(pk)) return true

  // SK プレフィックスで判定
  return DELETE_SK_PREFIXES.some((prefix) =>
    sk === prefix || sk.startsWith(prefix)
  )
}

async function main() {
  console.log(`=== ユーザーデータ一括削除 ${DRY_RUN ? '(DRY RUN)' : ''} ===`)
  console.log(`テーブル: ${TABLE_NAME}`)
  console.log('')

  let totalScanned = 0
  let totalDeleted = 0
  let lastKey: Record<string, { S: string }> | undefined

  do {
    const scan = await client.send(new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey: lastKey,
    }))

    const items = scan.Items ?? []
    totalScanned += items.length

    // 削除対象をフィルタ
    const toDelete = items.filter((item) => {
      const pk = item.PK?.S ?? ''
      const sk = item.SK?.S ?? ''
      return shouldDelete(pk, sk)
    })

    if (toDelete.length > 0) {
      // BatchWriteItem は25件ずつ
      for (let i = 0; i < toDelete.length; i += 25) {
        const batch = toDelete.slice(i, i + 25)

        if (DRY_RUN) {
          for (const item of batch) {
            console.log(`  [削除予定] PK=${item.PK?.S}  SK=${item.SK?.S}`)
          }
        } else {
          await client.send(new BatchWriteItemCommand({
            RequestItems: {
              [TABLE_NAME]: batch.map((item) => ({
                DeleteRequest: {
                  Key: {
                    PK: item.PK!,
                    SK: item.SK!,
                  },
                },
              })),
            },
          }))

          for (const item of batch) {
            console.log(`  [削除] PK=${item.PK?.S}  SK=${item.SK?.S}`)
          }
        }

        totalDeleted += batch.length
      }
    }

    lastKey = scan.LastEvaluatedKey as Record<string, { S: string }> | undefined
  } while (lastKey)

  console.log('')
  console.log(`スキャン件数: ${totalScanned}`)
  console.log(`${DRY_RUN ? '削除予定' : '削除済み'}: ${totalDeleted}`)

  if (DRY_RUN) {
    console.log('')
    console.log('実際に削除するには --dry-run を外して再実行してください')
  }
}

main().catch((err) => {
  console.error('エラー:', err)
  process.exit(1)
})
