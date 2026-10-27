<script setup lang="ts">
import { computed, ref, watch, onActivated } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { dashboardApi } from '@/api';
import { useRefreshStore } from '@/stores/refresh';
import { formatBeijingTime } from '@/utils/date-time';
import CountPill from '@/components/CountPill.vue';
import TodoInbox from '@/components/todo/TodoInbox.vue';
import PlanChanges from './PlanChanges.vue';
import TaskApprovalDetail from '@/components/TaskApprovalDetail.vue';
import Closures from './Closures.vue';
import { groupInboxProjects } from '@/utils/todo-inbox';

const route = useRoute();
const router = useRouter();
const refresh = useRefreshStore();
const tab = computed(() => ['history', 'mine', 'related'].includes(String(route.query.view)) ? String(route.query.view) : 'pending');
const hasDetail = computed(() => !!(route.query.changeId || route.query.taskLogId || route.query.taskId || route.query.confirmId || route.query.request));
function backToList() {
  const query = { ...route.query };
  for (const key of ['changeId', 'taskLogId', 'taskId', 'confirmId', 'request', 'at']) delete query[key];
  void router.replace({ query, hash: route.hash });
}
function openRecord(row: any) {
  const url = new URL(row.path, window.location.origin);
  const query = Object.fromEntries(url.searchParams.entries());
  router.push({ path: route.path, query: { ...query, view: tab.value } });
}
function refillChange(row: any) {
  const url = new URL(row.path, window.location.origin);
  const changeId = url.searchParams.get('changeId');
  if (changeId) void router.push({ path: '/tasks', query: { copyChange: changeId } });
}
const kind = ref('');
const kinds = [{ value: 'confirm', label: '任务确认' }, { value: 'accept', label: '任务验收' }, { value: 'change', label: '计划变更' }, { value: 'closure', label: '项目结项' }, { value: 'reopen', label: '项目重开' }];
const rows = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const reloadKey = ref(0);
let version = 0;
const stateFilter = ref('all');
const stateOptions = [{key:'all',label:'全部'},{key:'pending',label:'待审批'},{key:'rejected',label:'已退回'},{key:'approved',label:'已通过'}];
function matchesState(row: any, state: string) {
  if(state === 'all') return true;
  if(state === 'pending') return ['pending','pending_accept','pending_confirm'].includes(row.status);
  return state === 'approved' ? ['approved','done'].includes(row.status) : row.status === state;
}
const stateCounts = computed(() => Object.fromEntries(stateOptions.map(s => [s.key,rows.value.filter(r => (!kind.value || r.kind === kind.value) && matchesState(r,s.key)).length])));
const visible = computed(() => rows.value.filter(row => (!kind.value || row.kind === kind.value) && (tab.value !== 'mine' || matchesState(row,stateFilter.value))));
const projects = computed(() => groupInboxProjects(visible.value));
const collapsed = ref(new Set<string>());
function toggleProject(key: string) {
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  collapsed.value = next;
}
function collapseAll() { collapsed.value = new Set(projects.value.map(project => project.key)); }
watch(tab, () => { collapsed.value = new Set(); });
const status: Record<string, string> = { pending: '待审批', pending_accept: '待验收', pending_confirm: '待确认', approved: '已通过', done: '已通过', rejected: '已退回', doing: '进行中／已退回', todo: '待执行', cancelled: '已取消', withdrawn: '已撤回', voided: '已失效' };
function select(view: string) {
  router.replace({ query: { view } });
}
async function load() {
  const current = ++version;
  if (tab.value === 'pending') { loading.value = false; return; }
  loading.value = true; error.value = ''; rows.value = [];
  try {
    const result = await dashboardApi.approvalRecords(tab.value as 'history' | 'mine' | 'related');
    if (current === version) rows.value = result;
  } catch (e: any) { if (current === version) error.value = e.message || '审批记录加载失败'; }
  finally { if (current === version) loading.value = false; }
}
function reload() { reloadKey.value++; void load(); }
watch(tab, load, { immediate: true });
watch(() => [refresh.versions.task, refresh.versions.project, refresh.versions.planChange], load);
onActivated(load);
</script>

<template>
  <div class="approvals">
    <header><div><h2>审批管理</h2><p>任务确认、验收、计划变更、结项及重开，统一在这里处理。</p></div><el-button @click="reload" :loading="loading">刷新</el-button></header>
    <div class="approval-tools">
      <nav aria-label="审批分类"><button v-for="item in [{ value: 'pending', label: '待我审批' }, { value: 'history', label: '我已审批' }, { value: 'mine', label: '我发起的' }, { value: 'related', label: '与我相关' }]" :key="item.value" :class="{ active: tab === item.value }" :aria-pressed="tab === item.value" @click="select(item.value)">{{ item.label }}</button></nav>
      <el-select v-model="kind" placeholder="全部审批类型" clearable aria-label="审批类型" style="width:180px"><el-option v-for="item in kinds" :key="item.value" :value="item.value" :label="item.label" /></el-select>
    </div>
    <nav v-if="tab === 'mine'" class="state-filters" aria-label="我发起的审批状态">
      <button v-for="s in stateOptions" :key="s.key" :class="{active:stateFilter === s.key}" :aria-pressed="stateFilter === s.key" @click="stateFilter = s.key">{{ s.label }} <CountPill :count="stateCounts[s.key]" /></button>
    </nav>
    <el-dialog :model-value="hasDetail && !route.query.request" title="审批详情" width="min(1180px, 94vw)" top="5vh" append-to-body destroy-on-close class="approval-detail-dialog" :close-on-click-modal="false" @update:model-value="value => { if (!value) backToList(); }">
      <PlanChanges v-if="route.query.changeId" :key="`change-${route.query.changeId}-${reloadKey}`" detail-only />
      <TaskApprovalDetail v-else-if="route.query.taskLogId || route.query.taskId || route.query.confirmId" :key="reloadKey" :at="route.query.at ? String(route.query.at) : undefined" :log-id="route.query.taskLogId ? Number(route.query.taskLogId) : undefined" :task-id="route.query.taskId || route.query.confirmId ? Number(route.query.taskId || route.query.confirmId) : undefined" :kind="route.query.confirmId ? 'confirm' : 'accept'" />
      <template #footer><el-button @click="backToList">关闭</el-button></template>
    </el-dialog>
    <Closures v-if="route.query.request" :key="`closure-${route.query.request}-${reloadKey}`" detail-only />
    <TodoInbox v-if="tab === 'pending'" :key="reloadKey" approval-only :approval-type="kind" :mobile="!!route.meta.mobile" />
    <template v-else>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-skeleton v-if="loading" :rows="5" animated />
      <div v-else class="records">
        <div v-if="projects.length" class="record-tools"><span>共 {{ projects.length }} 个项目 · {{ visible.length }} 条记录</span><div><el-button link @click="collapsed = new Set()">全部展开</el-button><el-button link @click="collapseAll">全部收起</el-button></div></div>
        <section v-for="project in projects" :key="project.key" class="record-project">
          <button type="button" class="project-toggle" :aria-expanded="!collapsed.has(project.key)" :aria-controls="`records-${project.key}`" @click="toggleProject(project.key)">
            <span aria-hidden="true">{{ collapsed.has(project.key) ? '▸' : '▾' }}</span><strong>{{ project.name }}</strong><span class="project-count">{{ project.rows.length }} 条</span><span class="toggle-label">{{ collapsed.has(project.key) ? '展开' : '收起' }}</span>
          </button>
          <div v-show="!collapsed.has(project.key)" :id="`records-${project.key}`" class="project-records">
            <article v-for="row in project.rows" :key="row.key">
              <div>
                <p>{{ kinds.find(k => k.value === (row as any).kind)?.label }}</p><h3>{{ row.title }}</h3>
                <p v-if="row.description" class="description">{{ row.description }}</p>
                <p>审批状态：<span class="approval-status" :data-status="row.status">{{ status[row.status || ''] || row.status || '状态待核实' }}</span></p>
                <p>发起人：{{ (row as any).requesterName || '未记录' }} · 发起时间：{{ (row as any).requestedAt ? formatBeijingTime((row as any).requestedAt) : '未记录' }}</p>
                <p v-if="['approved', 'done', 'rejected'].includes(row.status || '')">审批人：{{ (row as any).approverName || '未记录' }} · {{ row.status === 'rejected' ? '退回时间' : '通过时间' }}：{{ (row as any).reviewedAt ? formatBeijingTime((row as any).reviewedAt) : '未记录' }}</p>
              </div>
              <div class="record-actions">
                <el-button v-if="tab === 'mine' && (row as any).kind === 'change' && row.status === 'rejected'" type="primary" plain @click="refillChange(row)">修改后重新提交</el-button>
                <el-button @click="openRecord(row)">查看详情</el-button>
              </div>
            </article>
          </div>
        </section>
        <el-empty v-if="!error && !visible.length" description="暂无符合条件的审批记录" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.approvals{color:#243e34}header,.approval-tools{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}h2{margin:0 0 8px;font-size:22px}header p,.records p{margin:4px 0;color:#60736b;font-size:13px;line-height:1.7}nav{display:flex;gap:8px;flex-wrap:wrap}nav button{padding:11px 18px;border:1px solid #dce7e1;border-radius:10px;background:white;color:#43594f;font-weight:600;cursor:pointer}nav button.active{background:#246f61;color:white;border-color:#246f61}nav button:focus-visible{outline:2px solid #246f61;outline-offset:3px}.records{background:white;border:1px solid #e1eae5;border-radius:16px;padding:0 20px}.records article{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0;border-bottom:1px solid #edf1ee}.records article:last-child{border-bottom:0}.records h3{font-size:16px;margin:6px 0}.description{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:768px){header,.approval-tools{align-items:flex-start;flex-wrap:wrap}.records{padding:0 14px}}
</style>

<style scoped>
.records{background:transparent;border:0;padding:0}
.record-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;color:#60736b;font-size:13px}
.record-project{margin:0 0 16px 16px;padding:8px;border:1px solid #e1eae5;border-radius:18px;background:#fff}
.record-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;flex-shrink:0}.record-actions .el-button{margin-left:0}
.project-toggle{display:flex;align-items:center;gap:10px;width:100%;padding:14px 16px;border:0;border-radius:12px;background:#f1f6f3;color:#243e34;font:inherit;text-align:left;cursor:pointer}
.project-toggle strong{overflow-wrap:anywhere}.project-toggle:hover{background:#e8f1ec}.project-toggle:focus-visible{outline:2px solid #246f61;outline-offset:-2px}
.project-count,.toggle-label{font-size:13px;color:#52695f;white-space:nowrap}.toggle-label{margin-left:auto}
.project-records{margin:4px 12px 2px 40px}.project-records article{padding:18px 8px}.project-records article>div{min-width:0;overflow-wrap:anywhere}
@media(max-width:768px){.records{padding:0}.record-project{margin-left:4px;padding:6px;border-radius:14px}.project-toggle{padding:12px;gap:8px}.project-records{margin:2px 6px 0 20px}.toggle-label{display:none}.record-tools{flex-wrap:wrap}}
</style>

<style>
.approval-detail-dialog .el-dialog__body{max-height:calc(90vh - 140px);overflow-y:auto;overflow-x:hidden}
@media(max-width:768px){.approval-detail-dialog{--el-dialog-padding-primary:14px}.approval-detail-dialog .el-dialog__body{max-height:calc(90dvh - 140px)}}
</style>

<style scoped>
.approval-status{display:inline-block;padding:2px 9px;border-radius:6px;font-weight:700;color:#52616b;background:#edf1f3}
.approval-status[data-status="approved"],.approval-status[data-status="done"]{color:#176947;background:#e6f5ec}
.approval-status[data-status="rejected"]{color:#b42332;background:#fdebed}
.approval-status[data-status="pending"],.approval-status[data-status="pending_accept"],.approval-status[data-status="pending_confirm"]{color:#935000;background:#fff2d9}
</style>

<style scoped>
.state-filters{margin-bottom:20px;align-items:stretch}.state-filters button{display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:20px}.state-filters button.active{--count-color:#fff}
</style>
