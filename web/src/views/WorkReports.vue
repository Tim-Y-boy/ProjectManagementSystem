<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useWeeklyReportUnreadStore } from '@/stores/weeklyReportUnread';
import { useRoute, useRouter } from 'vue-router';
import { useDailyReportStore } from '@/stores/dailyReport';
import DailyReport from './DailyReport.vue';
import ProjectWeeklyReports from './ProjectWeeklyReports.vue';
const route = useRoute();
const router = useRouter();
const report = useDailyReportStore();
const weekly = useWeeklyReportUnreadStore();
let timer: ReturnType<typeof setInterval>;
async function refreshUpdates() {
  if (document.visibilityState === 'hidden') return;
  void report.refresh();
  await weekly.refresh();
  if (tab.value === 'weekly' && document.visibilityState === 'visible') weekly.markAllSeen();
}
onMounted(() => {
  refreshUpdates();
  timer = setInterval(refreshUpdates, 60000);
  window.addEventListener('focus', refreshUpdates);
});
onUnmounted(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refreshUpdates);
});
const tab = computed(() => route.query.tab === 'weekly' || !report.allowed ? 'weekly' : 'daily');
watch(tab, value => { if (value === 'weekly') void refreshUpdates(); });
function changeTab(value: string | number) {
  router.replace({ path: route.path, query: { tab: value === 'weekly' ? 'weekly' : undefined } });
}
</script>
<template>
  <section class="work-reports" :class="{ 'work-reports--editor': tab === 'weekly' && route.query.projectId }">
    <el-tabs class="report-tabs" :model-value="tab" @update:model-value="changeTab" aria-label="切换日报或周报">
      <el-tab-pane v-if="report.allowed" label="工作日报" name="daily">
        <template #label><span class="tab-label">工作日报<span v-if="report.unread" class="update-dot" role="img" aria-label="有未读日报" /></span></template>
      </el-tab-pane>
      <el-tab-pane label="项目周报" name="weekly">
        <template #label><span class="tab-label">项目周报<span v-if="weekly.unread" class="update-dot" role="img" title="有已提交的周报更新，进入后清除提醒" aria-label="有未读周报更新" /></span></template>
      </el-tab-pane>
    </el-tabs>
    <DailyReport v-if="tab === 'daily' && report.allowed" />
    <ProjectWeeklyReports v-else />
  </section>
</template>
<style scoped>
.work-reports { max-width: 1280px; margin: auto; min-width: 0; }
.work-reports--editor { max-width:none; margin:0; }
@media(min-width:1200px) {
  /* 周报导航与标签同排，避免标签栏的透明区域遮挡右侧控件。 */
  .work-reports--editor .report-tabs { width:fit-content; max-width:100%; }
}
.tab-label { position: relative; }
.update-dot { position: absolute; top: -4px; right: -13px; width: 10px; height: 10px; border-radius: 50%; background: #ff3b30; box-shadow: 0 0 0 2px #fff; }
.report-tabs :deep(.el-tabs__header) { margin: 0 0 16px; }
.report-tabs :deep(.el-tabs__content) { display: none; }
.report-tabs :deep(.el-tabs__nav-wrap::after),
.report-tabs :deep(.el-tabs__active-bar) { display: none; }
.report-tabs :deep(.el-tabs__nav) {
  display: flex; gap: 4px; padding: 3px;
  border: 1px solid var(--el-border-color-light); border-radius: 9px;
  background: var(--el-bg-color);
}
.report-tabs :deep(.el-tabs__item) {
  height: 38px; min-width: 116px; padding: 0 22px !important;
  border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--el-text-color-regular); font-size: 15px; font-weight: 500;
  transition: background-color .15s, color .15s;
}
.report-tabs :deep(.el-tabs__item:hover) { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.report-tabs :deep(.el-tabs__item.is-active) {
  background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-7);
  color: var(--el-color-primary-dark-2); font-weight: 600;
}
.report-tabs :deep(.el-tabs__item:focus-visible) { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
@media(prefers-reduced-motion:reduce) {
  .report-tabs :deep(.el-tabs__item) { transition: none; }
}
@media(max-width:600px) {
  .report-tabs :deep(.el-tabs__nav) { width: 100%; box-sizing: border-box; }
  .report-tabs :deep(.el-tabs__item) { flex: 1; min-width: 0; padding: 0 16px !important; }
}
</style>
