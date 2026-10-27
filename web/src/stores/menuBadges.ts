import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { useAuthStore } from './auth';
import type { InboxItem } from '@/utils/todo-inbox';

export const useMenuBadgesStore = defineStore('menu-badges', () => {
  const auth = useAuthStore();
  const owner = ref<number>();
  const rows = ref<InboxItem[]>([]);
  const seen = ref<Record<string, string[]>>({});
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const seenDay = ref(today());
  const storageKey = () => `menu-badges-seen:${auth.user?.id}`;
  const identity = (row: InboxItem) => JSON.stringify([row.key, row.date, row.status]);

  function resetOwner() {
    if (owner.value === auth.user?.id) return;
    owner.value = auth.user?.id;
    rows.value = [];
    seen.value = {};
    if (!owner.value) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey()) || '{}');
      for (const name of ['my-todo', 'approvals']) {
        if (saved.day === seenDay.value && Array.isArray(saved.seen?.[name])) seen.value[name] = saved.seen[name].filter((key: unknown) => typeof key === 'string');
      }
    } catch { /* Unavailable storage must not prevent navigation. */ }
  }

  function refreshDay() {
    const day = today();
    if (day !== seenDay.value) {
      seenDay.value = day;
      seen.value = {};
    }
  }

  function update(items: InboxItem[], userId: number | undefined) {
    refreshDay();
    resetOwner();
    if (!userId || userId !== owner.value) return;
    rows.value = items.filter(row => !row.done);
  }

  const badges = computed(() => {
    const current = owner.value === auth.user?.id ? rows.value : [];
    return Object.fromEntries(['my-todo', 'approvals'].map(name => {
      const items = name === 'approvals' ? current.filter(row => row.category === 'approve') : current;
      return [name, {
        count: items.length,
        fresh: items.some(row => !(seen.value[name] || []).includes(identity(row))),
      }];
    }));
  });

  function markSeen(name: string) {
    refreshDay();
    resetOwner();
    if (!owner.value || !['my-todo', 'approvals'].includes(name)) return;
    const items = name === 'approvals' ? rows.value.filter(row => row.category === 'approve') : rows.value;
    seen.value[name] = items.map(identity);
    try { sessionStorage.setItem(storageKey(), JSON.stringify({ day: seenDay.value, seen: seen.value })); } catch { /* Optional persistence. */ }
  }

  return { badges, update, markSeen, refreshDay };
});
