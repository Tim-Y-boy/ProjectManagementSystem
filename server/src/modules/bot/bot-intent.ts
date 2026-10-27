// 机器人指令 → 意图映射（docs/15 第 6.1 节）。
// 支持自然语言描述（领导不需要背命令）：归一化后按"包含关键词"匹配，
// 去掉开场白/标点/填充词，尽量容忍口语表达。不做完整 NLU，靠关键词兜底（BR-8）。

export type BotIntent =
  | 'my_tasks'
  | 'today'
  | 'week'
  | 'project_progress'
  | 'risk'
  | 'pending_review'
  | 'my_projects'
  | 'help';

export interface ParsedIntent {
  intent: BotIntent;
  /** 指令关键词之后/之外的剩余文本，如 "进度 新药立项" → args="新药立项" */
  args: string;
}

// 优先级从高到低：更具体的意图靠前，避免被宽泛关键词（如"任务"/"项目"）抢占。
const INTENT_KEYWORDS: Array<{ intent: BotIntent; keywords: string[] }> = [
  { intent: 'project_progress', keywords: ['进展怎么样', '进度', '进展', '完成多少'] },
  { intent: 'today', keywords: ['今天到期', '今日到期', '今天要做', '今天', '今日'] },
  { intent: 'week', keywords: ['本周', '这周', '下周', '近7天', '近七天', '未来一周', '最近一周', '临期', '到期'] },
  { intent: 'risk', keywords: ['延期', '逾期', '超期', '风险', '滞后', '没完成'] },
  { intent: 'pending_review', keywords: ['待我审核', '待审核', '待审批', '待我审批', '审核', '审批', '变更'] },
  { intent: 'my_tasks', keywords: ['我的任务', '我的待办', '待办', '任务', '待验收', 'todo'] },
  { intent: 'my_projects', keywords: ['我的项目', '我参与的项目', '我们部门的项目', '项目'] },
  { intent: 'help', keywords: ['帮助', '菜单', 'help', '功能', '怎么用', '能做什么'] },
];

// 常见开场白，归一化时剥离
const STRIP_PREFIX = [
  '帮我看看', '帮我查一下', '帮我查下', '帮我查', '帮我',
  '查一下', '查下', '看看', '请问', '麻烦', '你好',
  '我想看看', '我想查', '我想', '请告诉我', '请',
];

// 项目名提取时剥离的填充词
const PROGRESS_FILLERS = [
  '的', '情况', '现在', '目前', '当前', '什么', '所有',
  '如何', '怎么样', '咋样', '啥样', '了吗', '呢', '吗',
  '有没有', '看一下', '看看', '一下',
];

const PUNCT_RE = /[，。！？、,.!?;；:：\s"'“”‘’（）()【】[\]]/g;

function normalize(text: string): string {
  let s = (text || '').toLowerCase().trim();
  s = s.replace(PUNCT_RE, '');
  for (const p of STRIP_PREFIX) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  return s;
}

function extractArgs(text: string, matchedKw: string, intent: BotIntent): string {
  let s = text.replace(matchedKw, '');
  if (intent === 'project_progress') {
    for (const f of PROGRESS_FILLERS) s = s.split(f).join('');
    // 去掉尾部冗余的"项目"，但保留纯"项目"以外的部分
    if (s.endsWith('项目') && s.length > 2) s = s.slice(0, -2);
    if (s === '项目') s = '';
  }
  return s.trim();
}

export function parseIntent(raw: string): ParsedIntent {
  const text = normalize(raw);
  if (!text) return { intent: 'help', args: '' };
  for (const { intent, keywords } of INTENT_KEYWORDS) {
    const kw = keywords.find((k) => text.includes(k));
    if (kw) return { intent, args: extractArgs(text, kw, intent) };
  }
  // 无法识别 → 帮助菜单（BR-8）
  return { intent: 'help', args: text };
}
