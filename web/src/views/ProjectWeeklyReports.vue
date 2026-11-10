<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { projectWeeklyReportsApi, type WeeklyDetail, type WeeklyReport } from '@/api/project-weekly-reports';
import { useAuthStore } from '@/stores/auth';
import { currentWeeklyMonday, weeklyMonday, weeklyPriority } from '@/utils/project-weekly-report';
import WeeklyReportEditor from '@/components/weekly/WeeklyReportEditor.vue';
import WeeklyWeekSelect from '@/components/weekly/WeeklyWeekSelect.vue';
import UserAvatar from '@/components/UserAvatar.vue';
import { useWeeklyReportUnreadStore } from '@/stores/weeklyReportUnread';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const unread = useWeeklyReportUnreadStore();
const rows = ref<WeeklyReport[]>([]);
const detail = ref<WeeklyDetail>();
const loading = ref(false);
const error = ref('');
const week = ref(currentWeeklyMonday());
const dept = ref<number>();
const project = ref<number>();
const owner = ref<number>();
const status = ref('');
const allWeeks = computed(() => route.query.history === '1' && !!route.query.projectId);
const showingDetail = computed(() => !!route.query.projectId && !!route.query.weekStart && !allWeeks.value);
let generation = 0;
const options = (id: 'projectId' | 'ownerId' | 'deptId', label: 'projectName' | 'ownerName' | 'deptName') => computed(() => [...new Map(rows.value.filter(row => row[id] != null).map(row => [row[id], { id: row[id]!, label: row[label] || '未指定' }])).values()]);
const departments = options('deptId', 'deptName');
const projects = options('projectId', 'projectName');
const owners = options('ownerId', 'ownerName');
const visible = computed(() => {
  const values = rows.value.filter(row => (!dept.value || row.deptId === dept.value) && (!project.value || row.projectId === project.value) && (!owner.value || row.ownerId === owner.value) && (!status.value || row.status === status.value));
  return auth.has('leader') || auth.has('dept_head') ? values.sort((a,b) => weeklyPriority(a) - weeklyPriority(b)) : values;
});
const reportSections = computed(() => {
  const writable = visible.value.filter(row => row.canEdit && !auth.readOnly);
  const viewable = visible.value.filter(row => !row.canEdit || auth.readOnly);
  return [
    { key: 'write', title: '我负责填写的周报', rows: writable },
    { key: 'view', title: writable.length ? '查看其他周报' : '查看周报', rows: viewable },
  ].filter(section => section.rows.length);
});
async function load() {
  const token = ++generation;
  loading.value = true; error.value = ''; detail.value = undefined;
  try {
    const projectId = Number(route.query.projectId) || undefined;
    const requestedWeek = typeof route.query.weekStart === 'string' ? weeklyMonday(route.query.weekStart) : '';
    const currentWeek = currentWeeklyMonday();
    if (requestedWeek > currentWeek) {
      await router.replace({ path: route.path, query: { ...route.query, weekStart: currentWeek } });
      return;
    }
    week.value = requestedWeek || currentWeek;
    if (projectId && requestedWeek && !allWeeks.value) {
      const value = await projectWeeklyReportsApi.detail(projectId, requestedWeek);
      if (token === generation) { detail.value = value; unread.markSeen(value); }
    } else {
      const values = await projectWeeklyReportsApi.list({ ...(allWeeks.value ? { allWeeks: true } : { weekStart: week.value }), ...(projectId ? { projectId } : {}) });
      if (token === generation) rows.value = values;
    }
  } catch (e: any) { if (token === generation) error.value = e?.message || '周报加载失败，请重试'; }
  finally { if (token === generation) loading.value = false; }
}
watch([() => route.query.projectId, () => route.query.weekStart, () => route.query.history], load, { immediate: true });
function selectWeek(value: string) {
  router.replace({ path: route.path, query: { tab: 'weekly', weekStart: weeklyMonday(value) || currentWeeklyMonday(), ...(allWeeks.value ? { projectId: route.query.projectId, history: '1' } : {}) } });
}
function selectDetailWeek(value: string) {
  router.push({ path: route.path, query: { ...route.query, tab: 'weekly', weekStart: weeklyMonday(value) } });
}
function open(row: WeeklyReport) { router.push({ path: route.path, query: { tab:'weekly', projectId: row.projectId, weekStart: row.weekStart, ...(allWeeks.value ? { fromHistory: '1' } : {}) } }); }
function saved(value: WeeklyDetail) { detail.value = value; unread.markSeen(value); void unread.refresh(); }
function close() { router.push({ path: route.path, query: { tab:'weekly', ...(route.query.fromHistory === '1' ? { projectId:route.query.projectId, history:'1' } : { weekStart:week.value }) } }); }
</script>
<template>
  <section class="weekly-page" :aria-busy="loading">
    <div v-if="error" role="alert"><WeeklyWeekSelect v-if="route.query.projectId && !allWeeks" :model-value="week" @update:model-value="selectDetailWeek" /><el-alert :title="error" type="error" :closable="false" /><el-button @click="load">重新加载</el-button><el-button @click="close">返回列表</el-button></div>
    <WeeklyReportEditor v-else-if="detail" :detail="detail" @saved="saved" @close="close" @change-week="selectDetailWeek" />
    <div v-else-if="showingDetail" class="loading-status" role="status">正在加载周报…</div>
    <template v-else>
      <div class="heading"><div class="heading-copy"><h2>{{ allWeeks ? '项目历周周报' : '项目周报' }}</h2><p>按北京时间周一至周日汇总；下周一 09:00 汇总发送；提交后修改须经审批。</p></div><el-button :loading="loading" @click="load">刷新</el-button></div>
      <div class="filters">
        <div v-if="!allWeeks" class="week-filter" role="group" aria-label="所属周"><span class="filter-label">所属周</span><WeeklyWeekSelect :model-value="week" @update:model-value="selectWeek" /></div>
        <el-select v-model="dept" clearable filterable placeholder="所有部门" aria-label="部门"><el-option v-for="item in departments" :key="item.id" :value="item.id" :label="item.label" /></el-select>
        <el-select v-model="project" clearable filterable placeholder="所有项目" aria-label="项目"><el-option v-for="item in projects" :key="item.id" :value="item.id" :label="item.label" /></el-select>
        <el-select v-model="owner" clearable filterable placeholder="所有负责人" aria-label="负责人"><el-option v-for="item in owners" :key="item.id" :value="item.id" :label="item.label" /></el-select>
        <el-select v-model="status" clearable placeholder="所有填写状态" aria-label="填写状态"><el-option label="未填写" value="missing" /><el-option label="草稿" value="draft" /><el-option label="已提交" value="submitted" /></el-select>
      </div>
      <div v-if="loading" class="loading-status" role="status">正在加载周报…</div>
      <el-empty v-if="!loading && !visible.length" description="当前筛选下暂无周报" />
      <section v-for="section in reportSections" :key="section.key" class="report-section" :aria-labelledby="`weekly-section-${section.key}`">
        <h3 :id="`weekly-section-${section.key}`" class="section-title">{{ section.title }} <span>{{ section.rows.length }}</span></h3>
      <article v-for="row in section.rows" :key="`${row.projectId}-${row.weekStart}`" class="report-card" :class="{'report-card--write': section.key === 'write'}">
        <div class="report-content">
        <div class="card-top"><h4>{{ row.projectName }}</h4><el-tag v-if="row.status !== 'missing' && row.overallStatus" :type="row.overallStatus === 'blocked' ? 'danger' : row.overallStatus === 'risk' ? 'warning' : 'success'">{{ {normal:'正常推进',risk:'存在风险',blocked:'已受阻'}[row.overallStatus] }}</el-tag><el-tag :type="row.status === 'submitted' ? 'success' : 'info'">{{ {missing:'未填写',draft:'草稿',submitted:'已提交'}[row.status] }}</el-tag><el-tag v-if="row.overdue && row.status !== 'submitted'" type="danger">逾期未提交</el-tag></div>
        <div class="report-meta muted"><UserAvatar :name="row.ownerName || '未指定负责人'" :avatar-url="row.ownerAvatarUrl" show-name :size="24" /><span class="report-department">{{ row.deptName || '未指定部门' }}</span><span class="report-period">{{ row.weekStart }} 至 {{ row.weekEnd }}</span></div>
        <p v-if="row.risks" class="excerpt"><strong>主要风险：</strong>{{ row.risks }}</p>
        <p v-if="row.coordination" class="excerpt"><strong>需协调：</strong>{{ row.coordination }}</p>
        </div>
        <el-button :type="section.key === 'write' ? 'primary' : 'default'" size="large" class="report-action" :aria-label="`${row.projectName}：${section.key === 'write' ? '填写周报' : '查看周报'}`" @click="open(row)">{{ section.key === 'write' ? (row.status === 'missing' ? '填写周报' : '继续编辑') : '查看周报' }} <span aria-hidden="true">→</span></el-button>
      </article>
      </section>
    </template>
  </section>
</template>
<style scoped>
.loading-status { padding: 12px 0; color: var(--el-text-color-secondary); font-size: 14px; }
.weekly-page { min-height:200px; } .heading,.card-top,.filters { display:flex; gap:12px; align-items:center; flex-wrap:wrap; } .heading { justify-content:space-between; } h2 { font-size:21px; } .heading p,.muted { color:#758179; font-size:13px; } .filters { margin:16px 0; } .filters>.el-select { width:170px; } .filters label { display:flex; gap:8px; align-items:center; } .report-card { border:1px solid #dfe7e2; border-radius:8px; padding:18px; margin:12px 0; background:white; } h3 { margin:0; font-size:17px; overflow-wrap:anywhere; } .excerpt { white-space:pre-wrap; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; line-height:1.6; } @media(max-width:600px) { .filters>.el-select { width:calc(50% - 6px); } .filters label { width:100%; } .report-card { padding:14px; } }
</style>
<style scoped>
.report-section { margin-top: 28px; }
.section-title { display: flex; align-items: center; gap: 10px; font-size: 19px; color: var(--el-text-color-primary); }
.section-title span { font-size: 14px; font-weight: 400; color: var(--el-text-color-secondary); }
.report-card { display: flex; gap: 24px; align-items: center; justify-content: space-between; }
.report-card--write { border-left: 4px solid var(--el-color-primary); }
.report-content { min-width: 0; flex: 1; }
.report-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 13px 0; }
.card-top h4 { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
.report-action { min-width: 144px; flex-shrink: 0; font-weight: 600; }
.report-action span { margin-left: 10px; }
.week-filter { display:flex; gap:8px; align-items:center; min-width:0; }
.filter-label { flex-shrink:0; white-space:nowrap; }
.report-department::before,.report-period::before { content:'·'; margin-right:6px; }
@media(max-width:600px) {
  .heading { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px 16px; margin-top:8px; }
  .heading-copy { display:contents; }
  .heading h2 { grid-column:1; grid-row:1; margin:0; font-size:21px; line-height:1.4; }
  .heading > .el-button { grid-column:2; grid-row:1; min-width:64px; height:44px; margin:0; }
  .heading p { grid-column:1 / -1; grid-row:2; margin:0; font-size:13px; line-height:1.7; color:var(--el-text-color-regular); }
  .filters { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:20px 0 24px; }
  .week-filter { grid-column:1 / -1; display:flex; flex-direction:column; align-items:stretch; gap:8px; margin-bottom:4px; }
  .filter-label { font-size:14px; font-weight:500; line-height:22px; color:var(--el-text-color-regular); }
  .filters > .el-select { width:100%; min-width:0; }
  .filters :deep(.el-select__wrapper) { min-height:44px; }
  .filters :deep(.el-select__placeholder) { color:var(--el-text-color-regular); }
  .report-section { margin-top:24px; }
  .section-title { font-size:18px; line-height:26px; gap:8px; }
  .report-card { align-items: stretch; flex-direction: column; gap: 12px; }
  .card-top { gap:8px; }
  .card-top h4 { flex-basis:100%; line-height:1.5; }
  .report-meta { gap:8px; margin:12px 0 0; line-height:1.6; }
  .report-period { flex-basis:100%; font-variant-numeric:tabular-nums; }
  .report-period::before { content:none; }
  .report-action { width: 100%; min-height:44px; }
}
</style>
