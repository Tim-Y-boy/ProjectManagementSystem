<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { dashboardApi } from '@/api';
import { useDailyReportStore } from '@/stores/dailyReport';
import { useRefreshStore } from '@/stores/refresh';
import { formatBeijingTime } from '@/utils/date-time';
import { groupDailyReport, type DailyReportItem } from '@/utils/daily-report';
import DatePick from '@/components/DatePick.vue';
import DailyReportProject from '@/components/DailyReportProject.vue';

const route = useRoute();
const refresh = useRefreshStore();
const report = useDailyReportStore();
const today = () => formatBeijingTime(new Date().toISOString()).slice(0, 10);
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const yesterday = () => shiftDay(today(), -1);
const date = ref(report.date || yesterday());
const items = ref<DailyReportItem[]>([]);
const loading = ref(false);
const error = ref('');
const query = ref('');
let requestVersion = 0;
const visible = computed(() => items.value.filter(item => {
  const text = query.value.trim().toLocaleLowerCase();
  return !text || [item.projectName, item.taskTitle, item.userName, item.content].some(value => value?.toLocaleLowerCase().includes(text));
}));
const projects = computed(() => groupDailyReport(visible.value));
const people = computed(() => new Set(visible.value.map(item => String(item.userId))).size);
async function load(requestedDate?: string) {
  const version = ++requestVersion;
  loading.value = true;
  error.value = '';
  items.value = [];
  try {
    const result = await dashboardApi.dailyReport(requestedDate);
    if (version === requestVersion) {
      date.value = result.date;
      if (!requestedDate) report.date = result.date;
      items.value = result.items;
      report.markSeen(result.date);
    }
  } catch {
    if (version === requestVersion) error.value = '日报加载失败，请重试。';
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}
onMounted(() => load());
let activated = false;
onActivated(() => {
  if (activated) { query.value = ''; void load(); }
  activated = true;
});
watch(() => [refresh.versions.task, refresh.versions.project], () => load(date.value));
</script>

<template>
  <div class="daily-report-page">
    <header class="report-heading">
      <h1>工作日报</h1>
      <div class="report-date">
        <el-button :disabled="!report.unreadDates.length" @click="load(report.unreadDates[0])">{{ report.unreadDates.length ? `查看未读（${report.unreadCount}）` : '暂无未读' }}</el-button>
        <el-button aria-label="查看前一天" @click="load(shiftDay(date, -1))">‹</el-button>
        <DatePick v-model="date" :max="today()" :clearable="false" aria-label="日报提交日期" @update:model-value="load" />
        <el-button aria-label="查看后一天" :disabled="date >= today()" @click="load(shiftDay(date, 1))">›</el-button>
        <el-button v-if="date !== (report.date || yesterday())" @click="load()">最新日报</el-button>
        <el-button :loading="loading" @click="load(date)">刷新</el-button>
      </div>
    </header>
    <div class="report-toolbar">
      <div class="report-overview" aria-live="polite">
        <template v-if="!loading && !error">
          <span>{{ projects.length }} 个项目</span>
          <span>{{ people }} 人</span>
          <span>{{ visible.length }} 条进展</span>
        </template>
      </div>
      <el-input v-model="query" clearable placeholder="搜索项目、人员或进展" aria-label="搜索日报" />
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-skeleton v-else-if="loading" :rows="8" animated />
    <template v-else>
      <div v-if="projects.length" class="report-projects">
        <DailyReportProject v-for="project in projects" :key="`${date}-${project.id}`" :name="project.name" :items="project.items" :mobile="!!route.meta.mobile" :report-date="date" />
      </div>
      <el-empty v-else :description="items.length ? '没有符合筛选条件的进展' : `${date} 暂无新提交的进展`" />
    </template>
  </div>
</template>

<style scoped>
.daily-report-page { max-width: 1280px; margin: 0 auto; color: #263e33; }
.report-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
h1 { font-size: 25px; margin: 0; color: #205e53; }
.report-date { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.report-date :deep(.el-button + .el-button) { margin-left: 0; }
.report-date :deep(.dp) { width: 170px; max-width: 100%; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
.report-toolbar .el-input { width: 240px; }
.report-overview { display: flex; flex-wrap: wrap; gap: 16px; color: #61756a; font-size: 13px; }
.report-projects { display: grid; gap: 12px; }
.el-alert, .el-skeleton { margin-top: 20px; }
@media (max-width: 768px) {
  .report-heading { gap: 12px; }
  .report-date { gap: 6px; }
  .report-toolbar .el-input { width: 100%; }
}
</style>
