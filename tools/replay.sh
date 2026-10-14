#!/bin/bash
# 原版回放辅助脚本
#
# 安全约定：
#  - 密码/token 只存在于内存环境变量，不写入任何文件
#  - 所有输出经 scrub() 脱敏，绝不打印 token
#  - 证据落盘前再次脱敏
#
# 用法：ERP_PASSWORD=xxx ./tools/replay.sh <METHOD> <PATH> [JSON_BODY]
#   例：ERP_PASSWORD=xxx ./tools/replay.sh GET /api/v1/approval-flows

set -uo pipefail

ERP_BASE="${ERP_BASE:-http://192.168.110.97:18886}"
ERP_USER="${ERP_USER:-admin}"

# ---- 脱敏过滤器：拦截任何形态的令牌/密钥 ----
scrub() {
  sed -E \
    -e 's/(eyJ[A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/<JWT>/g' \
    -e 's/("(access_token|refresh_token|token|password|authorization|Authorization)"[[:space:]]*:[[:space:]]*")[^"]*"/\1<REDACTED>"/g' \
    -e 's/(Bearer )[A-Za-z0-9._-]+/\1<REDACTED>/g'
}

login() {
  local resp
  resp=$(timeout 20 curl -s -X POST "$ERP_BASE/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ERP_USER\",\"password\":\"$ERP_PASSWORD\"}") || return 1
  # 只取 access_token，不打印整个响应（响应含完整权限树，体积大且含 refresh_token）
  echo "$resp" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    t=(d.get('data') or {}).get('access_token')
    print(t if t else '')
except Exception:
    print('')
"
}

METHOD="${1:-GET}"
API_PATH="${2:-/api/v1/health}"
BODY="${3:-}"

TOKEN=$(login)
if [ -z "$TOKEN" ]; then
  echo '{"__error":"登录失败"}' | scrub
  exit 1
fi

if [ -n "$BODY" ]; then
  timeout 30 curl -s -X "$METHOD" "$ERP_BASE$API_PATH" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY" -w "\n__HTTP__%{http_code}"
else
  timeout 30 curl -s -X "$METHOD" "$ERP_BASE$API_PATH" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -w "\n__HTTP__%{http_code}"
fi | scrub

unset TOKEN