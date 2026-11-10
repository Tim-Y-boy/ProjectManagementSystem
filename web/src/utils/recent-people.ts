/**
 * "最近使用的人"——按登录用户持久化到 localStorage，用于选人控件置顶。
 * 键形如 recent-people-v1:<userId>，值形如 [3, 7, 12]（最近在前，上限 20）。
 * 纯逻辑，不含组件；UserSelect.vue 复用。
 * 注：存的是数字 id（JSON 数字），与选人控件的 toNumericId 值形态一致。
 */

const RECENT_KEY_PREFIX = 'recent-people-v1:';
const RECENT_LIMIT = 20;

function recentKey(userId: number | string | null | undefined): string {
  return `${RECENT_KEY_PREFIX}${userId ?? 'guest'}`;
}

/** 归一化单选/多选/清空为 number[]；null/''/空数组返回 []。 */
function normalizeIds(ids: unknown): number[] {
  if (Array.isArray(ids)) {
    return ids
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  if (ids == null || ids === '') return [];
  const n = Number(ids);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

export function loadRecentUsers(userId: number | string | null | undefined): number[] {
  if (userId == null) return [];
  try {
    const raw = localStorage.getItem(recentKey(userId));
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
export function recordRecentUsers(
  userId: number | string | null | undefined,
  ids: number | number[] | string | string[] | null,
): number[] {
  if (userId == null) return [];
  const incoming = normalizeIds(ids);
  if (!incoming.length) return loadRecentUsers(userId);
  const merged = [...incoming, ...loadRecentUsers(userId)];
  const deduped = [...new Set(merged)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(deduped));
  } catch {
    /* 忽略隐私模式/配额 */
  }
  return deduped;
}

export interface RecentGroups {
  recent: any[];
  others: any[];
}

/**
 * 按最近使用分组。recent 排除掉已在其中的用户（避免 option key/value 重复）；
 * 无记录或 userId 为空时 recent 为空、others 为原列表，模板据此走原样渲染。
 */
export function groupUsersByRecent(
  users: any[],
  userId: number | string | null | undefined,
): RecentGroups {
  if (!Array.isArray(users) || userId == null) return { recent: [], others: users || [] };
  const recentIds = loadRecentUsers(userId);
  if (!recentIds.length) return { recent: [], others: users };

  const recent: any[] = [];
  const seen = new Set<number>();
  for (const id of recentIds) {
    const u = users.find((x) => Number(x?.id) === id);
    if (u && !seen.has(Number(u.id))) {
      recent.push(u);
      seen.add(Number(u.id));
    }
  }
  const others = users.filter((u) => !seen.has(Number(u?.id)));
  return { recent, others };
}

/** Mock 用户 label 加后缀，可搜索（输入 mock 命中）且一眼可辨。 */
export function personLabel(u: { name?: string; isMock?: boolean } | null | undefined): string {
  if (!u) return '—';
  return u.isMock ? `${u.name ?? ''}（Mock）` : u.name ?? '—';
}
