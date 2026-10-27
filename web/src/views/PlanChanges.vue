<script setup lang="ts">
import { ref, computed, onActivated, onMounted, shallowRef, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { planChangesApi, usersApi, departmentsApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore, type RefreshSnapshot } from '@/stores/refresh';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { projectOwnerIds } from '@/utils/project-owner';
import ApprovalFlow from '@/components/ApprovalFlow.vue';
import { formatBeijingTime } from '@/utils/date-time';

const props = defineProps<{ detailOnly?: boolean }>();
const loadError = ref('');
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const linkMessage = ref('');
const refreshStore = useRefreshStore();
const list = ref<any[]>([]);
const users = ref<any[]>([]);
const depts = ref<any[]>([]);
const loading = ref(false);
const hasLoaded = shallowRef(false);
const seenRefreshVersions = shallowRef<RefreshSnapshot>(refreshStore.snapshot());
const activeTab = ref<'approve' | 'history' | 'mine'>('approve');

const meId = computed(() => auth.user?.id);
const deptName = (id: number | null) => depts.value.find((d) => String(d.id) === String(id))?.name || '未分组';
const userName = (id: number | null) => (id == null ? '—' : users.value.find((u) => String(u.id) === String(id))?.name || '—');
// 变更单所属项目的负责人集合（多选：后端给 projectOwnerIds，旧数据只有 projectOwnerId）
const ownerIdsOf = (c: any): number[] =>
  Array.isArray(c?.projectOwnerIds) && c.projectOwnerIds.length
    ? c.projectOwnerIds.map(Number)
    : c?.projectOwnerId != null
      ? [Number(c.projectOwnerId)]
      : [];
const meIsOwner = (c: any): boolean =>
  meId.value != null && ownerIdsOf(c).some((id) => String(id) === String(meId.value));

const STATUS_META: Record<string, { label: string; type: any }> = {
  pending: { label: '待审批', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已退回', type: 'danger' },
  cancelled: { label: '已撤销', type: 'info' },
};
const TYPE_META: Record<string, string> = {
  date: '改日期', delete: '删除任务',
  add: '新增任务', assignee: '改执行人', acceptor: '改负责人', reorder: '调整顺序',
};
const hiddenLegacyChangeTypes = new Set(['priority', 'deliverable']);

const idsToNames = (ids: any[]) => (Array.isArray(ids) && ids.length ? ids.map((id) => userName(id)).join('、') : '未设置');

function itemSummary(it: any): string {
  if (it.changeType === 'delete') return '删除任务';
  const b = it.before ?? {};
  const a = it.after ?? {};
  if (it.changeType === 'add') {
    const dates = [a.startAt ? `开始${a.startAt}` : '', a.dueAt ? `截止${a.dueAt}` : ''].filter(Boolean).join(' / ');
    return `新增：${a.title || '未命名'}${dates ? `（${dates}）` : ''}`;
  }
  if (it.changeType === 'date') {
    const before = [b.startAt ? `开始${b.startAt}` : '', b.dueAt ? `截止${b.dueAt}` : ''].filter(Boolean).join(' / ') || '未设日期';
    const after = [a.startAt ? `开始${a.startAt}` : '', a.dueAt ? `截止${a.dueAt}` : ''].filter(Boolean).join(' / ') || '未设日期';
    return `${before} → ${after}`;
  }
  if (it.changeType === 'assignee') return `${idsToNames(b.assigneeIds)} → ${idsToNames(a.assigneeIds)}`;
  if (it.changeType === 'acceptor') return `${idsToNames(b.acceptorIds)} → ${idsToNames(a.acceptorIds)}`;
  if (it.changeType === 'reorder') return `顺序 ${b.sortOrder ?? '—'} → ${a.sortOrder ?? '—'}`;
  return `${JSON.stringify(b)} → ${JSON.stringify(a)}`;
}

function visibleChangeItems(items: any[]) {
  return (items ?? []).filter((it) => !hiddenLegacyChangeTypes.has(it.changeType));
}

function addLocationText(it: any) {
  const a = it.after ?? {};
  if (a.parentClientId) return `新增到「${it.parentTaskTitle || '本次新增父任务'}」下`;
  if (it.taskId) return `新增到「${it.parentTaskTitle || it.taskTitle || '现有父任务'}」下`;
  return '新增为顶层任务';
}

// 与后端 canManageProject 对齐：dept_head 含本部门 + 我管理的部门（managedDeptIds）
const canManageDept = (deptId: any) =>
  String(deptId) === String(auth.user?.deptId) ||
  (auth.managedDeptIds ?? []).includes(Number(deptId));
// 两级审批：存量单(final_approver_id 空)沿用原单级；新单只允许"当前级"审批人操作
const canApprove = (c: any) => {
  if (c.status !== 'pending') return false;
  if (c.finalApproverId == null) {
    return auth.has('admin') || auth.has('leader') || meIsOwner(c) ||
      (auth.has('dept_head') && canManageDept(c.projectDeptId));
  }
  // owner 级：任一负责人可审（与后端一致）
  if (c.stage === 'owner') return meIsOwner(c);
  // 终审级：单上总经办负责人(指定审批人)，或管理员；不放开给其它领导
  return auth.has('admin') || String(c.finalApproverId) === String(meId.value);
};
// 待审阶段的展示文案：负责人级 / 总经办终审级
const pendingStatus = (c: any) => {
  if (c.status !== 'pending') return STATUS_META[c.status]?.label || c.status;
  if (c.finalApproverId != null) return c.stage === 'owner' ? '待项目负责人' : '待总经办终审';
  return '待审批';
};
// 审批轨迹：谁通过了/谁在等/谁退回/谁未到该级
// 关键：流程一旦在某一级被退回或撤销，其后的级别就不会再发生；
// 未产生结论的级别应显示"未到该级"，不能默认画成"待审批"误导（原缺陷）。
function approvalSteps(c: any) {
  const steps: any[] = [];
  if (c.finalApproverId == null) return [{ label: '审批人', state: c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : c.status === 'cancelled' ? 'skipped' : 'pending', byId: c.approverId, at: c.reviewedAt, comment: c.approverComment }];
  const ended = c.status === 'rejected' || c.status === 'cancelled';
  const ownerExists =
    c.ownerApproverId != null || c.stage === 'owner' || c.rejectedStage === 'owner';
  if (ownerExists) {
    if (c.rejectedStage === 'owner') {
      steps.push({ label: '项目负责人', state: 'rejected', byId: c.approverId ?? null, at: c.reviewedAt ?? null, comment: c.approverComment ?? null });
    } else if (c.ownerApproverId != null) {
      steps.push({ label: '项目负责人', state: 'approved', byId: c.ownerApproverId, at: c.ownerApprovedAt ?? null, comment: c.ownerComment ?? null });
    } else {
      // 未轮到/未到：仅在仍在流转时显示"待审批"，否则该级实际未发生
      steps.push({ label: '项目负责人', state: ended ? 'skipped' : 'pending', byId: c.projectOwnerId ?? null, at: null, comment: null });
    }
  }
  if (c.finalApproverId != null) {
    let state: 'pending' | 'approved' | 'rejected' | 'skipped' = 'pending';
    let byId: number | null = c.finalApproverId ?? null;
    let at: string | null = null;
    let comment: string | null = null;
    if (c.status === 'approved') {
      state = 'approved'; byId = c.approverId ?? null; at = c.reviewedAt ?? null; comment = c.approverComment ?? null;
    } else if (c.status === 'rejected' && c.rejectedStage === 'final') {
      state = 'rejected'; byId = c.approverId ?? null; at = c.reviewedAt ?? null; comment = c.approverComment ?? null;
    } else if (ended) {
      // 前面级别已退回或申请人已撤销：总经办这一级实际不会发生
      state = 'skipped';
    }
    steps.push({ label: '总经办负责人', state, byId, at, comment });
  }
  return steps;
}

// 待我审核：待审批且我有审批权
const approveList = computed(() => list.value.filter((c) => canApprove(c)));
// 我发起的
const mineList = computed(() => list.value.filter((c) => String(c.requesterId) === String(meId.value)));
// 审批历史可见范围：admin/leader 全量；项目负责人看自己项目的；部门负责人看本部门
const historyList = computed(() =>
  list.value.filter((c) => {
    if (String(c.finalApproverId) === String(meId.value)) return true;
    if (auth.has('admin') || auth.has('leader')) return true;
    if (meIsOwner(c)) return true;
    if (auth.has('dept_head') && canManageDept(c.projectDeptId)) return true;
    return false;
  }),
);

// 审批历史：按部门 → 项目分组；项目内待审批在上，历史时间倒序（越早越下面）
const grouped = computed(() => {
  const map = new Map<number, Map<number, any[]>>();
  for (const c of historyList.value) {
    const deptId = c.projectDeptId ?? 0;
    if (!map.has(deptId)) map.set(deptId, new Map());
    const projMap = map.get(deptId)!;
    if (!projMap.has(c.projectId)) projMap.set(c.projectId, []);
    projMap.get(c.projectId)!.push(c);
  }
  const groups: any[] = [];
  for (const [deptId, projMap] of map) {
    const projects: any[] = [];
    for (const [projectId, reqs] of projMap) {
      reqs.sort((a, b) => {
        const pa = a.status === 'pending' ? 0 : 1;
        const pb = b.status === 'pending' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      projects.push({ projectId, projectName: reqs[0]?.projectName || '—', requests: reqs });
    }
    projects.sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh'));
    groups.push({ deptId, projects });
  }
  groups.sort((a, b) => deptName(a.deptId).localeCompare(deptName(b.deptId), 'zh'));
  return groups;
});

// 详情展开
const expandedId = ref<number | null>(null);
const detail = ref<any>(null);
const addDetailVisible = ref(false);
const addDetailItem = ref<any>(null);
async function toggleDetail(c: any) {
  if (props.detailOnly) return;
  if (expandedId.value === c.id) {
    expandedId.value = null;
    detail.value = null;
    if (String(route.query.changeId) === String(c.id)) {
      const query = { ...route.query };
      delete query.changeId;
      await router.replace({ query, hash: route.hash });
    }
    return;
  }
  expandedId.value = c.id;
  detail.value = await planChangesApi.one(c.id);
}

function openAddDetail(it: any) {
  addDetailItem.value = it;
  addDetailVisible.value = true;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [cs, us, ds] = await Promise.all([props.detailOnly ? planChangesApi.one(Number(route.query.changeId)).then(c => [c]) : planChangesApi.list(), usersApi.list(), departmentsApi.list()]);
    list.value = cs;
    users.value = us;
    depts.value = ds;
    seenRefreshVersions.value = refreshStore.snapshot();
    hasLoaded.value = true;
    await focusLinkedChange();
  } catch (e: any) {
    list.value = []; detail.value = null; loadError.value = e.message || '审批详情加载失败';
  } finally {
    loading.value = false;
  }
}

async function approve(c: any) {
  await planChangesApi.approve(c.id);
  refreshStore.markProjectPlanChanged();
  ElMessage.success('已通过，变更已生效');
  expandedId.value = null;
  detail.value = null;
  await load();
}
async function reject(c: any) {
  const { value } = await ElMessageBox.prompt('退回意见（可留空）', '退回申请', {
    confirmButtonText: '退回', cancelButtonText: '取消', inputPlaceholder: '填写退回原因',
  });
  await planChangesApi.reject(c.id, value || undefined);
  refreshStore.markPlanChangeChanged();
  ElMessage.success('已退回');
  expandedId.value = null;
  detail.value = null;
  await load();
}
// 被退回的申请：跳转到任务管理页，用原内容预填后走"新建申请"重发（原单保留，不重复造轮子）
function copyRelaunch(c: any) {
  router.push({ path: '/tasks', query: { copyChange: String(c.id) } });
}
async function cancel(c: any) {
  await ElMessageBox.confirm('确定撤销该变更申请？', '撤销确认', {
    type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消',
  });
  await planChangesApi.remove(c.id);
  refreshStore.markPlanChangeChanged();
  ElMessage.success('已撤销');
  await load();
}

async function focusLinkedChange() {
  linkMessage.value = '';
  const id = String(route.query.changeId || '');
  if (!id) return;
  const item = list.value.find(c => String(c.id) === id);
  if (!item) { linkMessage.value = '未找到该变更申请，可能已移除或当前账号无权查看。'; return; }
  activeTab.value = canApprove(item) ? 'approve' : String(item.requesterId) === String(meId.value) ? 'mine' : 'history';
  if (item.status !== 'pending') linkMessage.value = '该申请' + (STATUS_META[item.status]?.label || '已处理') + '，以下为当前记录。';
  else if (!canApprove(item)) linkMessage.value = '该申请当前无需您审批，可查看当前流程状态。';
  expandedId.value = item.id;
  detail.value = props.detailOnly ? item : await planChangesApi.one(item.id);
  await nextTick();
  document.getElementById('change-' + id)?.scrollIntoView({ block: 'center' });
}
watch(() => route.query.changeId, () => { if (hasLoaded.value) void focusLinkedChange(); });
onMounted(load);

onActivated(() => {
  if (!hasLoaded.value) return;
  if (refreshStore.isStale(seenRefreshVersions.value, ['project', 'task', 'planChange'])) load();
});
</script>

<template>
  <div class="pc-wrap">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
    <el-alert v-if="linkMessage" :title="linkMessage" type="info" :closable="false" style="margin-bottom:16px" />
    <div v-if="!detailOnly" class="top-bar">
      <el-radio-group v-model="activeTab" size="default">
        <el-radio-button value="approve">待我审核（{{ approveList.length }}）</el-radio-button>
        <el-radio-button value="history">审批历史</el-radio-button>
        <el-radio-button value="mine">我发起的</el-radio-button>
      </el-radio-group>
      <div class="top-spacer"></div>
      <el-button :loading="loading" @click="load">
        <el-icon style="margin-right:6px"><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <!-- 待我审核 / 我发起的：扁平列表 -->
    <div v-if="detailOnly || activeTab !== 'history'" v-loading="loading" class="pc-list">
      <el-empty v-if="!loadError && !loading && !(detailOnly ? list : activeTab === 'approve' ? approveList : mineList).length" description="暂无数据" />
      <div
        v-for="c in (detailOnly ? list : activeTab === 'approve' ? approveList : mineList)"
        :key="c.id" :id="`change-${c.id}`"
        class="pc-card"
        :class="{ 'is-pending': c.status === 'pending', 'linked-change': String(c.id) === String(route.query.changeId) }"
      >
        <div class="pc-row" @click="toggleDetail(c)">
          <div class="pc-main">
            <span class="pc-project" :title="c.projectName">{{ c.projectName }}</span>
            <el-tag :type="STATUS_META[c.status]?.type" size="small" round>{{ pendingStatus(c) }}</el-tag>
            <span class="pc-items">{{ c.itemCount }} 项</span>
          </div>
          <div class="pc-meta">
            <span class="pc-reason" :title="c.reason">{{ c.reason }}</span>
            <span class="pc-who" :title="`${userName(c.requesterId)} · 北京时间`">发起人：{{ userName(c.requesterId) }} · {{ formatBeijingTime(c.createdAt) }}</span>
          </div>
          <div class="pc-actions" @click.stop>
            <template v-if="canApprove(c)">
              <el-button size="small" type="success" @click="approve(c)">通过</el-button>
              <el-button size="small" type="danger" plain @click="reject(c)">退回</el-button>
            </template>
            <el-button v-if="c.status === 'pending' && activeTab === 'mine'" size="small" type="danger" plain @click="cancel(c)">撤销</el-button>
            <el-button v-if="c.status === 'rejected' && meId != null && String(c.requesterId) === String(meId)" size="small" type="primary" plain @click="copyRelaunch(c)">修改后重新提交</el-button>
          </div>
        </div>
        <div v-if="expandedId === c.id && detail" class="pc-detail">
          <div v-for="it in visibleChangeItems(detail.items)" :key="it.id" class="pc-item">
            <span class="pc-type">{{ TYPE_META[it.changeType] || it.changeType }}</span>
            <span class="pc-task" :title="it.taskTitle">{{ it.taskTitle }}</span>
            <span class="pc-summary" :title="itemSummary(it)">{{ itemSummary(it) }}</span>
            <el-button v-if="it.changeType === 'add'" size="small" plain @click="openAddDetail(it)">详情</el-button>
          </div>
          <ApprovalFlow :steps="approvalSteps(c)" :user-name="userName" />
          <div v-if="detail.approverComment && detail.finalApproverId == null" class="pc-comment">审核意见：{{ detail.approverComment }}</div>
        </div>
      </div>
    </div>

    <!-- 审批历史：部门 → 项目 分组 -->
    <div v-else v-loading="loading" class="pc-tree">
      <el-empty v-if="!loading && !grouped.length" description="暂无审批历史" />
      <div v-for="g in grouped" :key="g.deptId" class="pc-dept">
        <div class="pc-dept-head" :title="deptName(g.deptId)">🏢 {{ deptName(g.deptId) }}</div>
        <div v-for="p in g.projects" :key="p.projectId" class="pc-project">
          <div class="pc-project-head">
            <span class="pp-name" :title="p.projectName">📁 {{ p.projectName }}</span>
            <span class="pp-count">{{ p.requests.filter((c: any) => c.status === 'pending').length }} 待审 · {{ p.requests.length }} 条</span>
          </div>
          <div v-for="c in p.requests" :key="c.id" :id="`change-${c.id}`" class="pc-card" :class="{ 'is-pending': c.status === 'pending', 'linked-change': String(c.id) === String(route.query.changeId) }">
            <div class="pc-row" @click="toggleDetail(c)">
              <div class="pc-main">
                <el-tag :type="STATUS_META[c.status]?.type" size="small" round>{{ pendingStatus(c) }}</el-tag>
                <span class="pc-items">{{ c.itemCount }} 项</span>
                <span class="pc-reason" :title="c.reason">{{ c.reason }}</span>
              </div>
              <div class="pc-meta">
                <span class="pc-who" :title="`${userName(c.requesterId)} · 北京时间`">{{ userName(c.requesterId) }} · {{ formatBeijingTime(c.createdAt) }}</span>
              </div>
              <div class="pc-actions" @click.stop>
                <template v-if="canApprove(c)">
                  <el-button size="small" type="success" @click="approve(c)">通过</el-button>
                  <el-button size="small" type="danger" plain @click="reject(c)">退回</el-button>
                </template>
              </div>
            </div>
            <div v-if="expandedId === c.id && detail" class="pc-detail">
              <div v-for="it in visibleChangeItems(detail.items)" :key="it.id" class="pc-item">
                <span class="pc-type">{{ TYPE_META[it.changeType] || it.changeType }}</span>
                <span class="pc-task" :title="it.taskTitle">{{ it.taskTitle }}</span>
                <span class="pc-summary" :title="itemSummary(it)">{{ itemSummary(it) }}</span>
                <el-button v-if="it.changeType === 'add'" size="small" type="primary" plain @click="openAddDetail(it)">详情</el-button>
              </div>
              <ApprovalFlow :steps="approvalSteps(c)" :user-name="userName" />
              <div v-if="detail.approverComment && detail.finalApproverId == null" class="pc-comment">审核意见：{{ detail.approverComment }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="addDetailVisible" title="新增任务详情" width="520px" align-center>
      <div v-if="addDetailItem" class="add-detail">
        <div class="add-detail-row">
          <span class="add-detail-label">任务名称</span>
          <span class="add-detail-value">{{ addDetailItem.after?.title || '未命名' }}</span>
        </div>
        <div class="add-detail-row">
          <span class="add-detail-label">新增位置</span>
          <span class="add-detail-value">{{ addLocationText(addDetailItem) }}</span>
        </div>
        <div class="add-detail-row">
          <span class="add-detail-label">开始日期</span>
          <span class="add-detail-value">{{ addDetailItem.after?.startAt || '未设置' }}</span>
        </div>
        <div class="add-detail-row">
          <span class="add-detail-label">截止日期</span>
          <span class="add-detail-value">{{ addDetailItem.after?.dueAt || '未设置' }}</span>
        </div>
        <div class="add-detail-row">
          <span class="add-detail-label">执行人</span>
          <span class="add-detail-value">{{ idsToNames(addDetailItem.after?.assigneeIds) }}</span>
        </div>
        <div class="add-detail-row">
          <span class="add-detail-label">负责人</span>
          <span class="add-detail-value">{{ idsToNames(addDetailItem.after?.acceptorIds) }}</span>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="addDetailVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.linked-change { outline:2px solid #288174; outline-offset:2px; scroll-margin-top:90px; }
@media(max-width:768px) { .top-bar,.pc-row,.pc-main,.pc-meta { flex-wrap:wrap; } .pc-actions { width:100%; justify-content:flex-end; } .pc-project { max-width:100%; overflow-wrap:anywhere; } .pc-item { flex-wrap:wrap; } }
.pc-wrap { --ink: #1f2733; --ink-3: #8a94a6; --line: #eef1f5; }
.top-bar {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 22px; margin-bottom: 14px;
}
.top-spacer { flex: 1; }
.pc-list { display: flex; flex-direction: column; gap: 10px; min-height: 200px; }
.pc-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; }
.pc-card.is-pending { border-left: 3px solid var(--color-warning); }
.pc-row { display: flex; align-items: center; gap: 14px; cursor: pointer; }
.pc-list .pc-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 132px; }
.pc-list .pc-actions { justify-content: flex-end; }
.pc-main { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.pc-project { font-size: 15px; font-weight: 600; color: var(--ink); }
.pc-items { font-size: 12px; color: var(--ink-3); flex-shrink: 0; }
.pc-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pc-reason { font-size: 13px; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; line-height: 1.6; }
.pc-who { font-size: 12px; color: var(--ink-3); }
.pc-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.pc-detail { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 10px; }
.pc-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
.pc-type { font-size: 11px; font-weight: 600; border-radius: 4px; padding: 0 6px; line-height: 18px; background: var(--color-info-bg); color: var(--color-info); flex-shrink: 0; }
.pc-task { font-weight: 500; color: var(--ink); }
.pc-summary { color: var(--ink-3); }
.pc-comment { margin-top: 6px; font-size: 12px; color: #b45309; background: #fff7ed; border-radius: 6px; padding: 6px 10px; }

.add-detail { display: flex; flex-direction: column; gap: 10px; }
.add-detail-row {
  display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px;
  padding: 10px 12px; border: 1px solid #e6ecea; border-radius: 8px; background: #f8fbfa;
}
.add-detail-label { color: #52615d; font-weight: 700; }
.add-detail-value { color: var(--ink); font-weight: 600; word-break: break-all; }

.pc-tree { display: flex; flex-direction: column; gap: 16px; min-height: 200px; }
.pc-dept { display: flex; flex-direction: column; gap: 12px; }
.pc-dept-head {
  font-size: 15px; font-weight: 700; color: var(--brand-hover);
  background: var(--brand-light); border-left: 4px solid var(--brand);
  border-radius: 8px; padding: 10px 14px;
}
.pc-project { display: flex; flex-direction: column; gap: 8px; margin-left: 14px; }
.pc-project-head { display: flex; align-items: center; gap: 10px; }
.pp-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.pp-count { font-size: 12px; color: var(--ink-3); }

@media (max-width: 760px) {
  .pc-list .pc-row { display: flex; }
  .pc-row { flex-wrap: wrap; }
  .pc-main, .pc-meta { flex-basis: 100%; }
  .pc-main { flex-wrap: wrap; }
  .pc-actions { margin-left: auto; }
}

</style>
