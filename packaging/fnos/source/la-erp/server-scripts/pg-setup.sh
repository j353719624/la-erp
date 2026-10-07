#!/bin/bash
# ============================================================
# LA-ERP PostgreSQL 自动安装/管理脚本（2026-09-17）
# ============================================================
# 用途：在 fnOS 生命周期脚本（install_callback 等）或 SSH 手动模式下，
#       通过 Docker 一键准备一个独占的 PostgreSQL 容器（仅监听本机回环地址），
#       供 LA-ERP 切换到 PostgreSQL 模式使用。
#
# 特性：
#   - 幂等：重复执行 = 复用现有容器/凭据，不会重复创建
#   - 隔离：容器名按**应用**派生（<appname>-pg，如 la-erp-pg / la-erp-lite-pg）独占；
#     端口默认 127.0.0.1:54329（仅本机可访问，被占用时自动改用 54330/54331）
#   - 数据：挂在应用数据目录（@appdata/pgdata），随应用卸载策略保留/删除
#   - 兜底：任一环节失败不中断安装，写入失败原因（pg_setup_status），由向导提示回退 SQLite
#
# 用法：
#   pg-setup.sh                 # 安装/确保就绪（写凭据 + db_mode 标记；失败写状态文件）
#   pg-setup.sh --check         # 仅检查（0=就绪 / 1=未就绪 / 2=环境不可用）
#   pg-setup.sh --status        # 打印当前状态与连接信息
#   pg-setup.sh --stop          # 停止容器（不删除数据）
#   pg-setup.sh --print-config  # 输出可粘贴到 config.yaml 的 database 段
#   pg-setup.sh --sync-credentials  # 修复凭据失真：以 pg_credentials 为准重设数据库密码（含自测）
#
# 环境变量：
#   TRIM_PKGVAR      fnOS 应用数据目录（安装/运行脚本自动注入）
#   LAERP_DATA_DIR   覆盖数据目录（本地调试用，等价 TRIM_PKGVAR）
#   LAERP_PG_PORT    覆盖宿主端口（默认 54329，冲突时脚本自动尝试 54330/54331）
# ============================================================
set -u

DATA_DIR="${TRIM_PKGVAR:-${LAERP_DATA_DIR:-$HOME/.la-erp}}"
# 容器名按**应用**派生（2026-09-23 x86 真机 P1：同机装专业版 + Lite 时硬编码同名
# 会互相复用/删除对方的容器 —— 专业版升级触发卸载钩子把 Lite 的 PG 删了 → Lite 连不上库）。
# 专业版 @appdata/la-erp → la-erp-pg（保持历史名，兼容已装机器）；Lite → la-erp-lite-pg。
CONTAINER="${LAERP_PG_CONTAINER:-$(basename "$DATA_DIR")-pg}"
IMAGE="postgres:16-alpine"
DEFAULT_PORT="${LAERP_PG_PORT:-54329}"
FALLBACK_PORTS="54330 54331"
DB_NAME="la_erp"
DB_USER="laerp"
CRED_FILE="$DATA_DIR/pg_credentials"
CONFIG_FILE="$DATA_DIR/config.yaml"
MODE_FILE="$DATA_DIR/db_mode"
STATUS_FILE="$DATA_DIR/pg_setup_status"
LOG_FILE="$DATA_DIR/pg_setup.log"

mkdir -p "$DATA_DIR" 2>/dev/null || true

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE" 2>/dev/null
    echo "$1"
}

fail() {
    log "PostgreSQL 准备失败: $1"
    echo "fallback:$1" > "$STATUS_FILE" 2>/dev/null || true
    # 失败不影响安装流程：退出码 0（--check 模式另有语义）
    exit 0
}

find_docker() {
    if command -v docker >/dev/null 2>&1; then
        command -v docker
        return 0
    fi
    for p in /usr/bin/docker /usr/local/bin/docker /opt/docker/bin/docker; do
        if [ -x "$p" ]; then
            echo "$p"
            return 0
        fi
    done
    return 1
}

read_cred() { # read_cred KEY -> value
    grep "^$1=" "$CRED_FILE" 2>/dev/null | head -n1 | cut -d= -f2-
}

gen_password() {
    # 纯字母数字 24 位（避免 DSN/URL 转义问题）
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24
}

container_state() { # 输出 running/exited/"" (不存在)
    local docker_bin="$1"
    "$docker_bin" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | tr -d '[:space:]'
}

wait_ready() { # wait_ready DOCKER_BIN TIMEOUT_SEC
    local docker_bin="$1" timeout="${2:-90}" i=0
    while [ "$i" -lt "$timeout" ]; do
        if "$docker_bin" exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    return 1
}

# scram_ok PASSWORD CONTAINER_IP：经**容器网络**（非本机 trust，命中 scram-sha-256）
# 验证密码真实可用。用于凭据一致性自测（本机 127.0.0.1 是 trust，无法用于验证）。
scram_ok() {
    "$DOCKER_BIN" exec -e PGPASSWORD="$1" "$CONTAINER" psql -h "$2" -U "$DB_USER" \
        -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1
}

# 读取 config.yaml 里 database.dsn 的密码（应用实际使用的真相源，用于对齐凭据文件）
read_config_dsn_password() {
    [ -f "$CONFIG_FILE" ] || return 1
    grep -E '^[[:space:]]*dsn:' "$CONFIG_FILE" 2>/dev/null | head -n1 \
        | grep -oE 'password=[^ ]+' | head -n1 | cut -d= -f2-
}

# 写凭据文件（单一入口，保证权限 600）
write_cred() { # write_cred PASSWORD PORT
    { echo "USER=$DB_USER"; echo "DB=$DB_NAME"; echo "PASSWORD=$1"; echo "PORT=$2"; } > "$CRED_FILE"
    chmod 600 "$CRED_FILE" 2>/dev/null || true
}

status_cmd() {
    if [ -f "$MODE_FILE" ] && [ "$(cat "$MODE_FILE" 2>/dev/null)" = "postgres" ]; then
        echo "数据库模式: PostgreSQL"
        echo "容器: $CONTAINER"
        echo "连接: host=127.0.0.1 port=$(read_cred PORT) dbname=$(read_cred DB) user=$(read_cred USER)"
        echo "凭据文件: $CRED_FILE"
    else
        echo "数据库模式: SQLite（默认）"
        [ -f "$STATUS_FILE" ] && echo "PG 上次准备失败: $(cat "$STATUS_FILE")"
    fi
}

check_cmd() {
    local docker_bin
    docker_bin="$(find_docker)" || { echo "未找到 docker"; exit 2; }
    "$docker_bin" info >/dev/null 2>&1 || { echo "docker 服务不可用"; exit 2; }
    [ "$(container_state "$docker_bin")" = "true" ] || { echo "容器未运行"; exit 1; }
    "$docker_bin" exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 || { echo "PG 未就绪"; exit 1; }
    echo "PostgreSQL 就绪"
    exit 0
}

print_config_cmd() {
    local port pw
    port="$(read_cred PORT)"; pw="$(read_cred PASSWORD)"
    [ -n "$port" ] || port="$DEFAULT_PORT"
    echo "database:"
    echo "  driver: postgres"
    echo "  dsn: \"host=127.0.0.1 port=${port} user=${DB_USER} password=${pw} dbname=${DB_NAME} sslmode=disable TimeZone=Asia/Shanghai\""
    exit 0
}

# --sync-credentials：把**数据库真实密码**对齐为 pg_credentials 中记录的密码。
# 用途：历史版本在「容器被重建但数据目录仍在」时写入了新密码、而数据库实际未改
# （见主流程注释），此时凭据文件失真 → 运维按凭据 pg_dump/psql 会认证失败。
# 本命令用本机 trust 通道（pg_hba: 127.0.0.1/socket trust）执行 ALTER USER，
# 使「数据库 / pg_credentials / config.yaml」三者以 pg_credentials 为单一真相源；
# 完成前先做 scram 自测，失败不改动任何文件。
sync_credentials_cmd() {
    local docker_bin pw ip port
    docker_bin="$(find_docker)" || { echo "未找到 Docker"; exit 2; }
    "$docker_bin" info >/dev/null 2>&1 || { echo "Docker 服务不可用或无权限"; exit 2; }
    if [ ! -f "$CRED_FILE" ]; then
        echo "凭据文件不存在: $CRED_FILE"
        exit 2
    fi
    pw="$(read_cred PASSWORD)"
    port="$(read_cred PORT)"
    if [ -z "$pw" ]; then
        echo "凭据文件缺少 PASSWORD"
        exit 2
    fi

    if [ "$(container_state "$docker_bin")" != "true" ]; then
        echo "PostgreSQL 容器未运行，尝试启动..."
        "$docker_bin" start "$CONTAINER" >/dev/null 2>&1 || { echo "容器启动失败"; exit 1; }
    fi
    wait_ready "$docker_bin" 60 || { echo "PostgreSQL 未就绪（pg_isready 超时）"; exit 1; }

    if ! "$docker_bin" exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
            -c "ALTER USER $DB_USER PASSWORD '$pw';" >/dev/null 2>&1; then
        echo "重设密码失败：无法经本机 trust 通道执行 ALTER USER"
        exit 1
    fi

    ip="$("$docker_bin" inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER" 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$ip" ]; then
        echo "无法取得容器地址，无法做 scram 自测"
        exit 1
    fi

    # ① 优先采用 config.yaml 的密码（应用实际在用的那个）：若它可用，
    #    只需修正凭据文件 —— **不动数据库**，零风险（历史失真愈合的首选路径）
    local cfg_pw
    cfg_pw="$(read_config_dsn_password)"
    if [ -n "$cfg_pw" ] && scram_ok "$cfg_pw" "$ip"; then
        write_cred "$cfg_pw" "${port:-$DEFAULT_PORT}"
        echo "已按 config.yaml 的密码对齐凭据文件（数据库与 config.yaml 均未改动）"
        echo "scram 自测通过：$CRED_FILE"
        exit 0
    fi

    # ② 否则以凭据文件为准重设数据库密码（本机 trust 通道免密执行 ALTER）
    if ! "$docker_bin" exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
            -c "ALTER USER $DB_USER PASSWORD '$pw';" >/dev/null 2>&1; then
        echo "重设密码失败：无法经本机 trust 通道执行 ALTER USER"
        exit 1
    fi

    if scram_ok "$pw" "$ip"; then
        echo "已同步：数据库密码 = pg_credentials 记录（scram 自测通过）"
        echo "⚠️ 请确认 config.yaml 的 database.dsn 密码与此一致：$CRED_FILE"
        exit 0
    fi
    echo "警告：密码已重设但 scram 自测未通过，请人工核对容器与凭据"
    exit 1
}

case "${1:-install}" in
    --check) check_cmd ;;
    --status) status_cmd; exit 0 ;;
    --print-config) print_config_cmd ;;
    --sync-credentials) sync_credentials_cmd ;;
    --stop)
        docker_bin="$(find_docker)" || fail "未找到 docker"
        "$docker_bin" stop "$CONTAINER" >/dev/null 2>&1 || true
        echo "PostgreSQL 容器已停止（数据保留在 $DATA_DIR/pgdata）"
        exit 0
        ;;
esac

# ============ 主流程：安装 / 确保就绪 ============
DOCKER_BIN="$(find_docker)" || fail "未找到 Docker（fnOS 请在应用中心安装「容器」/Docker 功能后重试）"
"$DOCKER_BIN" info >/dev/null 2>&1 || fail "Docker 服务未运行或无权限（请确认设备已启用 Docker）"

# 存量容器迁移（2026-09-23）：旧版本容器名统一为 la-erp-pg，同机两应用会撞名。
# 若**目标名**不存在，但存在**挂载本应用 pgdata** 的容器 → docker rename 复用
# （数据/端口/凭据全部不变，零破坏；避免重建容器或误用别的应用的库）。
PGDATA_DIR="$DATA_DIR/pgdata"
if ! "$DOCKER_BIN" inspect "$CONTAINER" >/dev/null 2>&1; then
    for EXISTING in $("$DOCKER_BIN" ps -a --format '{{.Names}}' 2>/dev/null); do
        if "$DOCKER_BIN" inspect -f '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' "$EXISTING" 2>/dev/null \
                | grep -Fxq "$PGDATA_DIR"; then
            if "$DOCKER_BIN" rename "$EXISTING" "$CONTAINER" >/dev/null 2>&1; then
                log "检测到本应用既有 PostgreSQL 容器（$EXISTING → $CONTAINER），改名复用"
            else
                log "警告: 容器 $EXISTING 归属本应用但改名失败（可能重名），将按 $CONTAINER 走后续流程"
            fi
            break
        fi
    done
fi

STATE="$(container_state "$DOCKER_BIN")"

if [ "$STATE" = "true" ] || [ "$STATE" = "false" ]; then
    # 容器已存在（运行中或已停止）：复用；停止态先拉起
    if [ "$STATE" = "true" ]; then
        log "检测到已有 PostgreSQL 容器运行中，复用"
    else
        log "检测到 PostgreSQL 容器已停止，启动中..."
        "$DOCKER_BIN" start "$CONTAINER" >/dev/null 2>&1 || fail "容器启动失败"
    fi
    # 凭据自愈：应用数据目录被清空但容器残留（重装场景）时，重设容器内密码并重建凭据
    if [ ! -f "$CRED_FILE" ]; then
        PW="$(gen_password)"
        if "$DOCKER_BIN" exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "ALTER USER $DB_USER PASSWORD '$PW';" >/dev/null 2>&1; then
            EXIST_PORT="$(read_cred PORT)"
            { echo "USER=$DB_USER"; echo "DB=$DB_NAME"; echo "PASSWORD=$PW"; echo "PORT=${EXIST_PORT:-$DEFAULT_PORT}"; } > "$CRED_FILE"
            chmod 600 "$CRED_FILE" 2>/dev/null || true
            log "凭据文件缺失，已在容器内重设密码并重建凭据文件"
        else
            fail "容器在运行但凭据缺失且无法重设密码"
        fi
    fi
    wait_ready "$DOCKER_BIN" 90 || fail "容器在运行但 PostgreSQL 未就绪（pg_isready 超时）"
else
    # 全新创建：拉镜像 + 端口冲突时自动换端口
    # ⚠️ 必须先检查**本地镜像**（2026-09-23 x86 真机实测）：旧实现无条件 `docker pull`，
    #    即使镜像已在本地也会联网校验 manifest；离线/弱网下直接失败 → 白白回退 SQLite
    #    （而镜像明明可用）。fnOS 用户常已预拉过镜像，本地命中是常态。
    if "$DOCKER_BIN" image inspect "$IMAGE" >/dev/null 2>&1; then
        log "本地已存在镜像 $IMAGE，跳过拉取"
    else
        log "首次安装 PostgreSQL：拉取镜像 $IMAGE（约 100MB，需联网）..."
        if ! "$DOCKER_BIN" pull "$IMAGE" >/dev/null 2>&1; then
            "$DOCKER_BIN" pull "$IMAGE" >/dev/null 2>&1 \
                || { "$DOCKER_BIN" image inspect "$IMAGE" >/dev/null 2>&1 \
                     && log "拉取失败但本地已有镜像，继续" \
                     || fail "镜像拉取失败（请检查网络/镜像加速后重试；离线部署可先执行: docker pull $IMAGE）"; }
        fi
    fi

    PW="$(gen_password)"
    PGDATA_DIR="$DATA_DIR/pgdata"
    mkdir -p "$PGDATA_DIR" 2>/dev/null || true

    # ⚠️ 关键（2026-09-23 x86 真机实测 P1）：**容器不存在 ≠ 数据库是新的**。
    #    升级 / 「保留数据重装」时平台会先移除容器，而 pgdata 仍在 —— postgres 官方入口
    #    脚本见到已初始化的数据目录会**跳过 initdb**（POSTGRES_PASSWORD 被忽略），
    #    数据库真实密码仍是首次 initdb 时那个。旧实现此时新生成密码并写入 pg_credentials，
    #    而 config.yaml 不被覆盖 → **凭据文件与实际密码不一致**（真机实测：凭据密码 scram
    #    认证失败、config.yaml 密码可用）。后果：运维按 pg_credentials 执行 pg_dump/psql
    #    必然失败；且一旦数据目录被清空重建就会用「错」密码 initdb → 应用连不上 PG。
    #    修法：数据目录已初始化时**复用既有凭据密码**，不重写凭据文件。
    REUSE_CRED=""
    SYNC_AFTER=""
    if [ -f "$PGDATA_DIR/PG_VERSION" ]; then
        PW="$(read_cred PASSWORD)"
        if [ -n "$PW" ]; then
            REUSE_CRED=1
            log "检测到已有 PostgreSQL 数据目录（升级/保留数据重装），复用既有凭据密码"
        else
            PW="$(gen_password)"
            SYNC_AFTER=1
            log "检测到已有数据目录但凭据缺失：容器就绪后将重设密码并重建凭据文件"
        fi
    fi

    # 端口：复用数据时**优先沿用凭据记录的端口**（config.yaml 不被覆盖，
    # 换端口会让应用连不上；只有被占用才回退尝试其它端口，并显式告警）
    PORT_PREF="$(read_cred PORT)"
    [ -n "$PORT_PREF" ] || PORT_PREF="$DEFAULT_PORT"

    STARTED=""
    for P in "$PORT_PREF" $DEFAULT_PORT $FALLBACK_PORTS; do
        if "$DOCKER_BIN" run -d --name "$CONTAINER" \
            --restart unless-stopped \
            -e POSTGRES_USER="$DB_USER" \
            -e POSTGRES_PASSWORD="$PW" \
            -e POSTGRES_DB="$DB_NAME" \
            -e POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C" \
            -e TZ=Asia/Shanghai \
            -p "127.0.0.1:${P}:5432" \
            -v "$PGDATA_DIR:/var/lib/postgresql/data" \
            "$IMAGE" >/dev/null 2>&1; then
            STARTED="$P"
            break
        fi
        # 端口冲突等：清理半成品后尝试下一个端口
        "$DOCKER_BIN" rm -f "$CONTAINER" >/dev/null 2>&1 || true
    done
    [ -n "$STARTED" ] || fail "容器创建失败（端口 54329-54331 可能被占用）"

    log "容器已创建（端口 127.0.0.1:${STARTED}），等待数据库就绪..."
    wait_ready "$DOCKER_BIN" 120 || fail "PostgreSQL 启动超时（可查看 docker logs $CONTAINER）"

    if [ -n "$SYNC_AFTER" ]; then
        # 已有数据目录（initdb 被跳过）：显式对齐密码。
        # 本机回环/socket 为 trust（见 pgdata/pg_hba.conf），可免密执行 ALTER。
        if ! "$DOCKER_BIN" exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
                -c "ALTER USER $DB_USER PASSWORD '$PW';" >/dev/null 2>&1; then
            fail "已有数据目录但无法对齐数据库密码（凭据将失真，请人工核对 pg_credentials）"
        fi
    fi

    if [ -n "$REUSE_CRED" ]; then
        # 复用凭据：**不重写** CRED_FILE（凭据是单一真相源，其密码与库内一致）
        if [ "$STARTED" != "$PORT_PREF" ]; then
            write_cred "$PW" "$STARTED"
            log "⚠️ 端口由 ${PORT_PREF} 变更为 ${STARTED}：已更新凭据，请同步 config.yaml 的 database.dsn 端口"
        else
            log "PostgreSQL 容器已按既有数据重建（凭据沿用 $CRED_FILE，未改动）"
        fi
    else
        write_cred "$PW" "$STARTED"
        log "PostgreSQL 首次安装完成（数据库 $DB_NAME / 用户 $DB_USER / 端口 $STARTED）"
    fi

    # 凭据一致性自测 + 自动对齐：
    #   ① 凭据密码经 scram 可用 → 一致，无事
    #   ② 否则若 config.yaml 的密码可用（= 应用实际在用的那个）→ 以它为准修正凭据文件
    #      （**不动数据库、不动 config.yaml**，零风险）；历史版本造成的失真即由此自动愈合
    #   ③ 两者都不可用 → 只告警不阻断，并留下修复指令
    CRED_IP="$("$DOCKER_BIN" inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$CRED_IP" ]; then
        if scram_ok "$PW" "$CRED_IP"; then
            log "凭据自测通过（scram 认证可用）"
        else
            CFG_PW="$(read_config_dsn_password)"
            if [ -n "$CFG_PW" ] && scram_ok "$CFG_PW" "$CRED_IP"; then
                write_cred "$CFG_PW" "$STARTED"
                log "凭据文件与数据库不一致，已按 config.yaml 的密码修正 $CRED_FILE（数据库与 config.yaml 均未改动）"
            else
                log "⚠️ 凭据自测失败：$CRED_FILE 记录的密码与数据库实际密码不一致"
                log "   修复：bash $0 --sync-credentials（以凭据文件为准重设数据库密码）"
            fi
        fi
    fi
fi

echo "postgres" > "$MODE_FILE" 2>/dev/null || fail "写入数据库模式标记失败"
rm -f "$STATUS_FILE" 2>/dev/null || true
log "PostgreSQL 模式已就绪（配置将在首次启动时生成；已有 config.yaml 不会被覆盖）"
exit 0
