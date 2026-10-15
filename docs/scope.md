# 项目范围

LA-ERP 是一套自部署的企业资源计划系统，代码托管在 `j353719624/la-erp`。

## 包含

- `backend/`：Go 服务，SQLite 单文件存储，元数据驱动路由，业务写入与会计过账同事务
- `frontend/`：React + TypeScript 前端（Vite 构建）
- `deployment/`：nginx 配置、systemd unit、备份脚本
- `packaging/`：飞牛 fnOS 应用打包源码
- `tools/`：授权签发命令行工具、代码审计与接口盘点脚本
- `tests/`：端到端冒烟脚本

## 不包含

- 数据库文件与运行时数据（`data/`、`.jwt.secret`）
- 上传的图片与附件（`uploads/`）
- 私钥与授权文件（`*.pem`、`license.key`）
- 运行快照与回归基线（`evidence/`，不随仓库分发）

## 边界

项目只处理本仓库内的源码与部署资产。部署到实际设备、导入既有数据库、
数据迁移与业务验收由使用方在目标环境自行完成。
