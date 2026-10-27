import { defineStore } from 'pinia';
import { reactive } from 'vue';

export type RefreshDomain = 'project' | 'task' | 'planChange' | 'category';
export type RefreshSnapshot = Record<RefreshDomain, number>;

export const useRefreshStore = defineStore('refresh', () => {
  const versions = reactive<RefreshSnapshot>({
    project: 0,
    task: 0,
    planChange: 0,
    category: 0,
  });

  function snapshot(): RefreshSnapshot {
    return { ...versions };
  }

  function isStale(seen: RefreshSnapshot, domains: RefreshDomain[]) {
    return domains.some((domain) => seen[domain] !== versions[domain]);
  }

  function markProjectChanged() {
    versions.project += 1;
  }

  function markTaskChanged() {
    versions.task += 1;
    versions.project += 1;
  }

  function markPlanChangeChanged() {
    versions.planChange += 1;
  }

  function markProjectPlanChanged() {
    versions.project += 1;
    versions.task += 1;
    versions.planChange += 1;
  }

  function markCategoryChanged() {
    versions.category += 1;
    versions.project += 1;
  }

  return {
    versions,
    snapshot,
    isStale,
    markProjectChanged,
    markTaskChanged,
    markPlanChangeChanged,
    markProjectPlanChanged,
    markCategoryChanged,
  };
});
