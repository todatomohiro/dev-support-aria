#!/usr/bin/env python3
"""
全ユーザーのAI記憶・チャット履歴・トピックを一括削除するスクリプト

削除対象 SK: PERMANENT_FACTS, SESSION#*, MSG#*, THEME_SESSION#*
削除対象 PK: USER#*#THEME#* の全レコード
"""

import json
import os
import subprocess
import sys

TABLE_NAME = "butler-assistant"
DRY_RUN = "--dry-run" in sys.argv

# AWS CLI のページャーを無効化
os.environ["AWS_PAGER"] = ""

def scan_all_items():
    """テーブル全件スキャン（--no-cli-pager で全件一括取得）"""
    items = []
    start_key = None
    page = 0
    while True:
        page += 1
        cmd = [
            "aws", "dynamodb", "scan",
            "--table-name", TABLE_NAME,
            "--projection-expression", "PK, SK",
            "--output", "json",
        ]
        if start_key:
            cmd.extend(["--exclusive-start-key", json.dumps(start_key)])

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error scanning: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        if not result.stdout.strip():
            print(f"Error: empty response from scan (page {page})", file=sys.stderr)
            sys.exit(1)

        data = json.loads(result.stdout)
        page_items = data.get("Items", [])
        items.extend(page_items)
        print(f"  ページ {page}: {len(page_items)} 件 (累計 {len(items)})")

        start_key = data.get("LastEvaluatedKey")
        if not start_key:
            break

    return items

def should_delete(pk, sk):
    """削除対象かどうか判定"""
    import re
    # トピックメッセージ
    if re.match(r"^USER#.+#THEME#.+$", pk):
        return True
    # SK プレフィックス
    prefixes = ["PERMANENT_FACTS", "SESSION#", "MSG#", "THEME_SESSION#"]
    for prefix in prefixes:
        if sk == prefix or sk.startswith(prefix):
            return True
    return False

def batch_delete(items_to_delete):
    """25件ずつ BatchWriteItem で削除"""
    total = len(items_to_delete)
    deleted = 0

    for i in range(0, total, 25):
        batch = items_to_delete[i:i+25]
        request_items = {
            TABLE_NAME: [
                {
                    "DeleteRequest": {
                        "Key": {
                            "PK": item["PK"],
                            "SK": item["SK"],
                        }
                    }
                }
                for item in batch
            ]
        }

        cmd = [
            "aws", "dynamodb", "batch-write-item",
            "--request-items", json.dumps(request_items),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error deleting batch {i}-{i+len(batch)}: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        # Check for unprocessed items (stdout may be empty on success)
        if result.stdout.strip():
            response = json.loads(result.stdout)
            unprocessed = response.get("UnprocessedItems", {})
            if unprocessed:
                print(f"  Warning: {len(unprocessed.get(TABLE_NAME, []))} unprocessed items in batch {i}")

        deleted += len(batch)
        print(f"  削除済み: {deleted}/{total}")

    return deleted

def main():
    mode = "DRY RUN" if DRY_RUN else "実行"
    print(f"=== ユーザーデータ一括削除 ({mode}) ===")
    print(f"テーブル: {TABLE_NAME}")
    print()

    print("スキャン中...")
    all_items = scan_all_items()
    print(f"スキャン件数: {len(all_items)}")

    # フィルタ
    to_delete = []
    for item in all_items:
        pk = item.get("PK", {}).get("S", "")
        sk = item.get("SK", {}).get("S", "")
        if should_delete(pk, sk):
            to_delete.append(item)

    print(f"削除対象: {len(to_delete)}")
    print(f"保持: {len(all_items) - len(to_delete)}")
    print()

    if DRY_RUN:
        for item in to_delete[:20]:
            pk = item["PK"]["S"]
            sk = item["SK"]["S"]
            print(f"  [削除予定] PK={pk}  SK={sk}")
        if len(to_delete) > 20:
            print(f"  ... 他 {len(to_delete) - 20} 件")
        print()
        print("実際に削除するには --dry-run を外して再実行してください")
        return

    # 実際の削除
    print("削除開始...")
    deleted = batch_delete(to_delete)
    print()
    print(f"削除完了: {deleted} 件")

if __name__ == "__main__":
    main()
