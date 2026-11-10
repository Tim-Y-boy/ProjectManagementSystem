import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useAuthStore } from './auth';
import { projectWeeklyReportsApi, type WeeklyReport } from '@/api/project-weekly-reports';

type Update = Pick<WeeklyReport, 'projectId' | 'weekStart' | 'version'>;
const keyOf = (row: Update) => `${row.projectId}:${row.weekStart}`;
export const useWeeklyReportUnreadStore = defineStore('weeklyReportUnread', () => {
  const auth = useAuthStore();
  const updates = ref<Update[]>([]);
  const seen = ref<Record<string, number>>({});
  const storageKey = computed(() => `weekly-report-seen:${auth.user?.feishuUserId || auth.user?.id || ''}`);
  let generation = 0;
  watch(storageKey, () => {
    generation++;
    updates.value = [];
    seen.value = {};
    try {
      const value = JSON.parse(localStorage.getItem(storageKey.value) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) seen.value = value;
    } catch { /* Storage may be unavailable. Keep read state in memory. */ }
  }, { immediate: true });
  const isUnread = (row: Update) => row.version > (Number(seen.value[keyOf(row)]) || 0);
  const unread = computed(() => updates.value.some(isUnread));
  async function refresh() {
    const request = ++generation;
    if (!auth.user) return;
    try {
      const values = await projectWeeklyReportsApi.updates();
      if (request === generation) updates.value = values;
    } catch { /* A failed check must not clear existing unread indicators. */ }
  }
  function markSeen(row: Update) {
    if (!auth.user || row.version < 1) return;
    seen.value = { ...seen.value, [keyOf(row)]: Math.max(row.version, Number(seen.value[keyOf(row)]) || 0) };
    try { localStorage.setItem(storageKey.value, JSON.stringify(seen.value)); } catch { /* In-memory fallback. */ }
  }
  function markAllSeen() {
    if (!auth.user) return;
    const next = { ...seen.value };
    for (const row of updates.value) next[keyOf(row)] = Math.max(row.version, Number(next[keyOf(row)]) || 0);
    seen.value = next;
    try { localStorage.setItem(storageKey.value, JSON.stringify(next)); } catch { /* In-memory fallback. */ }
  }
  return { unread, isUnread, refresh, markSeen, markAllSeen };
});
