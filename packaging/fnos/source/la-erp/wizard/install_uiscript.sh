#!/bin/bash
# LA-ERP 专业版 安装向导脚本(安装完成后由飞牛向导界面执行并回显输出)
# 参考 la-biz 同型脚本: 安装完成页向用户展示默认登录信息与后续步骤。
echo "LA-ERP 专业版 安装向导"
echo ""
echo "安装完成！"
echo ""
echo "登录信息："
echo "• 访问地址：http://设备IP:18886"
echo "• 用户名：admin"
echo "• 密码：admin123"
echo ""
echo "请登录后在「系统管理 → 用户管理」中修改默认密码"
echo "首次安装自动开通免费试用，到期前请完成软件授权激活"
echo ""

# 安装向导数据库选择结果回显（PostgreSQL 自动安装成败提示）
DATA_DIR="${TRIM_PKGVAR:-}"
if [ -n "${DATA_DIR}" ] && [ "$(cat "${DATA_DIR}/db_mode" 2>/dev/null)" = "postgres" ]; then
    PG_PORT="$(grep '^PORT=' "${DATA_DIR}/pg_credentials" 2>/dev/null | head -n1 | cut -d= -f2-)"
    echo "数据库模式：PostgreSQL（已自动安装，仅本机可访问）"
    echo "• 连接地址：127.0.0.1:${PG_PORT:-54329}  库：la_erp  用户：laerp"
    echo "• 凭据文件：${DATA_DIR}/pg_credentials（权限 600，请勿泄露）"
    echo "• 数据目录：${DATA_DIR}/pgdata（容器卷，卸载时按选项保留/删除）"
else
    echo "数据库模式：SQLite（默认，数据文件在应用数据目录）"
    if [ -n "${DATA_DIR}" ] && [ -f "${DATA_DIR}/pg_setup_status" ]; then
        echo "⚠️ 你选择了 PostgreSQL，但自动安装未成功，已回退 SQLite"
        echo "   原因：$(cat "${DATA_DIR}/pg_setup_status")"
        echo "   可修复后重试：SSH 登录后执行  bash <应用目录>/server/scripts/pg-setup.sh"
    fi
fi
