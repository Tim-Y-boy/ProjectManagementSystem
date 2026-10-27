import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { dashboardApi, closuresApi } from '@/api';
import { useWeeklyProgress } from './useWeeklyProgress';
import { useRefreshStore } from '@/stores/refresh';
import { mergeWeeklyTodos } from '@/utils/todo-weekly';
import { buildInbox, inboxCounts } from '@/utils/todo-inbox';
import { leafRisk } from '@/utils/task-risk';
import { useMenuBadgesStore } from '@/stores/menuBadges';
import { useAuthStore } from '@/stores/auth';

export function useTodoInbox() {
  const badges = useMenuBadgesStore();
  const auth = useAuthStore();
  const userId = auth.user?.id;
  const data = ref<any>({});
  const notices = ref<any[]>([]);
  const ready = ref<any[]>([]);
  const loading = ref(false);
  const errors = ref<string[]>([]);
  const weekly = useWeeklyProgress();
  const refresh = useRefreshStore();
  let loaded = false;
  let rerun = false;
  async function load() {
    if (loading.value) { rerun = true; return; }
    loading.value = true;
    const results = await Promise.allSettled([dashboardApi.myTodo(), closuresApi.notices(), closuresApi.ready()]);
    errors.value = [];
    const targets = [data, notices, ready];
    const labels = ['任务及变更审批', '结项与知晓通知', '待申请结项项目'];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') targets[i].value = result.value;
      else errors.value.push(`${labels[i]}加载失败，当前列表可能不完整，请刷新重试。`);
    });
    loaded = true;
    loading.value = false;
    if (rerun) { rerun = false; void load(); }
  }
  const rows = computed(() => {
    const groups = mergeWeeklyTodos(data.value.todo || [], weekly.notices.value).map(g => ({ ...g, tasks: g.tasks.map((t: any) => ({ ...t, inboxRisk: t.weeklyOnly ? 0 : leafRisk(t) })) }));
    return buildInbox(data.value, groups, notices.value, ready.value);
  });
  const counts = computed(() => inboxCounts(rows.value));
  const allErrors = computed(() => [...errors.value, ...(weekly.error.value ? [weekly.error.value] : [])]);
  const busy = computed(() => loading.value || weekly.loading.value);
  watch([rows, busy, allErrors], () => {
    if (loaded && !busy.value && !allErrors.value.length) badges.update(rows.value, userId);
  });
  async function reload() { await Promise.all([load(), weekly.reload()]); }
  onMounted(load);
  onActivated(() => { if (loaded) void load(); });
  watch(() => [refresh.versions.task, refresh.versions.project, refresh.versions.planChange], load);
  return { data, rows, counts, errors: allErrors, loading: busy, reload };
}
