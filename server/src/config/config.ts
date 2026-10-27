import 'dotenv/config';

// 统一配置读取入口。所有环境变量在这里集中并给默认值。
export const config = {
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    accessExpires: process.env.JWT_AUTH_EXPIRES || '2h',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    redirectUri:
      process.env.FEISHU_REDIRECT_URI ||
      'http://localhost:8081/api/auth/feishu/callback',
    // mock 登录：true 时跳过飞书，用预设用户。凭证到位改 false。
    mockLogin: (process.env.FEISHU_MOCK_LOGIN ?? 'false') === 'true',
    mockPassword: process.env.FEISHU_MOCK_PASSWORD || '',
    // 初始管理员：逗号分隔的飞书 user_id，登录时自动获得 admin 角色。
    // 解决"第一个管理员从哪来"的问题——否则只有 admin 能分配角色，形成死锁。
    adminUserIds: (process.env.FEISHU_ADMIN_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // 飞书机器人长连接：true 时启动 LarkChannel 接收消息事件。
    // 需先在飞书后台开通机器人、配 im:message / im:message:send_as_bot 权限、
    // 事件订阅 im.message.receive_v1 选「长连接」，否则连接会失败。
    botEnabled: (process.env.FEISHU_BOT_ENABLED ?? 'false') === 'true',
    // 项目群每日简报目标群（oc_ 开头的群 chat_id；机器人需已在群内）。空则不自动发。
    briefGroupChatId: process.env.FEISHU_BRIEF_GROUP_CHAT_ID?.trim() || '',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'tracker',
    password: process.env.DB_PASSWORD || 'change-me',
    database: process.env.DB_DATABASE || 'tracker',
  },
  // 智能体查询：LLM_ENABLED=false 时保持一期关键词引擎，零回归、无外呼。
  llm: {
    enabled: (process.env.LLM_ENABLED ?? 'false') === 'true',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '10000', 10),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1500', 10),
    maxRounds: parseInt(process.env.LLM_MAX_ROUNDS || '4', 10),
    // 项目群简报是否用「思考模式」生成（更深；失败自动退回非思考再退回结构化，不阻断发群）
    briefThinking: (process.env.LLM_BRIEF_THINKING ?? 'true') === 'true',
    // 简报专用模型（留空 = 同 LLM_MODEL）；思考模式若需换 reasoner 类模型时在此指定
    briefModel: process.env.LLM_BRIEF_MODEL?.trim() || '',
    briefMaxTokens: parseInt(process.env.LLM_BRIEF_MAX_TOKENS || '6000', 10),
    briefTimeoutMs: parseInt(process.env.LLM_BRIEF_TIMEOUT_MS || '120000', 10),
  },
};
