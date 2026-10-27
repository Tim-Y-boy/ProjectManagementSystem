// 智能体查询 · 工具层（docs/16 §4、§6）。
// P0 策略：工具 = JSON Schema + 到一期「(intent,args)」的翻译，执行统一转调 BotQueryService.handle。
// 一期已验证的 RBAC（parseRiskScope 的 mine/dept/all、myTodoOverview 本人过滤、项目 Like 搜索）全部原样生效，
// 无第二套聚合逻辑可漂移。LLM 永不直接触库（BR-A1）。

import { BotUserContext } from './bot-query.service';
import { BotQueryService } from './bot-query.service';
import { BotReplyService } from './bot-reply.service';
import { BotIntent } from './bot-intent';
import { LlmTool } from './llm-adapter';

export interface AgentTool {
  name: string;
  /** 喂给 LLM 的工具说明：做什么 + 权限边界；权限不足时工具返回说明文本，LLM 应如实转达 */
  description: string;
  /** OpenAI JSON Schema（object）；P0 全部 additionalProperties:false */
  parameters: Record<string, unknown>;
  execute(ctx: BotUserContext, args: Record<string, unknown>): Promise<string>;
}

export function toLlmTool(t: AgentTool): LlmTool {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

/**
 * 组装 P0 工具。依赖 BotQueryService/BotReplyService，由 BotModule 的 useFactory 构造注入。
 */
export function createAgentTools(q: BotQueryService, _reply: BotReplyService): AgentTool[] {
  const call = (intent: BotIntent, args: string) => (ctx: BotUserContext) =>
    q.handle(intent, args, ctx);

  return [
    {
      name: 'query_my_tasks',
      description:
        '查询「我」当前执行中/待验收的任务清单（只含自己参与的数据）。用户说「我的任务/我有什么任务/我的待办/我的工作」用它；**不要**把「任务」「所有任务」这类词当成项目名去调 query_project_progress。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: call('my_tasks', ''),
    },
    {
      name: 'query_due_tasks',
      description: '查询「我」到期窗口内未完成的任务：today=今天到期；week=未来 7 天临期（含延期）。',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['today', 'week'], description: 'today=今天到期；week=未来7天临期' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      execute: async (ctx, args) => {
        const range = String(args.range ?? 'today');
        if (range !== 'today' && range !== 'week') {
          return 'range 参数需为 today 或 week，请修正后重试。';
        }
        return q.handle(range === 'week' ? 'week' : 'today', '', ctx);
      },
    },
    {
      name: 'query_project_progress',
      description:
        '查询指定「进行中项目」的阶段进度（支持项目名模糊匹配）。**仅当用户明确提到某个具体项目时用**（如「产品研发进度」「示例项目怎么样」）。若用户说的是「所有项目/全部项目/整体进度/有哪些项目」等宽泛说法，不要用本工具，改用 query_all_projects；若是「我的任务」，改用 query_my_tasks。',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: '具体项目名称关键词，如「产品研发」；不确定就留空并改用 query_all_projects' },
        },
        required: ['project_name'],
        additionalProperties: false,
      },
      execute: async (ctx, args) => {
        const name = String(args.project_name ?? '').trim();
        if (!name) return '请提供 project_name（项目名关键词）。';
        return q.handle('project_progress', name, ctx);
      },
    },
    {
      name: 'query_overdue_tasks',
      description:
        '查询延期任务：mine=我的延期；dept=本部门/负责部门的延期（需 部门负责人及以上，限本部门∪负责部门）；all=全部延期（需 领导/管理员）。权限不足时工具会返回权限提示，默认 mine。',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['mine', 'dept', 'all'],
            default: 'mine',
            description: 'mine=我的；dept=部门（需部门负责人+）；all=全部（需领导/管理员）',
          },
        },
        additionalProperties: false,
      },
      execute: async (ctx, args) => {
        const scope = String(args.scope ?? 'mine');
        if (scope !== 'mine' && scope !== 'dept' && scope !== 'all') {
          return 'scope 参数需为 mine/dept/all，请修正后重试。';
        }
        // 翻译成一期 parseRiskScope 的输入词（''=mine），权限判定在 BotQueryService 内部（BR-A5）
        const word = scope === 'all' ? '全部' : scope === 'dept' ? '部门' : '';
        return q.handle('risk', word, ctx);
      },
    },
    {
      name: 'query_pending_reviews',
      description: '查询「待我审核/终审」的计划变更单（只含自己有审核权的）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: call('pending_review', ''),
    },
    {
      name: 'query_my_projects',
      description:
        '只列「我参与」的项目及总进度（含延期🚨/定稿🔒）。用户明确说「我的项目/我参与的」才用；说「所有项目/全公司有哪些项目」用 query_all_projects。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: call('my_projects', ''),
    },
    {
      name: 'query_all_projects',
      description:
        '列出全公司所有「进行中」项目及各自总进度%（延期🚨/定稿🔒 标记，越需关注越靠前）。用户问「所有项目/全公司项目/现在有哪些项目/整体进度」用它；说「我的项目」用 query_my_projects。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => q.listAllProjectsProgress(),
    },
    {
      name: 'search_projects',
      description: '按名称关键词搜索项目（进行中/已归档都会匹配），返回名称/状态/负责人/部门。拿不准项目全名时用。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '项目名关键词，如「示例」' } },
        required: ['keyword'],
        additionalProperties: false,
      },
      execute: async (_ctx, args) => q.searchProjects(String(args.keyword ?? '')),
    },
    {
      name: 'search_users',
      description: '按姓名或工号关键词搜索成员，返回姓名/部门/工号（全员可见基础信息）。想找人/确认某人存在时用。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '姓名或工号关键词，如「张」或工号片段' } },
        required: ['keyword'],
        additionalProperties: false,
      },
      execute: async (_ctx, args) => q.searchUsers(String(args.keyword ?? '')),
    },
    {
      name: 'query_user_tasks',
      description:
        '查询某位同事「张三」当前执行中/待验收的任务。涉他人权限：仅可查 自己/本部门∪负责部门(部门负责人)/全部(领导管理员)；权限不足工具会返回提示，请如实转达。',
      parameters: {
        type: 'object',
        properties: { user_name: { type: 'string', description: '要查询的同事姓名，如「张三」' } },
        required: ['user_name'],
        additionalProperties: false,
      },
      execute: (ctx, args) => q.queryUserTasks(String(args.user_name ?? ''), ctx),
    },
    {
      name: 'get_project_summary',
      description:
        '单项目「总览汇总」：阶段进度 + 负责人/部门/定稿 + 本项目延期任务明细。比 query_project_progress 更全，用于「XX项目整体怎么样」。',
      parameters: {
        type: 'object',
        properties: { project_name: { type: 'string', description: '进行中项目名关键词，如「产品研发」' } },
        required: ['project_name'],
        additionalProperties: false,
      },
      execute: async (_ctx, args) => q.projectSummary(String(args.project_name ?? '')),
    },
    {
      name: 'help',
      description: '机器人使用说明/我能查什么。当用户问「你能做什么/菜单/帮助」或完全听不懂时调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: call('help', ''),
    },
  ];
}

/**
 * System prompt（docs/16 §6）。只嵌身份与规则，不把业务数据塞进 prompt——数据一律靠工具按需取数（BR-A1/A4）。
 */
export function buildSystem(ctx: BotUserContext, tools: AgentTool[]): string {
  const toolList = tools
    .map((t) => `- ${t.name}：${t.description}`)
    .join('\n');
  return [
    `你是「项目管理系统」的飞书查询助手，像一位熟悉业务的同事，帮员工和领导用自然语言查任务、进度和延期。只通过工具查数据，绝不编造。`,
    `语气自然、简洁，用中文回复；适当用 emoji 排版但别堆砌。`,
    `当前用户：${ctx.name}，角色：${ctx.roles.join('/')}，部门id：${ctx.deptId ?? '无'}，可管理部门：${ctx.managedDeptIds.length ? ctx.managedDeptIds.join(',') : '无'}。`,
    `可用工具：\n${toolList}`,
    `规则：`,
    `1. 需要数据必须先调用工具；工具返回空/没找到，就如实说「没有/没找到」，不要补造原因或数据。`,
    `2. 涉他人/部门/全部数据时严格按用户权限选参数；工具返回「权限不足」提示时直接照实转达，不要自行判断或放宽。`,
    `3. 先判断用户宏观意图，再选工具，不要一看到「任务/进度/项目」就当成具体项目名去 search 或 query_project_progress：`,
    `   · 说「我的任务/我的待办/我有什么任务」 → query_my_tasks`,
    `   · 说「所有项目/全部项目/现在有哪些项目/整体进度/列出所有项目和进度」 → query_all_projects（不是 query_project_progress）`,
    `   · 说「所有任务/全部任务/我所有的任务」 → query_my_tasks（用户指自己的）`,
    `   · 只有明确点了具体项目名（如「产品研发」「示例项目」）才用 query_project_progress / get_project_summary`,
    `   · 拿不准项目全名先用 search_projects 搜，拿到确切名字再查进度`,
    `4. 一个问题可能需要多个工具，可依次调用后合并成一次完整回答；「所有项目」与「我的项目」是两个工具别混用，别把宽泛词塞进 project_name。`,
    `5. 数字与状态以工具返回为准，直接转述，不要改写。延期/风险用 🚨 标注。`,
    `6. 排版用纯文本，禁止任何 Markdown：不要用 **加粗**、*斜体*、代码块 \`\`\`、反引号、表格或标题 #。分行用普通换行；每行一条信息、行内结构固定（先名称再数据）；空行只在一段结束用一次，别刷屏。`,
    `7. 用户可能闲聊或问你是谁（如「你叫什么」「你用的什么模型」）——自然简短回答（你是本项目管理系统的查询助手，由服务端配置的大模型驱动，主要帮你查任务和项目），再温和引回「想查点什么」。不要生硬地甩「回复菜单」。`,
    `8. 只有用户明显在问某类数据、而你没有对应工具时，才诚实说「这块暂时不支持」，并主动说能帮他查什么。`,
  ].join('\n');
}
