#!/bin/bash
# 初期管理者シードスクリプト
# 使用法: aws-vault exec cm-toda-mfa -- bash infra/scripts/seed-admin.sh <cognito-sub>

set -euo pipefail

TABLE_NAME="butler-assistant"
REGION="ap-northeast-1"

if [ $# -lt 1 ]; then
  echo "使用法: $0 <cognito-sub>"
  echo ""
  echo "Cognito sub は AWS コンソール → Cognito → Users で確認できます"
  exit 1
fi

USER_SUB="$1"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "管理者ロールを付与します..."
echo "  User: ${USER_SUB}"
echo "  Table: ${TABLE_NAME}"
echo ""

aws dynamodb put-item \
  --table-name "${TABLE_NAME}" \
  --region "${REGION}" \
  --item "{
    \"PK\": {\"S\": \"USER#${USER_SUB}\"},
    \"SK\": {\"S\": \"ROLE\"},
    \"role\": {\"S\": \"admin\"},
    \"updatedAt\": {\"S\": \"${NOW}\"},
    \"updatedBy\": {\"S\": \"seed-script\"}
  }"

echo "完了: USER#${USER_SUB} に admin ロールを付与しました"
