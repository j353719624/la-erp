#!/bin/bash
# 从「包定义 + 载荷」重打 LA-ERP 的 fnOS fpk。
#
# 用法:
#   ./build.sh <载荷来源目录> [输出目录] [版本号]
#
# 载荷来源目录需含 server/ ui/ config/ 三者，通常取其一：
#   - 已安装实例:      /vol2/@appcenter/la-erp
#   - 从现有 fpk 解出:  tar xzf x.fpk app.tgz && tar xzf app.tgz -C <dir>
#
# 包定义（manifest / ICON / cmd / config / wizard / server-scripts）来自本仓库的
# source/la-erp/，无需额外准备。
set -e

SRC_PAYLOAD="${1:?用法: build.sh <载荷来源目录> [输出目录] [版本号]}"
OUT="${2:-$(pwd)}"
VER="${3:-}"

HERE="$(cd "$(dirname "$0")" && pwd)"
DEF="$HERE/source/la-erp"

[ -d "$SRC_PAYLOAD/server" ] || { echo "错误: $SRC_PAYLOAD/server 不存在" >&2; exit 1; }
[ -d "$SRC_PAYLOAD/ui" ]     || { echo "错误: $SRC_PAYLOAD/ui 不存在" >&2; exit 1; }
[ -d "$SRC_PAYLOAD/config" ] || { echo "错误: $SRC_PAYLOAD/config 不存在" >&2; exit 1; }
[ -f "$DEF/manifest" ]       || { echo "错误: $DEF/manifest 不存在" >&2; exit 1; }

STAGE="$(mktemp -d /tmp/laerp-build.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

echo "== 1/5 包定义 =="
mkdir -p "$STAGE/app"
cp -a "$DEF/manifest" "$DEF/ICON.PNG" "$DEF/ICON_256.PNG" "$STAGE/"
cp -a "$DEF/cmd" "$DEF/config" "$DEF/wizard" "$STAGE/"
chmod 755 "$STAGE/config" "$STAGE/wizard" 2>/dev/null || true

echo "== 2/5 载荷 =="
cp -a "$SRC_PAYLOAD/server" "$STAGE/app/"
cp -a "$SRC_PAYLOAD/ui"     "$STAGE/app/"
cp -a "$SRC_PAYLOAD/config" "$STAGE/app/"

echo "== 3/5 剔除畸形目录（名字里带 PG 连接串）=="
find "$STAGE/app/server" -maxdepth 1 -type d -name "host=*" -exec rm -rf {} + 2>/dev/null || true

echo "== 4/5 剔除运行时 SQLite =="
rm -f "$STAGE/app/server/data"/*.db \
      "$STAGE/app/server/data"/*.db-shm \
      "$STAGE/app/server/data"/*.db-wal 2>/dev/null || true

echo "== 5/5 写入 fpk_version 并打包 =="
if [ -n "$VER" ]; then
    python3 - "$STAGE/manifest" "$VER" <<'PYEOF'
import re, sys
p, ver = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8', errors='surrogateescape').read()
s = re.sub(r'(?m)^version\s*=.*$', 'version                    = ' + ver, s, count=1)
if re.search(r'(?m)^fpk_version\s*=', s):
    s = re.sub(r'(?m)^fpk_version\s*=.*$', 'fpk_version                = ' + ver, s, count=1)
else:
    s = re.sub(r'(?m)^(checksum\s*=.*)$',
               lambda m: m.group(1) + '\nfpk_version                = ' + ver, s, count=1)
open(p, 'w', encoding='utf-8', errors='surrogateescape').write(s)
PYEOF
fi

echo "   当前版本字段:"
grep -E '^(appname|version|fpk_version|platform)' "$STAGE/manifest" | sed 's/^/     /'

mkdir -p "$OUT"
cd "$STAGE"
fnpack build -d "$STAGE"

VER_SHOWN=$(grep -E '^version' "$STAGE/manifest" | head -1 | awk -F= '{gsub(/ /,"",$2);print $2}')
PKG="$OUT/la-erp_${VER_SHOWN}_x86_64.fpk"
mv "$STAGE/la-erp.fpk" "$PKG"

echo
echo "built: $PKG"
echo "       $(stat -c%s "$PKG") bytes  md5=$(md5sum "$PKG" | cut -d' ' -f1)"
