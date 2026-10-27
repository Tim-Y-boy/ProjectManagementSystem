import { onActivated, onMounted, ref, watch } from 'vue';
import { weeklyProgressApi } from '@/api';
import { useRefreshStore } from '@/stores/refresh';
import type { WeeklyNotice } from '@/utils/todo-weekly';

export function useWeeklyProgress() {
  const refresh = useRefreshStore();
  const notices = ref<WeeklyNotice[]>([]);
  const loading = ref(false);
  const error = ref('');
  let rerun = false;

  async function reload() {
    if (loading.value) { rerun = true; return; }
    loading.value = true;
    error.value = '';
    try { notices.value = (await weeklyProgressApi.list()).items; }
    catch { error.value = '周关键进展提醒加载失败，请重试'; }
    finally {
      loading.value = false;
      if (rerun) { rerun = false; void reload(); }
    }
  }
  onMounted(reload);
  onActivated(() => { if (!loading.value) void reload(); });
  watch(() => [refresh.versions.task, refresh.versions.project], reload);
  return { notices, loading, error, reload };
}
