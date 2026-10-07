# LA-ERP 源码与授权工具恢复

从本人原仓库的 `v1.4.51` 飞牛 FPK 安装包恢复，仓库为私有。

| 内容 | 恢复状态 |
| --- | --- |
| 前端业务源码 | 从 source map 原样提取 273 个文件，SHA256 清单在 evidence |
| 前端运行工程 | 补建 Vite、依赖锁、93 个接口类型；原 CSS 源码缺失，采用安装包编译 CSS |
| 授权签发工具 | 重建 Node.js 命令行工具和 Go 校验模块，保留签名、机器绑定、版本和到期校验 |
| Go 后端业务源码 | **尚未恢复完整源码**；安装包含混淆、去符号的 ELF，不含原 Go 项目 |
| 后端继续运行 | Release 保留原安装包，以及只替换授权公钥的恢复安装包 |
| 后端分析材料 | 123996 个函数元数据、1041 个带标签结构体（含依赖库）、14 个授权函数伪代码 |
| 原授权私钥 | 无法由公钥反推；恢复包使用新密钥，原授权不适用于恢复包 |

这是一份可继续开发的前端源码、授权工具源码、原程序备份与后端分析材料，不等同于原后端完整工程。伪代码不是可直接编译的 Go 源码。

## 前端开发

安装 Node.js 22+，在仓库目录运行：

```sh
cd frontend
npm ci
npm run typecheck
npm run build
npm run dev
```

开发代理默认连接 `http://127.0.0.1:18886`，可通过 `ERP_BACKEND_URL` 指向自己的后端。生产构建在 `frontend/dist`。原服务器内嵌的前端不会随本次构建自动更新，独立部署时需反向代理 `/api`、`/uploads`。

## 授权工具

本次恢复安装包对应的私钥只留在恢复电脑的 `outputs/la-erp-recovery/keys/private.pem`，没有提交到 GitHub。请离线备份。Release 中的 `public.key` 用于校验，不可用于签发。

在飞牛设备获取机器码（也可从原系统授权页面查看）：

```sh
node tools/license.mjs machine
```

在保管私钥的电脑签发（把命令中的路径和机器码换成实际值）：

```sh
node tools/license.mjs sign --private /secure/private.pem --machine-id YOUR_MACHINE_CODE --out license.key --edition pro
node tools/license.mjs verify --public /secure/public.key --file license.key --machine-id YOUR_MACHINE_CODE
```

不传 `--expires` 表示永久授权；限时授权使用 RFC3339，例如 `--expires 2027-12-31T23:59:59+08:00`。原程序当前校验的版本是 `pro`。通过程序授权页面导入 `license.key`。安装恢复包前备份数据库、上传文件和原安装包；飞牛实际安装、数据升级与业务流程仍需在目标设备验证。

若自行生成密钥，需要重新生成与公钥匹配的恢复包，不能只换签发私钥：

```sh
node tools/license.mjs keygen --dir /secure/new-keys
python tools/repack_fpk.py --fpk la-erp_1.4.51-repack_x86_64.fpk --public /secure/new-keys/public.key --out la-erp-new.fpk
```

## 验证与复现

```sh
npm test
cd backend
go test ./...
```

GitHub Actions 的 `Validate recovery` 检查源码。手动运行工作流另加 Linux 原程序授权集成测试（独立临时数据库，六个正反用例）；从本仓库私有 Release 下载原样本。

安装包解包及前端重新提取：

```sh
python tools/unpack_fpk.py la-erp_1.4.51-repack_x86_64.fpk extracted
node tools/recover_frontend.mjs extracted/server/dist recovered-verbatim
node tools/analysis/inspect-elf.cjs extracted/server/la-erp-server analysis
node tools/analysis/parse-go.cjs extracted/server/la-erp-server analysis
python tools/analysis/parse-types.py extracted/server/la-erp-server analysis
```

详细证据、限制与恢复路径见 [恢复报告](docs/2026-10-08_逆向-la-erp-report.md)。`packaging/fnos` 原样保留原仓库包装脚本，其说明可能仍引用丢失的 Go 工程，不能用它重新编译全部后端。
