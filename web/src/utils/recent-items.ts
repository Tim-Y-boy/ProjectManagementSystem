/**
 * 通用"最近常用选项"——按登录用户 + 命名空间 持久化到 localStorage，供单选下拉置顶。
 * 与 recent-people.ts 同理，只是键按命名空间隔离，可复用于部门/分类等任意下拉。
 * 键形如 recent-<ns>-v1:<userId>，值形如 [3, 7, 12]（最近在前，上限 20）。
 * 纯逻辑，不含组件；DeptSelect.vue 等复用。
 */

export interface SelectOption {
  value: number | string;
  label: string;
}

const RECENT_LIMIT = 20;

function recentKey(namespace: string, userId: number | string | null | undefined): string {
  return `recent-${namespace}-v1:${userId ?? 'guest'}`;
}

/** 归一化单选为 number/string[]；null/''/空数组返回 []。 */
function normalizeValues(v: unknown): Array<number | string> {
  const list = Array.isArray(v) ? v : v == null || v === '' ? [] : [v];
  return list
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0) as Array<number | string>;
}

export function loadRecentOptions(
  namespace: string,
  userId: number | string | null | undefined,
): Array<number | string> {
  if (userId == null) return [];
  try {
    const raw = localStorage.getItem(recentKey(namespace, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
  } catch {
    return [];
  }
}

/** 去重、最新在前、截断、写回。返回写回后的数组；清空/未选时不改动已有记录。 */
export function recordRecentOptions(
  namespace: string,
  userId: number | string | null | undefined,
  values: unknown,
): Array<number | string> {
  if (userId == null) return [];
  const incoming = normalizeValues(values);
  if (!incoming.length) return loadRecentOptions(namespace, userId);
  const merged = [...incoming, ...loadRecentOptions(namespace, userId)];
  const deduped = [...new Set(merged)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(recentKey(namespace, userId), JSON.stringify(deduped));
  } catch {
    /* 忽略隐私模式/配额 */
  }
  return deduped;
}

export interface OptionGroups {
  recent: SelectOption[];
  others: SelectOption[];
}

/**
 * 按最近使用分组。recent 排除掉已在其中的选项（避免 option key/value 重复）；
 * 无记录或 userId 为空时 recent 为空、others 为原列表，模板据此走原样渲染。
 */
export function groupOptionsByRecent(
  options: SelectOption[],
  namespace: string,
  userId: number | string | null | undefined,
): OptionGroups {
  const list = Array.isArray(options) ? options : [];
  if (!list.length || userId == null) return { recent: [], others: list };
  const recentValues = loadRecentOptions(namespace, userId);
  if (!recentValues.length) return { recent: [], others: list };

  const recent: SelectOption[] = [];
  const seen = new Set<string>();
  for (const val of recentValues) {
    const opt = list.find((x) => String(x.value) === String(val));
    const key = opt ? String(opt.value) : '';
    if (opt && key && !seen.has(key)) {
      recent.push(opt);
      seen.add(key);
    }
  }
  const others = list.filter((opt) => !seen.has(String(opt.value)));
  return { recent, others };
}
