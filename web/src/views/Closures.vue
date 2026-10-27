<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowUp, ArrowDown } from '@element-plus/icons-vue';
import { closuresApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore } from '@/stores/refresh';
import { formatBeijingTime } from '@/utils/date-time';
import ClosureApplicationForm from '@/components/closures/ClosureApplicationForm.vue';
import ClosureReviewPanel from '@/components/closures/ClosureReviewPanel.vue';
import ClosureReport from '@/components/closures/ClosureReport.vue';
import ClosureActions from '@/components/closures/ClosureActions.vue';
import ClosureLedgerTools from '@/components/closures/ClosureLedgerTools.vue';
import DelayProjectGroups from '@/components/closures/DelayProjectGroups.vue';

const props = defineProps<{ detailOnly?: boolean }>();
const route = useRoute(); const router = useRouter(); const auth = useAuthStore(); const refresh = useRefreshStore();
const mode = computed(() => String(route.meta.closureView || 'applications'));
const rows = ref<any[]>([]); const ready = ref<any[]>([]); const delays = ref<any[]>([]);
const ledgerTools = ref<InstanceType<typeof ClosureLedgerTools> | null>(null);
const projectFilter=ref(''); const departmentFilter=ref(''); const ownerFilter=ref(''); const handling=ref('');
const filterSources=computed(()=>[...rows.value.map(r=>({id:r.project_id,name:r.snapshot.project.name,dept:r.snapshot.project.dept_name||'未设置',owners:r.snapshot.owners||[]})),...delays.value.map(r=>({id:r.project_id,name:r.snapshot.projectName,dept:r.snapshot.deptName||'未设置',owners:r.snapshot.owners||[]}))]);
const projectOptions=computed(()=>[...new Map(filterSources.value.map(p=>[String(p.id),p.name])).entries()]);
const departmentOptions=computed(()=>[...new Set(filterSources.value.map(p=>p.dept))]);
const ownerOptions=computed(()=>[...new Map(filterSources.value.flatMap(p=>p.owners.map((o:any)=>[String(o.id),o.name] as [string,string]))).entries()]);
function matches(pid:any,dept:string,owners:any[]){return (!projectFilter.value||String(pid)===projectFilter.value)&&(!departmentFilter.value||(dept||'未设置')===departmentFilter.value)&&(!ownerFilter.value||owners.some(o=>String(o.id)===ownerFilter.value));}
const loading = ref(false); const saving = ref(false); const search = ref(''); const status = ref('');
const selected = ref<any>(null); const detailVisible = ref(false); const preview = ref<any>(null); const applyVisible = ref(false);
const reviewCollapsed = ref(false);
watch([detailVisible,()=>selected.value?.id],()=>{reviewCollapsed.value=false;});
const timeliness = ref(''); const kind = ref(''); const closedDates = ref<[string,string] | null>(null);
const labels: Record<string,string> = { pending: '审核中', approved: '已通过', rejected: '已退回',withdrawn:'已撤回',voided:'报告已失效' };
const delayLabels: Record<string,string> = { task_overdue: '任务延期', project_overdue: '项目完成延期', closure_waiting: '完成后未申请结项' };
const visibleRows = computed(() => rows.value.filter((r) => matches(r.project_id,r.snapshot.project.dept_name,r.snapshot.owners||[]) &&
  (!status.value || r.status === status.value) &&
    (!timeliness.value || (r.report && (timeliness.value === 'late' ? r.report.lateDays > 0 : r.report.lateDays === 0))) &&
    (!closedDates.value || (r.report && formatBeijingTime(r.reviewed_at).slice(0,10) >= closedDates.value[0] && formatBeijingTime(r.reviewed_at).slice(0,10) <= closedDates.value[1])) &&
  `${r.snapshot.project.name} ${r.snapshot.project.dept_name || ''} ${r.snapshot.owners.map((o: any) => o.name).join(' ')}`.includes(search.value)));
const visibleDelays = computed(() => delays.value.filter((r) => matches(r.project_id,r.snapshot.deptName,r.snapshot.owners||[]) && (!handling.value||r.handling_status===handling.value) && (!kind.value || r.kind === kind.value) && `${r.snapshot.projectName} ${r.snapshot.deptName || ''} ${r.snapshot.title} ${r.snapshot.owners.map((o: any) => o.name).join(' ')}`.includes(search.value)));
async function actionUpdated(){refresh.markProjectChanged();await load();if(selected.value)await openRequest(Number(selected.value.id));}
let loaded = false;
async function load() {
  if (props.detailOnly) return;
  loading.value = true;
  try {
    [rows.value, ready.value] = await Promise.all([closuresApi.list(), closuresApi.ready()]);
    loaded = true;
  } catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '加载失败'); }
  finally { loading.value = false; }
}
async function openRequest(id: number) {
  try { selected.value = await closuresApi.one(id); detailVisible.value = true; }
  catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '无法查看'); }
}
async function openApply(id: number) {
  try { preview.value = await closuresApi.preview(id); applyVisible.value = true; }
  catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '无法申请'); }
}
async function submit(body: any) {
  saving.value = true;
  try {
    const r = await closuresApi.submit(Number(preview.value.project.id), body);
    applyVisible.value = false; refresh.markProjectChanged(); ElMessage.success('已提交结项审核');
    await load(); await openRequest(Number(r.id));
  } catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '提交失败'); }
  finally { saving.value = false; }
}
async function review(approve: boolean) {
  try {
    const { value } = await ElMessageBox.prompt(approve ? '通过后项目将结项并锁定，生成报告发送 HR。可填写审核意见。' : '请填写退回原因', approve ? '通过结项申请' : '退回结项申请', {
      inputType: 'textarea', inputValidator: (v) => approve || Boolean(v?.trim()) || '退回原因必填',
    });
    saving.value = true;
    selected.value = await (approve ? closuresApi.approve : closuresApi.reject)(Number(selected.value.id), value || '');
    refresh.markProjectChanged(); ElMessage.success(approve ? '已通过，项目结项生效' : '已退回'); await load(); await openRequest(Number(selected.value.id));
  } catch (e: any) { if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '操作失败'); }
  finally { saving.value = false; }
}
async function followLink() {
  if (route.query.request && /^\d+$/.test(String(route.query.request))) await openRequest(Number(route.query.request));
  else if (route.query.projectId && /^\d+$/.test(String(route.query.projectId))) await openApply(Number(route.query.projectId));
}
async function clearClosedDialogLink() {
  await nextTick();
  if (detailVisible.value || applyVisible.value) return;
  if (route.query.request == null && route.query.projectId == null) return;
  const query = { ...route.query };
  delete query.request;
  delete query.projectId;
  void router.replace({ query, hash: route.hash });
}
async function exportReport() {
  try {
    const file = await closuresApi.exportReport(Number(selected.value.id));
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = file.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '导出失败'); }
}
async function acknowledgeReport() {
  try { await closuresApi.acknowledge(Number(selected.value.hrNotice.id)); await openRequest(Number(selected.value.id)); await load(); ElMessage.success('已确认阅读'); }
  catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '确认失败'); }
}
onMounted(async () => { await load(); await followLink(); });
onActivated(() => { if (loaded) load(); });
watch(() => [route.query.request, route.query.projectId], followLink);
watch(mode, () => { status.value = ''; search.value = ''; load(); });
</script>

<template>
  <div v-loading="loading" class="closures-page">
    <template v-if="!detailOnly">
    <header class="toolbar"><div><h2>结项管理</h2><p>{{ mode === 'delays' ? '保留发生时的事实与计划依据，计划调整不会删除历史记录。' : '任务完成、负责人申请和审批生效分别记录。' }}</p></div><el-button @click="load">刷新</el-button></header>
    <ClosureLedgerTools ref="ledgerTools" @updated="load" />
    <section v-if="mode === 'applications' && ready.length" class="panel">
      <h3 class="panel-title">我负责的已完成项目</h3>
      <div v-for="p in ready" :key="p.projectId" class="ready-row"><div><strong>{{ p.name }}</strong><p class="ready-meta"><span>{{ p.completedDate }} 全部验收完成</span><span :class="{ 'waiting-warning': p.state !== 'pending' && p.waitingDays >= 3 }">{{ p.state === 'pending' ? '结项审批中' : `已等待 ${p.waitingDays} 天` }}</span></p></div><el-button type="primary" plain @click="p.state === 'pending' ? openRequest(Number(p.requestId)) : openApply(Number(p.projectId))">{{ p.state === 'pending' ? '查看审批' : '申请结项' }}</el-button></div>
    </section>
    <section class="panel ledger-panel">
      <div class="filters" aria-label="结项记录筛选"><el-input class="search-filter" v-model="search" placeholder="搜索项目、部门或负责人" clearable /><el-select v-if="mode === 'applications'" v-model="status" placeholder="全部状态" clearable><el-option v-for="(label,key) in labels" :key="key" :value="key" :label="label" /></el-select>
        <el-select v-model="projectFilter" clearable filterable placeholder="全部项目"><el-option v-for="[id,name] in projectOptions" :key="id" :value="id" :label="name" /></el-select>
        <el-select v-model="departmentFilter" clearable filterable placeholder="全部部门"><el-option v-for="name in departmentOptions" :key="name" :value="name" :label="name" /></el-select>
        <el-select v-model="ownerFilter" clearable filterable placeholder="全部负责人"><el-option v-for="[id,name] in ownerOptions" :key="id" :value="id" :label="name" /></el-select>
        <el-select v-if="mode==='delays'" v-model="handling" clearable placeholder="全部处理状态"><el-option value="open" label="待处理"/><el-option value="processing" label="处理中"/><el-option value="resolved" label="已处理"/></el-select>
        <template>
          <el-select v-model="timeliness" placeholder="全部完成时效" clearable><el-option value="ontime" label="按期完成" /><el-option value="late" label="延期完成" /></el-select>
          <div class="date-filter"><el-date-picker v-model="closedDates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="结项开始日期" end-placeholder="结项结束日期" /></div>
        </template>
        <el-select v-if="mode === 'delays'" v-model="kind" placeholder="全部记录类型" clearable><el-option v-for="(label,key) in delayLabels" :key="key" :value="key" :label="label" /></el-select>
      </div>
      <el-table v-if="mode !== 'delays'" :data="visibleRows" border stripe @row-click="(r: any) => openRequest(Number(r.id))" class="clickable" empty-text="暂无符合筛选条件的记录">
        <el-table-column label="项目" min-width="210"><template #default="{row}"><span class="project-name">{{ row.snapshot.project.name }}</span></template></el-table-column>
        <el-table-column label="申请人" width="130" align="center"><template #default="{row}">{{ row.snapshot.requester?.name }}</template></el-table-column>
        <el-table-column label="状态" width="150" align="center"><template #default="{row}"><el-tag :type="row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : row.status === 'rejected' ? 'danger' : 'info'" size="small">{{ row.status === 'pending' && row.snapshot.workflow?.stage === 'final' ? '待总经理终审' : labels[row.status] }}</el-tag></template></el-table-column>
        <el-table-column label="申请时间（北京时间）" width="190"><template #default="{row}"><span class="date-meta">{{ formatBeijingTime(row.requested_at) }}</span></template></el-table-column>
        <el-table-column label="操作" width="120" align="center" fixed="right"><template #default="{row}"><el-button link type="primary" @click.stop="openRequest(Number(row.id))">查看{{ row.report ? '报告' : '申请' }}</el-button></template></el-table-column>
      </el-table>
      <DelayProjectGroups v-else :records="visibleDelays" :labels="delayLabels" @open="(id: number) => ledgerTools?.openDelay(id)" />
    </section>
    </template>
    <el-dialog class="closure-dialog closure-apply-dialog" align-center v-model="applyVisible" @closed="clearClosedDialogLink" destroy-on-close title="申请结项" width="min(1180px, 96vw)">
      <template v-if="preview">
        <h3 class="apply-project-title">{{ preview.project.name }}</h3>
        <el-alert v-if="!preview.ready" :closable="false" type="warning" title="尚有未完成任务或缺少验收日期，暂不能申请结项。" />
        <el-alert v-if="!preview.approverId" :closable="false" type="warning" title="请联系管理员配置总经理终审人。" />
        <ClosureApplicationForm :preview="preview" :saving="saving" @submit="submit" @cancel="applyVisible=false" />
      </template>
    </el-dialog>
    <el-dialog class="closure-dialog closure-report-dialog" :fullscreen="!detailOnly" top="5vh" append-to-body destroy-on-close v-model="detailVisible" @closed="clearClosedDialogLink" :title="selected?.report ? '结项报告' : '结项申请详情'" width="min(1180px, 94vw)">
      <template #header><div class="report-dialog-heading"><strong>{{ selected?.report ? '结项报告' : '结项申请详情' }}</strong><el-button v-if="selected?.snapshot?.workflow" :icon="reviewCollapsed?ArrowDown:ArrowUp" :aria-expanded="!reviewCollapsed" aria-controls="closure-review-area" @click="reviewCollapsed=!reviewCollapsed">{{ reviewCollapsed?'展开审核区':'收起审核区' }}</el-button></div></template>
      <div id="closure-review-area" v-show="!reviewCollapsed"><ClosureReviewPanel v-if="selected?.snapshot?.workflow" :key="selected.id" :request="selected" @updated="actionUpdated" /></div>
      <ClosureReport v-if="selected" :request="selected" @reading="reviewCollapsed=true" />
      <ClosureActions v-if="selected" :request="selected" @updated="actionUpdated" />
      <template #footer><div class="dialog-footer"><el-button @click="detailVisible=false">关闭</el-button><el-button v-if="selected?.report" @click="exportReport">导出 HTML 报告</el-button><el-button v-if="selected?.hrNotice && !selected.hrNotice.acknowledged_at" type="primary" @click="acknowledgeReport">确认已阅</el-button><template v-if="selected?.status === 'pending' && (!selected.snapshot.workflow || selected.snapshot.workflow.stage === 'final') && String(selected.approver_id) === String(auth.user?.id)"><el-button type="danger" plain :loading="saving" @click="review(false)">退回</el-button><el-button type="primary" :loading="saving" @click="review(true)">通过并结项</el-button></template></div></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.report-dialog-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-right:32px}.report-dialog-heading>strong{font-size:18px;color:var(--text-1)}
:global(.closure-report-dialog.is-fullscreen) { display: flex; flex-direction: column; padding: 0; border-radius: 0; }
:global(.closure-report-dialog:not(.is-fullscreen)) { display: flex; flex-direction: column; height: 90dvh; max-height: 90dvh; overflow: hidden; box-sizing: border-box; margin-bottom: 0; }
:global(.closure-report-dialog:not(.is-fullscreen) .report-frame) { height: 58dvh; min-height: 0; }
:global(.closure-report-dialog > .el-dialog__body) { flex: 1; min-height: 0; overflow: auto; }
:global(.closure-report-dialog > .el-dialog__header), :global(.closure-report-dialog > .el-dialog__footer) { flex-shrink: 0; }
.closures-page { min-width: 0; color: var(--text-1); }
.toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; padding: 20px 24px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-card); box-shadow: var(--shadow-sm); }
.toolbar > div { min-width: 0; }
.toolbar h2 { margin: 0; font-size: 20px; font-weight: 700; line-height: 1.4; }
.toolbar p { margin: 6px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.6; }
.panel { min-width: 0; margin-bottom: 16px; padding: 20px 24px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-card); box-shadow: var(--shadow-sm); }
.panel-title { margin: 0 0 16px; font-size: 16px; font-weight: 650; }
.ready-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0; border-top: 1px solid var(--color-border-light); }
.ready-row:last-child { padding-bottom: 0; }
.ready-row > div { min-width: 0; }
.ready-row strong, .project-name { color: var(--text-1); font-weight: 600; overflow-wrap: anywhere; }
.ready-row > .el-button { flex-shrink: 0; }
.ready-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.6; font-variant-numeric: tabular-nums; }
.filters { display: flex; flex-wrap:wrap; gap: 12px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--color-border-light); }
.filters > .el-select { flex:1 1 170px; }
.filters > .search-filter { flex:2 1 300px; }
.filters > .date-filter { flex:0 1 360px; max-width:100%; }
.date-filter :deep(.el-date-editor) { width:100%; min-width:0; box-sizing:border-box; }
.date-filter :deep(.el-range-input) { min-width:0; }
.filters .el-input, .filters .el-select, .filters .date-filter { width: 100%; min-width: 0; }
.filters .search-filter, .filters .date-filter { grid-column: span 2; }
.clickable { width: 100%; cursor: pointer; border-radius:var(--radius-md); }
.clickable :deep(.cell) { padding-left:16px; padding-right:16px; }
.clickable :deep(.el-table__cell) { border-right:1px solid var(--el-table-border-color); border-bottom:1px solid var(--el-table-border-color); }
.ledger-panel :deep(.el-table th.el-table__cell) { background: var(--color-bg); color: var(--text-2); }
.date-meta { color: var(--text-2); font-size: 13px; font-variant-numeric: tabular-nums; }
.waiting-warning { color: #996015; font-weight: 600; }
.apply-project-title { margin: 0 0 16px; color: var(--text-1); font-size: 18px; line-height: 1.5; overflow-wrap: anywhere; }
.closure-dates, .closure-note { color: var(--text-2); font-size: 14px; line-height: 1.7; }
.closure-dates { margin: 16px 0; font-variant-numeric: tabular-nums; }
.closure-timing { display: grid; gap: 12px; margin: 20px 0 16px; padding: 16px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.closure-timing-item { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin: 0; color: var(--color-primary-700); font-size: 16px; font-weight: 600; line-height: 1.6; }
.closure-timing-item.is-warning { color: #996015; }
.closure-timing-value { display: inline-flex; align-items: baseline; gap: 6px; font-size: 24px; font-weight: 700; line-height: 1.3; font-variant-numeric: tabular-nums; }
.closure-timing-unit { font-size: 15px; font-weight: 600; }
.closure-note { margin: 0 0 16px; }
.dialog-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.dialog-footer .el-button { margin-left: 0; }
.closure-dialog :deep(.el-dialog__header) { padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.closure-dialog :deep(.el-dialog__body) { padding-top: 20px; }
.closure-dialog :deep(.el-dialog__footer) { padding-top: 16px; border-top: 1px solid var(--border); }
@media (max-width: 640px) {
  .toolbar, .panel { padding: 16px; border-radius: var(--radius-md); }
  .toolbar h2 { font-size: 18px; }
  .filters { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .filters .search-filter, .filters .date-filter { grid-column: auto; }
  .ready-row { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .ready-meta { font-size: 14px; }
  .dialog-footer .el-button { min-height: 40px; }
  .closure-timing-value { font-size: 22px; }
}
</style>
