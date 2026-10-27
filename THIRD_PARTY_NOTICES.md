# 第三方依赖与素材说明

核对日期：2026-10-27。此文件记录依赖来源，不替代第三方各自的许可证，也不为本项目自动授予开源许可证。

## 仓库范围

公开仓库包含项目源码、通用说明、依赖锁文件与中性几何 SVG 图标。未纳入原组织标识、真实人员资料、内部样稿、数据库、附件、环境凭据或原仓库提交历史。node_modules、构建产物和容器镜像不随本仓库提交。

## 依赖清单

完整直接与间接依赖见[版本及许可证清单](docs/third-party-dependencies.json)，来自 server/web 的 package-lock.json。锁文件缺少许可证字段的 busboy、streamsearch 已核对安装包 LICENSE 为 MIT；duck 的 LICENSE 为两条款 BSD。第三方著作权人署名属于许可证资料，不能作为用户隐私随意删除。

| 位置 | 直接依赖 | 锁定版本 | 许可证 |
|---|---|---|---|
| server | @larksuiteoapi/node-sdk | 1.73.0 | MIT |
| server | @nestjs/cli | 10.4.9 | MIT |
| server | @nestjs/common | 10.4.22 | MIT |
| server | @nestjs/config | 3.3.0 | MIT |
| server | @nestjs/core | 10.4.22 | MIT |
| server | @nestjs/jwt | 10.2.0 | MIT |
| server | @nestjs/platform-express | 10.4.22 | MIT |
| server | @nestjs/schedule | 4.1.2 | MIT |
| server | @nestjs/schematics | 10.2.3 | MIT |
| server | @nestjs/typeorm | 10.0.2 | MIT |
| server | @resvg/resvg-js | 2.6.2 | MPL-2.0 |
| server | @types/express | 4.17.25 | MIT |
| server | @types/node | 20.19.43 | MIT |
| server | axios | 1.19.0 | MIT |
| server | class-transformer | 0.5.1 | MIT |
| server | class-validator | 0.14.4 | MIT |
| server | dotenv | 16.4.5 | BSD-2-Clause |
| server | mammoth | 1.11.0 | BSD-2-Clause |
| server | pdfjs-dist | 4.10.38 | Apache-2.0 |
| server | pg | 8.22.0 | MIT |
| server | reflect-metadata | 0.2.2 | Apache-2.0 |
| server | rxjs | 7.8.2 | Apache-2.0 |
| server | ts-node | 10.9.2 | MIT |
| server | tsconfig-paths | 4.2.0 | MIT |
| server | typeorm | 0.3.31 | MIT |
| server | typescript | 5.9.3 | Apache-2.0 |
| web | @element-plus/icons-vue | 2.3.2 | MIT |
| web | @types/node | 20.19.43 | MIT |
| web | @vitejs/plugin-vue | 5.2.4 | MIT |
| web | axios | 1.19.0 | MIT |
| web | dayjs | 1.11.21 | MIT |
| web | echarts | 5.6.0 | Apache-2.0 |
| web | element-plus | 2.14.3 | MIT |
| web | pinia | 2.3.1 | MIT |
| web | typescript | 5.9.3 | Apache-2.0 |
| web | unplugin-auto-import | 0.17.8 | MIT |
| web | unplugin-vue-components | 0.27.5 | MIT |
| web | vite | 5.4.21 | MIT |
| web | vue | 3.5.40 | MIT |
| web | vue-router | 4.6.4 | MIT |
| web | vue-tsc | 2.2.12 | MIT |

## 分发时的核对项

- 依赖许可证以对应版本原包 LICENSE、NOTICE 及源文件声明为准，安装和再分发时保留这些文件与署名。
- @resvg/resvg-js 及其平台包标注 MPL-2.0；caniuse-lite 标注 CC-BY-4.0；argparse 标注 Python-2.0。完整清单保留各包的复合许可证表达式，不将所有依赖统称为 MIT。
- Dockerfile 安装的系统组件和 Noto CJK 字体不属于 npm 清单；分发镜像时还应保留镜像内对应软件包的版权和许可资料。
- 飞书 JSSDK 由外部 CDN 加载，未把第三方 SDK 内容复制进源码；使用飞书服务时配置自己的应用并遵守其服务条件。
- 本清单是源码发布范围核对记录，不能替代未来打包产物、修改后第三方源码或新增素材的逐项检查。
