# LA-ERP

一套自部署的企业资源计划系统：Go 后端 + React 前端，默认单文件 SQLite，数据完全本地化。
一套系统覆盖购销、库存、生产、财务、报表与审批，支持飞牛 fnOS 打包部署与 Linux 服务器部署。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 购销 | 采购订单、销售订单、报价单、采购申请/询价、购销合同、退货单、价目表（客户专属价/阶梯价） |
| 库存 | 多仓库/库位、批次与序列号、FIFO/FEFO 策略、仓间调拨、库存调整、盘点差异、组装拆解、借出寄售、库存流水全程追溯 |
| 生产 | 多级 BOM、工艺路线、生产工单与工序跟踪、领料/退料、生产入库、外协加工、返工单、设备/模具/班组 |
| 财务 | 复式记账凭证、应收应付、收付款核销、费用报销、税金计提与增值税结转、月末结账/反结账、资产负债表/利润表 |
| 报表 | 销售/采购/库存/生产/财务全维度报表 + 仪表盘；销售按商品/客户、销售趋势与利润、采购趋势与价格趋势、库存余额/ABC、试算平衡/利润表/资产负债表/总账 |
| 计划 | MRP 需求计算与采购建议、MPS 主生产计划、工单批量生成、工作中心产能负荷 |
| 提效 | 条码扫码开单、多规格批量录入、单据一键复制、打印中心（A4/标签/条码/套打）、Excel/CSV 导入导出 |
| 安全与运维 | 角色权限、部门数据隔离、操作日志、数据备份、自定义字段与动态实体、数据字典、单号规则 |

后端为元数据驱动 + 配置化架构：162 张表由 `backend/internal/database/schema.sql` 定义，
多数资源通过统一的读写路由暴露，新增实体通常只需要补 schema 与业务规则。

## 技术栈

- **后端**：Go（`net/http` + `database/sql`），SQLite 单文件零配置，可选 PostgreSQL
- **前端**：React 18 + TypeScript + Vite + Ant Design，自适应手机/平板，支持 PWA 安装
- **授权**：Ed25519 签名 + 机器码绑定 + 版本与到期校验（`backend/license`、`tools/license.mjs`）

## 目录结构

```
backend/     Go 服务：internal/api（路由与业务）、internal/business、internal/database、license
frontend/   React 前端（Vite）
deployment/ nginx 配置、systemd unit、备份脚本
packaging/  飞牛 fnOS 应用打包源码
tools/      授权签发工具与本地静态审计脚本
tests/      端到端冒烟脚本
docs/       部署与项目范围文档
```

## 快速开始

### 后端

需要 Go 1.21+。

```sh
cd backend
go build -o la-erp-server ./cmd/la-erp-server
./la-erp-server -dev        # 开发模式：只监听回环地址，跳过授权检查
```

首次启动会在空库上建表并导入演示基础资料，创建管理员账号 `admin`，初始口令 `admin123`
（可用环境变量 `ERP_ADMIN_PASSWORD` 指定）。已有用户时不再导入演示数据。
JWT 密钥首次随机生成，保存在数据库旁的 `.jwt.secret`，重启后复用。

**生产模式默认启用授权校验**，缺少 `data/license.key` 会直接启动失败；生产模式不支持 Windows。

完整部署步骤（反向代理、systemd、热备份、检查清单）见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

### 前端

需要 Node.js 22+。

```sh
cd frontend
npm ci
npm run typecheck
npm run build
npm run dev
```

开发代理默认连接 `http://127.0.0.1:18886`，可用 `ERP_BACKEND_URL` 指向自己的后端。
生产构建产物在 `frontend/dist`。前端不带 CORS 配置，独立部署时必须用反向代理把
`/api` 与 `/uploads` 同源转发。

## 测试

```sh
npm test              # 前端与桌面桥接
cd backend && go test ./...
```

后端测试自带临时数据库，不需要外部服务。部分深度回归用例依赖运行快照
（`evidence/`），该目录不随仓库分发；快照缺失时这些用例会自动跳过，
因此干净检出执行 `go test ./...` 仍然全绿。需要启用时把快照放到仓库外的
`evidence/`，或调整 `backend/internal/api/evidence_snapshot_test.go` 里的 `evidenceRoot`。

## 授权

授权文件按机器码绑定，支持永久与限时两种形态（限时用 RFC3339，例如
`--expires 2027-12-31T23:59:59+08:00`）。

获取目标设备机器码：

```sh
node tools/license.mjs machine
```

在保管私钥的电脑上签发并校验：

```sh
node tools/license.mjs sign --private /secure/private.pem --machine-id YOUR_MACHINE_CODE --out license.key --edition pro
node tools/license.mjs verify --public /secure/public.key --file license.key --machine-id YOUR_MACHINE_CODE
```

生成新密钥对：

```sh
node tools/license.mjs keygen --dir /secure/new-keys
```

私钥只应留在签发机上并离线备份，不要提交到仓库。公钥用于校验，不能用于签发。
Windows 用户也可以用图形化生成器：源码在 `tools/desktop/LicenseGenerator.cs`，
构建命令 `powershell -ExecutionPolicy Bypass -File tools/desktop/build.ps1`。

## 部署

- **Linux 服务器**：`deployment/systemd/la-erp.service` + `deployment/nginx/la-erp.conf`
  + `deployment/backup.sh`（SQLite 热备 + `PRAGMA integrity_check` + 保留策略）
- **飞牛 fnOS**：`packaging/fnos` 提供应用打包源码与构建脚本

注意：上传的图片**不在数据库内**（存放在 `<upload.path>/images/`），
备份数据库不等于备份图片，图片目录需要另外同步。

## 当前边界

以下方向仍在开发中，尚未实现的接口会返回明确的 `501` 而不是假装可用：

- 多公司/多租户、客户门户、自定义审批流
- 部分高级财务分支（多币种收付款、汇兑损益、费用报销与工资折旧的完整过账）
- 部分库存分支（批次/序列号在多场景下的联动、多仓成本选择）

## 许可

本项目代码以仓库根目录的许可声明为准。部署与二次开发请自行评估目标环境的数据合规要求。
