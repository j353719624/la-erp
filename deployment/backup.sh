#!/usr/bin/env bash
# LA-ERP 恢复版 · SQLite 热备份脚本
#
# 为什么不能直接 cp 数据库文件：
#   SQLite 在运行中，直接复制可能拿到「写入到一半」的页，备份文件打不开，
#   或者能打开但数据不一致。正确做法是用 SQLite 官方的 .backup 命令
#   （在线热备，内部会处理并发写入），它是原子一致的快照。
#
# 用法：
#   ./deployment/backup.sh [数据库路径] [备份目录]
#
# 定期执行（每天 2:00）：
#   0 2 * * * /opt/la-erp/deployment/backup.sh >> /var/log/la-erp-backup.log 2>&1
#
# 注意：备份只覆盖 SQLite 主库。上传目录（upload.path）里的图片文件
# 不在库内，需要另外同步，否则恢复后单据在、图片不在。

set -euo pipefail

DB="${1:-data/la-erp.db}"
DEST="${2:-data/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [[ ! -f "$DB" ]]; then
  echo "[$(date -Is)] 错误：数据库不存在 $DB" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[$(date -Is)] 错误：未找到 sqlite3 命令，请先安装（Debian/Ubuntu: apt install sqlite3）" >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$DEST/la-erp-$STAMP.db"

# ── 备份 ────────────────────────────────────────────────────
# .backup 会拿到一个一致快照；若数据库正在被写入，它会重试直到成功。
echo "[$(date -Is)] 开始备份 $DB → $TARGET"
if ! sqlite3 "$DB" ".backup '$TARGET'"; then
  echo "[$(date -Is)] 错误：备份失败" >&2
  rm -f "$TARGET"
  exit 1
fi

# ── 校验 ────────────────────────────────────────────────────
# 备份完一定要验完整性，否则可能留下一个「看起来成功、实际打不开」的文件。
if ! CHECK="$(sqlite3 "$TARGET" 'PRAGMA integrity_check;' 2>&1)"; then
  echo "[$(date -Is)] 错误：备份文件无法打开：$CHECK" >&2
  exit 1
fi
if [[ "$CHECK" != "ok" ]]; then
  echo "[$(date -Is)] 错误：备份文件完整性校验失败：$CHECK" >&2
  exit 1
fi

# 顺带记录业务量，便于事后确认备份不是空库
TABLES="$(sqlite3 "$TARGET" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"
VOUCHERS="$(sqlite3 "$TARGET" "SELECT count(*) FROM vouchers;" 2>/dev/null || echo 0)"
SIZE="$(du -h "$TARGET" | cut -f1)"

echo "[$(date -Is)] 备份完成：$TARGET"
echo "          大小=$SIZE  表数=$TABLES  凭证数=$VOUCHERS  完整性=ok"

# ── 清理旧备份 ──────────────────────────────────────────────
# 只删 .db 结尾的本脚本产物，不动目录里其他文件。
DELETED="$(find "$DEST" -maxdepth 1 -name 'la-erp-*.db' -type f -mtime +"$KEEP_DAYS" -print -delete | wc -l)"
echo "[$(date -Is)] 清理 ${KEEP_DAYS} 天前的备份：删除 $DELETED 个"

# ── 提醒 ────────────────────────────────────────────────────
echo "[$(date -Is)] 提醒：上传图片不在数据库内，请另外同步 upload.path 目录"
