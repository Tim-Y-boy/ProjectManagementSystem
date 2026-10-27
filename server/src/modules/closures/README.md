# 结项与报备模块

核对日期：2026-10-27。描述当前工作区代码（含未提交修改），不作为线上部署或测试通过证明。

业务流程、智能解析、部门规则、历史兼容、报告模板与 KPI 边界统一维护于 [结项与报备](../../../../docs/21-项目结项推送人力资源部（奖惩报备）方案.md)，权限见 [权限模型](../../../../docs/03-权限模型.md)。新申请 workflow.version=3，历史 version=2 保留自选审核及转交，无 workflow 保持旧单级审批。

## 首次上线与配置核对

1. 备份数据库与 uploads，按部署说明安装锁定依赖并构建；启动时执行未应用迁移，包含 AddClosureIntelligence。
2. 在“结项审核规则”核对部门映射及负责人。迁移仅匹配唯一同名部门，不创建部门或指定人员；HR 不可停用或改为条件审核。
3. 核对 LLM 配置、解析失败手工通道、提交人跳过自审与共同负责人规则；规则或文件变化后重新核实范围。
4. 使用脱敏 PDF/DOCX 验证背景和目标辅助填写、实际成果保留、待确认阻止提交、草稿恢复、审核清单和总经理终审。真实模型准确率与飞书触达单独验收。

## 数据与事务

迁移 1789603200000-AddProjectClosures.ts 增加 projects.closure_state、project_closures、closure_notices、project_delay_records、closure_access_logs。

1789689600000-CompleteClosureWorkflow.ts 增加 project_plan_baselines、closure_reopens、closure_hr_grants、closure_followups，以及撤回/作废等字段。部分表直接由迁移 SQL 管理，没有对应实体，不能开启 synchronize 代替迁移。

1800500000000-AddClosureApplicationFiles.ts 新增立项书表 closure_application_files；文件位于 uploads/closure-charters，申请快照保存已选择的文件元数据。未提交草稿附件记录随可删除项目级联删除，不改变正式结项留档表的保留规则。文件目录应随现有 uploads 持久化和备份。

新表单存入 snapshot.application；部门审核范围、清单、结果、阶段、轮次和事件存入 snapshot.workflow（新申请 version=3；历史自选审核 version=2），终审通过时复制到固定 report。审核和转交使用同一项目事务锁，拒绝旧单及重复操作。

首次定稿计划原子保存，后续解锁不覆盖；旧项目缺失基准不伪造。项目级 PostgreSQL advisory lock 将结项与写操作互斥，忙时返回 409。批准复核任务依据，重复操作不生成第二份报告。

延期台账在北京时间 08:00 调度及业务写入相关路径采集，保存当时事实，不因计划变更覆盖。启用前已删除/覆盖的信息无法恢复。历史合理补填核查优先取标记日志中的截止，无日志时用当前截止作核查线索并注明。

## 配置

| 配置 | 用途 |
|---|---|
| PLAN_FINAL_APPROVER_USER_ID | 可选，本环境启用的总经办审批人本地 ID |
| PROJECT_GM_DEPT_NAME | 未指定 ID 时解析部门负责人，默认总经办 |
| PROJECT_HR_NOTIFY_USER_ID | 可选，本环境 HR 收件人本地 ID |
| PROJECT_HR_DEPT_NAME | 未指定 HR ID 时解析部门负责人，默认人力资源部 |
| WEB_FRONT_URL | 用户可访问根地址；兼容 APP_PUBLIC_URL、FRONTEND_URL |
| FEISHU_NOTIFY_DISABLED | true 禁止真实通知 |
| FEISHU_GROUP_NOTIFY_DISABLED | true 只禁止真实群通知 |
| FEISHU_NOTIFY_REDIRECT_USER_ID | 个人通知测试转发，不能转移审批/知晓权限 |

不在文档中指定真实测试账号或固定人员 ID。修改环境配置需重启；历史申请已固定的审批人不随配置变更。总经办解析不到唯一启用人时阻止申请/补填标记；HR 缺失不阻止结项，待配置后补发。

## 通知与访问

closure_notices 按事件键和收件人去重；每两分钟扫描投递，失败 30 分钟后重试；具体发送尝试写 notifications。网络送达后本地回写失败仍可能重复触达，不宣称外部消息恰好一次。

审核完成后的原卡片状态回写独立重试，失败不回滚业务审批。详见 [飞书通知](../../../../docs/06-飞书对接.md)。

报告读取允许对应项目负责人、指定审批/通知接收人、当前总经办和 HR 负责人、admin/leader 及有效 HR 阅览授权。确认只允许对应收件人。导出和附件下载验证权限并记录 closure_access_logs。HR 授权不赋予修改项目、审批或代确认权限。

## API

统一前缀 /api/closures，成功 JSON 按系统响应包装；文件下载为文件响应。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | / | 授权范围内申请/报告列表 |
| GET/POST | /rules | 当前审核规则／保存配置；admin/leader/dept_head |
| GET/POST | /projects/:id/analysis | 查询最新解析／启动异步解析 |
| POST | /projects/:id/draft | 保存本人申请草稿 |
| GET | /ready | 当前负责的已完成待结项项目，不能据此推导管理员所有项目的申请权限 |
| GET | /projects/:id/preview | admin/项目负责人预检 |
| POST | /projects/:id | admin/项目负责人申请；必填 background、objective、outcome 及 scope（identity/version/projectDeptId/heads/decisions，可关联 analysisId）；charterFileIds 非空或 noCharterReason 必填；兼容可选 delayReason/overdueReason |
| POST | /projects/:id/charters | admin/项目负责人上传立项书，multipart file；单份非空且不超过 50 MB，冻结项目不可上传 |
| GET | /:id/charters/:fileId/download | 经申请／报告读取授权下载该快照中的立项书 |
| GET | /:id | 申请/报告详情，当前知晓状态独立附加 |
| POST | /:id/approve | 当前待审核人通过，comment 必填，version=3 还需 checklists；全员通过后仅指定总经理可终审，终审意见可选 |
| POST | /:id/reject | 当前待审核人或终审阶段的指定总经理退回，comment 必填 |
| POST | /:id/transfer | 仅历史 version=2 当前待审核人转交；userId、reason 必填；version=3 拒绝转交 |
| POST | /:id/withdraw | 申请人撤回待审单，reason 必填 |
| POST | /:id/reopen | 当前项目负责人申请重开，reason 必填 |
| POST | /reopens/:id/review | 指定审批人处理；approve 布尔值，comment 必填 |
| GET | /notices | 本人待阅/知晓通知 |
| POST | /notices/:id/acknowledge | 本人确认 |
| GET | /delays | 延期事实列表 |
| GET | /delays/:id | 历史事实及关联依据 |
| GET | /supplement-audit | 历史合理补填核查 |
| POST | /followups/:kind/:id | 追加处理记录；kind=delay/supplement_audit，status=open/processing/resolved，comment 必填 |
| GET | /hr-access | 管理员查询阅览授权 |
| POST | /hr-access | 管理员授权，userId 必填，deptId 空为全部门 |
| POST | /hr-access/:id/revoke | 管理员撤销，保留记录 |
| GET | /:id/export | 返回固定 HTML 内容及文件名 |
| GET | /:id/assets/:assetId/download | 经授权下载报告附件 |

桌面当前入口 /closures，旧 /closure-reports、/closure-delays 兼容重定向；手机当前入口 /mobile/closures。通知深链保留申请/报告/知晓定位参数。

## 验证与发布

无立项书问答验收：勾选“本项目无立项书”，确认 AI 解析面板隐藏，条件部门显示“是／否”且默认未选；选择“是”应立即带出部门负责人并加入汇总，改为“否”应移除该条件部门。必审部门及提交人跳过自审规则仍优先生效；未回答不能提交但可以保存草稿。切换有／无立项书后需重新回答。初始八部门问题及清单已按用户表格补齐，已有数据库配置不会被默认值覆盖，需在规则配置入口维护。已确认无立项书时 HR 仍固定必审，无需勾选；其余条件部门按“是／否”选择。验收时须确认 HR 自动加入审核人汇总，仅实际提交人是 HR 负责人时跳过自审。

可重复执行的本地检查：

~~~powershell
# server 目录
node -r ts-node/register/transpile-only --test test/project-closures.test.cjs test/closure-report.test.cjs
node -r ts-node/register/transpile-only test/closure-database.integration.cjs
node -r ts-node/register/transpile-only --test test/closure-workflow.test.cjs test/closure-report-v2.test.cjs test/review-card-sync.test.cjs
node -r ts-node/register/transpile-only test/closure-review.integration.cjs
npm.cmd run build

# web 目录
node scripts/test-closure-ui.cjs
node scripts/test-closure-review.cjs
npm.cmd run build
~~~

数据库集成测试只能运行于本地隔离 schema，不能改为线上业务库。自动测试、真实卡片验证、浏览器视觉验收分别记录；本次文档核对不代表重新完成这些运行验证，也不沿用旧版本固定的测试通过数。

发布以 [部署说明](../../../../docs/08-部署与运维方案.md) 为准，保留服务器 .env、数据库及上传文件备份。生产镜像启动自动执行编译迁移，不在缺开发依赖的运行容器中执行 ts-node CLI。


解析身份兼容迁移为 1801100000000-AddClosureAnalysisScopeIdentity.ts，部署时与原解析迁移一起核对。部门负责人自审跳过只作用于实际提交人，不能用项目负责人的整体身份排除其他共同负责人。HR 延期日报代码见 project-delay-digest.ts，工作日报在 tasks 模块，两者不是同一个队列。
