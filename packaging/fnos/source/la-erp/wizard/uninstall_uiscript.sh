#!/bin/bash
# LA-ERP 专业版 卸载向导脚本(卸载前由飞牛向导界面执行, 保存用户的数据处理选择)
# uninstall_callback 将读取本脚本生成的 uninstall_config.json 决定是否清理 @appdata 数据。
echo "LA-ERP 专业版 卸载向导"
echo ""
echo "正在保存卸载配置..."

CONFIG_DIR="$TRIM_PKGVAR"
if [ -z "$CONFIG_DIR" ]; then
    CONFIG_DIR="$HOME/.la-erp"
fi

mkdir -p "$CONFIG_DIR"

CONFIG_FILE="$CONFIG_DIR/uninstall_config.json"
cat > "$CONFIG_FILE" <<EOF
{
  "data_action": "$wizard_data_action",
  "uninstall_time": "$(date '+%Y-%m-%d %H:%M:%S')"
}
EOF

echo "配置已保存至: $CONFIG_FILE"
chmod 644 "$CONFIG_FILE"

if [ -n "$TRIM_PKGVAR" ]; then
    VAR_CONFIG_FILE="$TRIM_PKGVAR/uninstall_config.json"
    mkdir -p "$TRIM_PKGVAR"
    cat > "$VAR_CONFIG_FILE" <<EOF
{
  "data_action": "$wizard_data_action",
  "uninstall_time": "$(date '+%Y-%m-%d %H:%M:%S')"
}
EOF
    echo "配置已同步至: $VAR_CONFIG_FILE"
fi

echo "✅ 卸载配置已保存！"
