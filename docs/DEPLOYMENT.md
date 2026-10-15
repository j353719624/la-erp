# 生产部署指南

本系统是**前后端分离**：后端只提供 `/api/...`、`/uploads/...`、`/health`，
前端是 `frontend/dist` 的静态产物。两者必须由反向代理拼成同源站点 ——
前端没有 CORS 配置，直接分开部署会跨域失败。

> 适用范围：**Linux** 服务器 + nginx（`deployment/` 提供现成的配置与 unit）。
> 飞牛 fnOS 形态见 `packaging/fnos`，Docker 形态尚未产出资产。
>
> ⚠️ **Windows 上跑不了生产模式**：授权校验要先取机器唯一标识
> （`license.MachineID("/"`，读 Linux 机器标识），在 Windows 上直接失败退出
> （实测报「无法读取机器唯一标识」）。生产请部署在 Linux；
> Windows 只能带 `-dev` 做本地验证，而 `-dev` 强制绑定回环且跳过授权校验。

## 一、上线前置条件（缺一项就起不来）

| # | 条件 | 不满足的后果 |
|---|---|---|
| 1 | **授权文件** `license.key` | 生产模式默认 `license.enabled=true`，缺失或校验失败会**直接启动失败**（`requires a valid license file; trial subsystem not yet available`）。**试用期子系统尚未提供**，没有授权就用不了 |
| 2 | **JWT secret** ≥ 32 字符 | 不足 32 字符拒绝启动 |
| 3 | 数据目录可写 | SQLite、上传、导出、JWT secret 都写在这里 |
| 4 | 前端构建产物 | `cd frontend && npm ci && npm run build` → `frontend/dist` |

### 授权签发（第 1 项的操作步骤）

```sh
# 1) 在目标机器取机器码
node tools/license.mjs machine

# 2) 在保管私钥的电脑上签发（private.pem 未提交进仓库）
node tools/license.mjs sign --private private.pem \
     --machine-id <上一步的机器码> --out license.key --edition pro

# 3) 校验
node tools/license.mjs verify --public public.key --file license.key --machine-id <机器码>
```

把 `license.key` 放到配置里 `license.file` 指定的路径（默认 `data/license.key`）。

## 二、部署步骤

```sh
# 1) 构建后端
cd backend && go build -o /opt/la-erp/la-erp-server ./cmd/la-erp-server

# 2) 构建前端
cd frontend && npm ci && npm run build      # 产物在 frontend/dist

# 3) 准备配置（不要用默认口令）
cp deployment/la-erp.yaml.example /opt/la-erp/la-erp.yaml
$EDITOR /opt/la-erp/la-erp.yaml

# 4) 首次启动会初始化空库；务必指定管理员口令
export ERP_ADMIN_PASSWORD='<强口令>'

# 5) 以服务方式运行
sudo cp deployment/systemd/la-erp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now la-erp
journalctl -u la-erp -f
```

**不要加 `-dev`**：`-dev` 会强制绑定回环地址（外部访问不到）并跳过授权校验。

## 三、反向代理

```sh
sudo cp deployment/nginx/la-erp.conf /etc/nginx/conf.d/la-erp.conf
sudo nginx -t && sudo systemctl reload nginx
```

要点：

- `/api/` → 后端 `127.0.0.1:18887`；`proxy_pass` **不要带 URI**，否则会改写路径
- `/uploads/` → 直接由 nginx 提供 `data/uploads/` 静态文件，比回源到 Go 省资源
- `/` → `frontend/dist`，SPA 需 `try_files ... /index.html`
- `client_max_body_size` 要与服务端 `upload.max_size`（默认 10MB）一致，否则大图上传在 nginx 层先被拒（413）
- 前端**没有** CORS 配置，必须靠反代保证同源；直接把后端端口暴露给浏览器会不可用

## 四、备份

```sh
./deployment/backup.sh data/la-erp.db data/backups
```

- 用 SQLite 官方 `.backup` 热备，**不要直接 `cp`** 运行中的数据库文件
- 备份后自动跑 `PRAGMA integrity_check`，通不过就报错退出
- 默认保留 30 天（`KEEP_DAYS` 可调）

⚠️ **上传的图片不在数据库里**，必须另外同步 `upload.path` 目录，否则恢复后单据在、图片不在。

## 五、上线检查清单

```
[ ] 授权文件已签发并放到 license.file 路径，启动日志显示「授权校验通过」
[ ] ERP_ADMIN_PASSWORD 已设置（未设置会用默认 admin123，日志有告警）
[ ] JWT secret ≥ 32 字符，且不是示例值
[ ] 服务监听地址正确（nginx 同机可用 127.0.0.1，跨机需 0.0.0.0 + 防火墙）
[ ] nginx -t 通过，/api 与 /uploads 均可达
[ ] 前端能登录，且带尾斜杠的路径正常（回归保护见 TestTrailingSlashNormalized）
[ ] 备份脚本可执行，且已验证备份文件能打开（PRAGMA integrity_check = ok）
[ ] 上传目录已纳入备份/同步范围
[ ] 访问日志可见（LA_ERP_ACCESS_LOG 默认开启）
```

## 六、已知限制（上线前请知悉）

- **仅 SQLite**，PostgreSQL 分支未实现（会直接启动失败）
- **42 处保守拒绝分支**返回 501：折扣/价税高级组合、部分跨公司、复杂工序或序列组合、
  部分报表模式、独立汇兑损益等尚未实现的分支
- **登录失败限流**：同一用户名连续失败 10 次后冷却 5 分钟，冷却期内即使口令正确也被拒。
  运维脚本若用错误口令重试会被误锁
- **多公司 / 门户**相关路由尚未实现，不属可配置项
- 部分已知有害的输入校验（如个别数量字段的负数）**有意不兼容**，
  代码中以 `ErrOriginalDefect` 标注；接入自己的数据时请留意
