# Project Management System

基于 Vue 3、NestJS 和 PostgreSQL 的项目协作系统，支持项目计划、任务执行、周进展、过程资料、审批、结项报告，以及可选的飞书登录和通知。

完整文档见[文档索引](docs/README.md)，包含使用说明、视觉规范、权限、接口、数据库、部署和飞书集成。

## 功能

- 工作日报、按日期已读状态与指定管理人员查看权限。
- 多人项目负责人、任务执行人与验收人，支持多级任务。
- 计划定稿、变更审批、统一审批待办与历史记录。
- 关键进展与共享资料、实际执行周次检查、合理补填记录。
- 可配置部门结项审核、立项文件辅助解析、HTML 报告与重开纠错。
- 飞书组织同步、OAuth 登录、消息卡片与只读查询机器人。
- 可选 LLM 查询与文件解析，默认关闭。

## 技术栈

前端使用 Vue 3、TypeScript、Vite、Element Plus、Pinia；后端使用 NestJS、TypeORM、PostgreSQL 15。建议使用 Node.js 22 或更新的兼容版本。

## 本地运行

1. 准备独立 PostgreSQL 开发数据库，将 server/.env.example 复制为 server/.env。
2. 设置 DB_HOST、DB_PORT、DB_USERNAME、DB_PASSWORD、DB_DATABASE，并将 JWT_SECRET 替换为自己生成的随机值。后端启动会执行迁移，请只连接预期数据库。
3. 本地演示可设置 FEISHU_MOCK_LOGIN=true 和自己选择的 FEISHU_MOCK_PASSWORD；没有内置演示密码。演示账号通过页面入口创建，默认不发送飞书通知。
4. 分别在两个终端运行：

~~~sh
cd server
npm ci
npm run dev
~~~

~~~sh
cd web
npm ci
npm run dev
~~~

前端默认 http://localhost:5173，API 默认 http://localhost:8081/api。Vite 代理 /api 到本机后端。

## 构建与 Docker

~~~sh
npm ci --prefix server
npm run build --prefix server
npm ci --prefix web
npm run build --prefix web
~~~

复制根目录 .env.example 为 .env，配置自己的数据库密码和 JWT_SECRET，然后运行 docker compose up -d --build。Dockerfile 使用已构建的 dist，必须先完成上述构建。

Web 入口为 http://localhost:8088；数据库仅绑定本机 5433 端口。数据库卷、uploads 目录与环境配置须独立备份。

## 集成配置

飞书集成需要你自己的自建应用、权限和回调地址。配置 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_REDIRECT_URI、WEB_FRONT_URL，生产环境关闭 Mock 并清空 Mock 密码。机器人、群消息、审批人及模型配置均由本环境自行设置。

LLM_ENABLED 默认 false；启用时设置自己的模型地址、模型名和密钥。启用模型功能会将查询或待解析内容发送到配置的模型服务。

## 验证

~~~sh
cd server
node -r ts-node/register/transpile-only --test test/*.test.cjs
~~~

~~~sh
cd web
node --test scripts/test-*.cjs
~~~

集成测试单独位于 server/test/*.integration.cjs，需要自行配置本机测试数据库；不要连接生产库。

当前测试存在已知失败，详见 [验证记录](docs/validation.md)；生产构建通过不代表所有业务场景已验收。

## 仓库内容

本仓库仅包含通用源码、数据库结构迁移、合成测试数据和占位配置。未包含业务数据库、组织通讯录、附件、运行日志或真实凭据。图标为本项目使用的中性几何标识。详细部署配置见 [部署说明](docs/deployment.md)。

## 第三方与素材

第三方来源、依赖许可证和分发核对项见[第三方说明](THIRD_PARTY_NOTICES.md)。本仓库未另行指定项目整体的开源许可证。
