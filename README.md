# Project Management System

基于 Vue 3、NestJS 和 PostgreSQL 的通用项目协作代码备份，包含计划、任务、过程记录、审批、周报及可选飞书集成。名称、人员和项目样例均为占位内容；部门审核默认清单为通用示例，使用时应按自身需求配置。

## 本地运行

1. 准备独立 PostgreSQL 15 数据库。复制 server/.env.example 为 server/.env，设置自己的数据库连接和随机 JWT_SECRET。
2. 分别在 server、web 目录执行 npm ci，再执行 npm run dev。前端为 http://localhost:5173，API 为 http://localhost:8081/api。
3. 后端启动会自动执行迁移；只能连接你明确指定的开发数据库。演示登录默认关闭，启用时自行设置 FEISHU_MOCK_LOGIN 和 FEISHU_MOCK_PASSWORD。
4. 可选的飞书及模型集成需要自己的应用、回调地址及密钥；不要提交真实配置。

## 构建

分别执行 npm run build --prefix server 和 npm run build --prefix web。Dockerfile 复制已构建的 dist；先完成构建，再用自行填写的根目录 .env 执行 docker compose up -d --build。

## 文档与备份范围

- [功能范围](docs/01-需求与范围.md)
- [数据库结构](docs/04-数据库设计.md)
- [接口概览](docs/05-接口设计.md)
- [可选消息集成](docs/06-飞书对接.md)

不包含真实配置、数据库、附件、运行日志、原始图标、组织通讯录和源仓库历史。备份从一个独立根提交开始；后续更新应继续使用脱敏副本，不向此仓库合并源仓库分支。

## 许可证

此仓库用于代码备份，未授予项目整体的开源许可。第三方依赖和素材的原始许可及署名保持有效，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
