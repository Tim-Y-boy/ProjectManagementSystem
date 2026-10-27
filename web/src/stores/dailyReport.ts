import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { dashboardApi } from '@/api';
import { useAuthStore } from './auth';

export const useDailyReportStore = defineStore('dailyReport', () => {
  const auth = useAuthStore();
  const allowed = ref(false);
  const date = ref('');
  const unreadDates = ref<string[]>([]);
  const unreadCount = computed(() => allowed.value ? unreadDates.value.length : 0);
  const unread = computed(() => unreadCount.value > 0);
  let version = 0;
  watch(() => auth.user?.id, () => {
    version++;
    allowed.value = false;
    date.value = '';
    unreadDates.value = [];
  }, { immediate: true });
  async function refresh() {
    const request = ++version;
    if (!auth.user) return;
    try {
      const result = await dashboardApi.dailyReportStatus();
      if (request !== version) return;
      allowed.value = result.canView;
      date.value = result.date;
      unreadDates.value = result.unreadDates || [];
    } catch {
      if (request === version) allowed.value = false;
    }
  }
  function markSeen(loadedDate: string) {
    // The server records successful report reads, including historical dates.
    unreadDates.value = unreadDates.value.filter(day => day !== loadedDate);
    void refresh();
  }
  return { allowed, date, unread, unreadCount, unreadDates, refresh, markSeen };
});