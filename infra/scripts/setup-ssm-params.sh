#!/bin/bash
# SSM Parameter Store にシークレットを登録するスクリプト
# 使い方: aws-vault exec cm-toda-mfa -- bash infra/scripts/setup-ssm-params.sh
#
# 既に登録済みのパラメータは上書きされます（--overwrite）

set -euo pipefail

PREFIX="/butler-assistant"

PARAMS=(
  "MEMORY_ID"
  "GOOGLE_CLIENT_ID"
  "GOOGLE_CLIENT_SECRET"
  "GOOGLE_IOS_CLIENT_ID"
  "GOOGLE_PLACES_API_KEY"
  "BRAVE_SEARCH_API_KEY"
  "ELEVENLABS_API_KEY"
)

for key in "${PARAMS[@]}"; do
  read -rp "${key}: " value
  if [ -z "$value" ]; then
    echo "  → スキップ（空）"
    continue
  fi
  aws ssm put-parameter \
    --name "${PREFIX}/${key}" \
    --value "$value" \
    --type String \
    --overwrite \
    --no-cli-pager
  echo "  → 登録完了: ${PREFIX}/${key}"
done

echo ""
echo "登録済みパラメータ:"
aws ssm get-parameters-by-path --path "$PREFIX/" --query 'Parameters[].Name' --output table --no-cli-pager
