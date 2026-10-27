<script setup lang="ts">
import { ref, shallowRef, computed, watch, nextTick, onActivated, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { tasksApi, projectsApi, departmentsApi, usersApi, planChangesApi, feishuApi } from '@/api';
import TaskRow from './TaskRow.vue';
import TaskCompletionTag from '@/components/TaskCompletionTag.vue';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore, type RefreshSnapshot } from '@/stores/refresh';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Plus, Clock, User, ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { leafRisk, riskDays } from '@/utils/task-risk';
import { deriveTaskRange } from '@/utils/task-dates';
import { assetFileName, assetSourceType, isAssetPreviewable, normalizePreviewBlob } from '@/utils/task-assets';
import { normalizeNumericIds, toNullableNumericId, toNumericId } from '@/utils/ids';
import { isOwnerOf, canApplyProjectClosure } from '@/utils/project-owner';
import { logActionMeta, logNote } from '@/utils/task-log';
import UserSelect from '@/components/UserSelect.vue';
import SmartSelect from '@/components/SmartSelect.vue';
import DatePick from '@/components/DatePick.vue';
import TaskMaterialLink from '@/components/TaskMaterialLink.vue';
import ExistingTaskAssetsSelect from '@/components/ExistingTaskAssetsSelect.vue';
import { assetLinksProgress, assetProgressIds } from '@/utils/task-assets';
import NoMaterialReasonSelect from '@/components/NoMaterialReasonSelect.vue';
import { progressMaterialReason } from '@/utils/no-material-reason';
import { materialConfirmationMessage } from '@/utils/material-confirmation';
import { checkWeeklyProgressBeforeAcceptance } from '@/utils/weekly-acceptance';
import TaskProgressWeek from '@/components/TaskProgressWeek.vue';
import { assetDisplayTitle } from '@/utils/task-assets';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const refreshStore = useRefreshStore();
const list = ref<any[]>([]);
const allTasks = ref<any[]>([]);
const projects = ref<any[]>([]);
const users = ref<any[]>([]);
const depts = ref<any[]>([]);
// 各实体下拉选项（给 SmartSelect 用，支持缩写跳字搜索）
const deptFilterItems = computed(() => depts.value.map((d: any) => ({ value: toNumericId(d.id), label: d.name })));
const projectFilterItems = computed(() => projects.value.map((p: any) => ({ value: toNumericId(p.id), label: p.name })));
const loading = ref(false);
const hasLoaded = shallowRef(false);
const seenRefreshVersions = shallowRef<RefreshSnapshot>(refreshStore.snapshot());

const filterStatus = ref('');
const filterProject = ref<number | null>(null);
const filterAssignee = ref<number | null>(null);
const filterDept = ref<number | null>(null);
// 只定位不筛选（URL ?focusProject=）：列表仍显示全部任务，仅展开并滚动到该项目
const focusedOnlyProjectId = ref<number | null>(null);
// 聚焦的具体任务（URL ?taskId=），展开其父阶段并定位到该任务
const focusedTaskId = ref<number | null>(null);
type QuickTaskFilter = '' | 'doing' | 'overdue' | 'atRisk';
const quickFilter = shallowRef<QuickTaskFilter>('');
// 「仅显示我参与的项目」：整项目粒度（我创建/负责，或其中有我的任务的项目都整个显示）
// 普通成员默认开（避免一屏全是全公司任务），admin/leader/dept_head 默认看全部
const showMine = ref(!(auth.has('admin') || auth.has('leader') || auth.has('dept_head')));
watch(showMine, load);

const STATUS_META: Record<string, { label: string; type: any }> = {
  pending_confirm: { label: '待确认', type: 'warning' },
  todo: { label: '待办', type: 'info' },
  doing: { label: '进行中', type: 'primary' },
  pending_accept: { label: '待验收', type: 'warning' },
  done: { label: '已完成', type: 'success' },
  rejected: { label: '已退回', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' },
};
const statusLabel = (s: string) => STATUS_META[s]?.label || s;
const statusType = (s: string) => STATUS_META[s]?.type || 'info';

// 用 String() 宽松比较，避免 bigint 序列化成字符串导致匹配不上
const projectName = (id: number) => projects.value.find((p) => String(p.id) === String(id))?.name || '—';
const isProjectLocked = (id: number) => !!projects.value.find((p) => String(p.id) === String(id))?.planLocked;
const isProjectFrozen = (id: number) => { const p = projects.value.find((p) => String(p.id) === String(id)); return p?.status === 'archived' || ['pending', 'closed'].includes(p?.closureState); };
const canApplyClosure = (id: number) => canApplyProjectClosure(projects.value.find((p) => String(p.id) === String(id)), auth.user?.id, auth.has('admin'));
const userName = (id: number | null) => (id == null ? '—' : users.value.find((u) => String(u.id) === String(id))?.name || '—');
const deptName = (id: number | null) => (id == null ? '—' : depts.value.find((d) => String(d.id) === String(id))?.name || '—');

// 任务层级配色：每级一个颜色，视觉区分
function deptPriorityRank(deptId: number | null) {
  if (deptId == null || Number(deptId) === 0) return 3;
  if (String(deptId) === String(auth.user?.deptId)) return 0;
  if (auth.managedDeptIds.includes(Number(deptId))) return 1;
  return 2;
}

function projectPlanRank(projectId: number | null) {
  if (projectId == null || Number(projectId) === 0) return 2;
  return isProjectLocked(Number(projectId)) ? 0 : 1;
}

function projectOwnerRank(projectId: number | null) {
  if (!(auth.has('admin') || auth.has('leader') || auth.has('dept_head'))) return 1;
  if (projectId == null || Number(projectId) === 0) return 1;
  const project = projects.value.find((p) => String(p.id) === String(projectId));
  return isOwnerOf(project, auth.user?.id) ? 0 : 1;
}

function compareDeptGroups(a: any, b: any) {
  const deptDiff = deptPriorityRank(a.deptId) - deptPriorityRank(b.deptId);
  if (deptDiff) return deptDiff;
  const riskDiff = b.risk - a.risk;
  if (riskDiff) return riskDiff;
  const overdueDiff = b.overdue - a.overdue;
  if (overdueDiff) return overdueDiff;
  const atRiskDiff = b.atRisk - a.atRisk;
  if (atRiskDiff) return atRiskDiff;
  return deptName(a.deptId).localeCompare(deptName(b.deptId), 'zh');
}

function compareProjectGroups(a: any, b: any) {
  const ownerDiff = projectOwnerRank(a.projectId) - projectOwnerRank(b.projectId);
  if (ownerDiff) return ownerDiff;
  const planDiff = projectPlanRank(a.projectId) - projectPlanRank(b.projectId);
  if (planDiff) return planDiff;
  const riskDiff = b.risk - a.risk;
  if (riskDiff) return riskDiff;
  const overdueDiff = b.overdue - a.overdue;
  if (overdueDiff) return overdueDiff;
  const atRiskDiff = b.atRisk - a.atRisk;
  if (atRiskDiff) return atRiskDiff;
  return projectName(a.projectId).localeCompare(projectName(b.projectId), 'zh');
}

const DEPTH_COLORS = ['#1e6258', '#237266', '#288174', '#2e8b7e', '#38a090', '#3fb1a1', '#52c1b1'];
const depthColor = (depth: number) => DEPTH_COLORS[depth % DEPTH_COLORS.length];

const isAdminLeader = computed(() => auth.has('admin') || auth.has('leader') || auth.has('dept_head'));
const canViewOperationLogs = computed(() => auth.has('admin') || auth.has('leader') || auth.has('dept_head'));
const ownedProjectIds = computed(() => new Set<number>(
  projects.value.filter((p) => isOwnerOf(p, auth.user?.id)).map((p) => Number(p.id)),
));

// 我可管理的项目 id 集合（admin/leader 全部；dept_head = 归属部门 ∪ 可管理部门；项目负责人=我负责的项目）
const editableProjectIds = computed(() => {
  const ids = new Set<number>();
  for (const p of projects.value) {
    if (
      auth.has('admin') ||
      auth.has('leader') ||
      isOwnerOf(p, auth.user?.id) ||
      (auth.has('dept_head') &&
        (String(p.deptId) === String(auth.user?.deptId) || auth.managedDeptIds.includes(Number(p.deptId))))
    ) {
      ids.add(Number(p.id));
    }
  }
  return ids;
});
// 可新增任务的项目：普通员工仅限“我是项目负责人”的项目；admin/leader/dept_head 走可管理项目范围
const creatableProjectIds = computed(() => {
  const ids = new Set<number>();
  for (const p of projects.value) {
    if (!p.planLocked && editableProjectIds.value.has(Number(p.id))) ids.add(Number(p.id));
  }
  return ids;
});
const creatableProjects = computed(() => projects.value.filter((p) => creatableProjectIds.value.has(Number(p.id))));
const createProjectOptions = computed(() => (editingId.value ? projects.value : creatableProjects.value));
const createProjectItems = computed(() => createProjectOptions.value.map((p: any) => ({ value: toNumericId(p.id), label: p.name })));
// 主负责人（ownerIds 首项，兼容旧 ownerId）：用于默认验收人
const projectOwnerId = (projectId: number | null) => {
  if (projectId == null) return null;
  const project = projects.value.find((p) => String(p.id) === String(projectId));
  const primary = Array.isArray(project?.ownerIds) && project.ownerIds.length
    ? Number(project.ownerIds[0])
    : project?.ownerId;
  return primary == null ? null : Number(primary);
};
const canCreateTaskInProject = (projectId: number | null) =>
  projectId != null && creatableProjectIds.value.has(Number(projectId));
function defaultAcceptorIdsForProject(projectId: number | null) {
  const ownerId = projectOwnerId(projectId);
  return ownerId == null ? [] : [ownerId];
}

// 总览统计
const totalCount = computed(() => allTasks.value.length);
const doneCount = computed(() => allTasks.value.filter((t) => t.status === 'done').length);
const doingCount = computed(() => allTasks.value.filter((t) => t.status === 'doing' || t.status === 'pending_accept').length);
const donePct = computed(() => (totalCount.value ? Math.round((doneCount.value / totalCount.value) * 100) : 0));

function resetCollapseForReload() {
  collapseReady.value = false;
}

function setQuickFilter(next: QuickTaskFilter) {
  quickFilter.value = quickFilter.value === next ? '' : next;
  if (quickFilter.value) filterStatus.value = '';
  resetCollapseForReload();
  load();
}

function onStatusFilterChange() {
  quickFilter.value = '';
  resetCollapseForReload();
  load();
}

async function load() {
  loading.value = true;
  try {
    const [tasks, projs, usrs, ds] = await Promise.all([
      tasksApi.list({
        status: quickFilter.value ? undefined : filterStatus.value || undefined,
        projectId: filterProject.value || undefined,
        assigneeId: filterAssignee.value || undefined,
        parentId: 'all', // 拉全部（含子任务），前端组树
        size: 100000, // 一次性拉全量任务，避免默认分页(20条)截断模板项目的任务树
        mine: showMine.value || undefined,
      }),
      projectsApi.list(),
      usersApi.list(),
      departmentsApi.list(),
    ]);
    allTasks.value = tasks.list || [];
    projects.value = projs;
    users.value = usrs;
    depts.value = ds;

    // 部门筛选：任务的 projectId → 项目 deptId 匹配
    if (filterDept.value != null) {
      const deptProjIds = new Set(
        projects.value.filter((p) => String(p.deptId) === String(filterDept.value)).map((p) => String(p.id)),
      );
      allTasks.value = allTasks.value.filter((t) => deptProjIds.has(String(t.projectId)));
    }

    buildTreeRows();
    focusFocusedTask();
    focusFocusedProject();
    seenRefreshVersions.value = refreshStore.snapshot();
    hasLoaded.value = true;
    await openWeeklyProgressFromRoute();
    if (focusedTaskId.value != null && !route.query.weekStart && !detailVisible.value) {
      await openDetail({ id: focusedTaskId.value });
    }
  } finally {
    loading.value = false;
  }
}

// 把全部任务组装成三层：项目 → 主任务 → 子任务
const projectGroups = ref<any[]>([]);
const groupRoots = ref<any[]>([]);
// 收起状态：部门 / 项目 / 任务 三套独立（避免 id 撞车）
const collapsedDepts = ref<Set<number>>(new Set());
const collapsedProjects = ref<Set<number>>(new Set());
const collapsedTasks = ref<Set<number>>(new Set());
const stats = ref({ overdue: 0, atRisk: 0 });
// 收起状态只初始化一次，之后保留用户手动展开/收起（操作后刷新不重置）
const collapseReady = ref(false);
function toggleDept(id: number) {
  const s = new Set(collapsedDepts.value);
  s.has(id) ? s.delete(id) : s.add(id);
  collapsedDepts.value = s;
}
function toggleProject(id: number) {
  const s = new Set(collapsedProjects.value);
  s.has(id) ? s.delete(id) : s.add(id);
  collapsedProjects.value = s;
}
function toggleTask(id: number) {
  const s = new Set(collapsedTasks.value);
  s.has(id) ? s.delete(id) : s.add(id);
  collapsedTasks.value = s;
}
// 按字符串匹配删除收起项（bigint id 落进集合可能是字符串，delete 需 clone 替换才响应式）
function uncollapse(set: { value: Set<number> }, id: unknown) {
  if (id == null) return;
  const s = String(id);
  const next = new Set(set.value);
  let changed = false;
  for (const k of next) if (String(k) === s) { next.delete(k); changed = true; }
  if (changed) set.value = next;
}

function compareTaskOrder(a: any, b: any) {
  const orderDiff = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
  if (orderDiff) return orderDiff;
  const dueDiff = String(a.dueAt || '9999-12-31').localeCompare(String(b.dueAt || '9999-12-31'));
  if (dueDiff) return dueDiff;
  const startDiff = String(a.startAt || '9999-12-31').localeCompare(String(b.startAt || '9999-12-31'));
  if (startDiff) return startDiff;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

function sortTaskTree(nodes: any[]) {
  nodes.sort(compareTaskOrder);
  for (const node of nodes) sortTaskTree(node.children ?? []);
}

const draggingTask = shallowRef<any | null>(null);
function dragTask(task: any | null) {
  draggingTask.value = task;
}

function siblingTasksOf(task: any) {
  return allTasks.value
    .filter((item) =>
      String(item.projectId) === String(task.projectId) &&
      String(item.parentId ?? '') === String(task.parentId ?? '') &&
      item.status !== 'cancelled',
    )
    .sort(compareTaskOrder);
}

async function dropTask(target: any) {
  const source = draggingTask.value;
  draggingTask.value = null;
  if (!source || !target || String(source.id) === String(target.id)) return;
  if (String(source.projectId) !== String(target.projectId) || String(source.parentId ?? '') !== String(target.parentId ?? '')) {
    ElMessage.warning('只能在同一个父级任务下调整顺序');
    return;
  }
  if (isProjectLocked(Number(source.projectId))) {
    ElMessage.warning('项目已定稿，请通过计划变更调整顺序');
    return;
  }
  const siblings = siblingTasksOf(source);
  const from = siblings.findIndex((item) => String(item.id) === String(source.id));
  const to = siblings.findIndex((item) => String(item.id) === String(target.id));
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = siblings.splice(from, 1);
  siblings.splice(to, 0, moved);
  try {
    await tasksApi.reorder({
      projectId: Number(source.projectId),
      parentId: source.parentId == null ? null : Number(source.parentId),
      taskIds: siblings.map((item) => Number(item.id)),
    });
    const sortMap = new Map(siblings.map((item, index) => [String(item.id), index]));
    allTasks.value = allTasks.value.map((item) => sortMap.has(String(item.id)) ? { ...item, sortOrder: sortMap.get(String(item.id)) } : item);
    buildTreeRows();
    refreshStore.markTaskChanged();
  } catch (e: any) {
    if (!isMessageShown(e)) ElMessage.error(e.message || '调整顺序失败');
    await load();
  }
}

// 递归标注风险：父任务风险 = 子任务最大风险；同时累计延期/临期数量
function annotateRisk(node: any): void {
  let risk = 0, overdue = 0, atRisk = 0, maxOverdueDays = 0, nearestDueDays: number | null = null;
  if (node.children?.length) {
    for (const c of node.children) {
      annotateRisk(c);
      risk = Math.max(risk, c._risk);
      overdue += c._overdue;
      atRisk += c._atRisk;
      maxOverdueDays = Math.max(maxOverdueDays, c._maxOverdueDays || 0);
      if (c._nearestDueDays != null) {
        nearestDueDays = nearestDueDays == null ? c._nearestDueDays : Math.min(nearestDueDays, c._nearestDueDays);
      }
    }
  } else {
    risk = leafRisk(node);
    const days = riskDays(node.dueAt);
    if (risk === 2) {
      overdue = 1;
      maxOverdueDays = Math.abs(days || 0);
    } else if (risk === 1) {
      atRisk = 1;
      nearestDueDays = days;
    }
  }
  node._risk = risk;
  node._overdue = overdue;
  node._atRisk = atRisk;
  node._maxOverdueDays = maxOverdueDays;
  node._nearestDueDays = nearestDueDays;
}

// 收集应默认收起（无风险）的任务节点
function collectCollapsedTasks(node: any, set: Set<number>) {
  if (node._risk === 0) set.add(node.id);
  for (const c of node.children ?? []) collectCollapsedTasks(c, set);
}

// 折叠动画：JS 测量实际高度，过渡到精确值（避免 max-height 卡顿）
function onEnter(el: Element) {
  const e = el as HTMLElement;
  e.style.height = '0px';
  e.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    e.style.height = e.scrollHeight + 'px';
    e.addEventListener('transitionend', () => {
      e.style.transition = 'none';
      e.style.height = 'auto';
      void e.offsetHeight;
      e.style.transition = '';
      e.style.overflow = '';
    }, { once: true });
  });
}
function onLeave(el: Element) {
  const e = el as HTMLElement;
  e.style.height = e.scrollHeight + 'px';
  e.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    e.style.height = '0px';
  });
}

function quickTaskMatches(task: any) {
  if (quickFilter.value === 'doing') return ['doing', 'pending_accept'].includes(task.status);
  if (quickFilter.value === 'overdue') return Number(task._overdue || 0) > 0;
  if (quickFilter.value === 'atRisk') return Number(task._atRisk || 0) > 0;
  return true;
}

function pruneTasksByQuickFilter(nodes: any[]): any[] {
  if (!quickFilter.value) return nodes;
  return nodes
    .map((node) => {
      const children = pruneTasksByQuickFilter(node.children ?? []);
      if (quickTaskMatches(node) || children.length) return { ...node, children };
      return null;
    })
    .filter(Boolean);
}

function pruneRootsByQuickFilter(roots: any[]) {
  const pruned = pruneTasksByQuickFilter(roots);
  if (quickFilter.value) {
    for (const root of pruned) annotateRisk(root);
  }
  return pruned;
}

function flattenTaskTree(nodes: any[]): any[] {
  const rows: any[] = [];
  const walk = (items: any[]) => {
    for (const item of items) {
      rows.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(nodes);
  return rows;
}

function buildTreeRows() {
  const byId = new Map<string, any>();
  for (const t of allTasks.value) byId.set(String(t.id), { ...t, children: [] });

  // 组装任务树（主任务 → 子任务）
  const roots: any[] = [];
  for (const t of byId.values()) {
    if (t.parentId && byId.has(t.parentId)) {
      byId.get(t.parentId).children.push(t);
    } else {
      roots.push(t);
    }
  }
  sortTaskTree(roots);

  // 递归标注风险（每个节点带 _risk/_overdue/_atRisk）
  let totalOverdue = 0, totalAtRisk = 0;
  for (const r of roots) {
    annotateRisk(r);
    totalOverdue += r._overdue;
    totalAtRisk += r._atRisk;
  }
  stats.value = { overdue: totalOverdue, atRisk: totalAtRisk };

  const displayRoots = pruneRootsByQuickFilter(roots);
  list.value = flattenTaskTree(displayRoots);
  groupRoots.value = displayRoots;

  // 按部门分组：部门 → 项目 → 主任务
  const deptMap = new Map<number, any>();
  for (const t of displayRoots) {
    const proj = projects.value.find((p) => String(p.id) === String(t.projectId));
    const deptId = proj?.deptId ?? 0;
    if (!deptMap.has(deptId)) deptMap.set(deptId, { deptId, projects: new Map<number, any>() });
    const deptGroup = deptMap.get(deptId);
    const projId = t.projectId ?? 0;
    if (!deptGroup.projects.has(projId)) deptGroup.projects.set(projId, { projectId: projId, deptId, tasks: [] });
    deptGroup.projects.get(projId).tasks.push(t);
  }

  // 没有任务条件时保留空项目入口；筛选掉的任务不能被展示成空项目。
  if (!quickFilter.value && !filterStatus.value && filterAssignee.value == null) {
    for (const p of projects.value) {
      if (filterProject.value != null && String(p.id) !== String(filterProject.value)) continue;
      if (filterDept.value != null && String(p.deptId) !== String(filterDept.value)) continue;
      if (showMine.value && !isOwnerOf(p, auth.user?.id)) continue;
      const deptId = p.deptId ?? 0;
      if (!deptMap.has(deptId)) deptMap.set(deptId, { deptId, projects: new Map<number, any>() });
      const dg = deptMap.get(deptId);
      const pid = p.id;
      if (!dg.projects.has(pid)) dg.projects.set(pid, { projectId: pid, deptId, tasks: [] });
    }
  }

  // 汇总项目 / 部门风险，并按风险排序（延期优先，其次临期，再按名称）
  const deptGroups: any[] = [];
  for (const [deptId, dg] of deptMap) {
    const projectArr = [...dg.projects.values()].map((p) => {
      const risk = Math.max(...p.tasks.map((r: any) => r._risk), 0);
      const overdue = p.tasks.reduce((s: number, r: any) => s + r._overdue, 0);
      const atRisk = p.tasks.reduce((s: number, r: any) => s + r._atRisk, 0);
      return { ...p, risk, overdue, atRisk };
    });
    projectArr.sort(compareProjectGroups);
    const dgRisk = Math.max(...projectArr.map((p) => p.risk), 0);
    const dgOverdue = projectArr.reduce((s, p) => s + p.overdue, 0);
    const dgAtRisk = projectArr.reduce((s, p) => s + p.atRisk, 0);
    deptGroups.push({ deptId, projects: projectArr, risk: dgRisk, overdue: dgOverdue, atRisk: dgAtRisk });
  }
  deptGroups.sort(compareDeptGroups);
  projectGroups.value = deptGroups;

  // 默认收起全部，仅展开含延期/临期的分支（只在首次初始化，之后保留用户手动状态）
  if (!collapseReady.value) {
    const cDepts = new Set<number>();
    const cProjs = new Set<number>();
    const cTasks = new Set<number>();
    for (const dg of deptGroups) {
      // 部门：无风险收起；有延期/临期的部门保持展开（露出项目行）
      if (dg.risk === 0) cDepts.add(dg.deptId);
      for (const p of dg.projects) {
        // 项目一律默认收起，只展开到"部门 → 项目"层，不默认展开到任务层级
        cProjs.add(p.projectId);
        for (const r of p.tasks) collectCollapsedTasks(r, cTasks);
      }
    }
    collapsedDepts.value = cDepts;
    collapsedProjects.value = cProjs;
    collapsedTasks.value = cTasks;
    collapseReady.value = true;
  }
  // 从"我的待办"聚焦过来：强制展开目标项目（含其所在部门）及其父阶段，让操作任务可见
  // 只定位不筛选：同样展开目标项目（含其部门），但不改筛选条件
  if (focusedOnlyProjectId.value != null) {
    const fproj = projects.value.find((p) => String(p.id) === String(focusedOnlyProjectId.value));
    if (fproj?.deptId != null) uncollapse(collapsedDepts, fproj.deptId);
    uncollapse(collapsedProjects, focusedOnlyProjectId.value);
  }
  if (focusedTaskId.value != null) {
    // 目标任务所属项目/部门也要展开：项目分组默认收起，不展开则任务行根本没渲染，定位会落空
    const ftask = byId.get(String(focusedTaskId.value));
    if (ftask?.projectId != null) {
      const fproj = projects.value.find((p) => String(p.id) === String(ftask.projectId));
      if (fproj?.deptId != null) uncollapse(collapsedDepts, fproj.deptId);
      uncollapse(collapsedProjects, ftask.projectId);
    }
    const parents = new Set<unknown>();
    let cur = byId.get(String(focusedTaskId.value));
    while (cur && cur.parentId != null) {
      parents.add(cur.parentId);
      cur = byId.get(String(cur.parentId));
    }
    for (const pid of parents) uncollapse(collapsedTasks, pid);
  }
}

// 新建/编辑任务
const dialogVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
// 正在编辑的是父任务（有子任务）时禁用日期（父任务日期由子任务汇总）
const editingIsParent = ref(false);
const form = ref({
  projectId: null as number | null,
  parentId: null as number | null,
  title: '',
  description: '',
  assigneeIds: [] as number[],
  acceptorIds: [] as number[],
  startAt: '',
  dueAt: '',
});

// 父级选项：null=主任务，其余=子任务；联动所属项目，只显示该项目下的任务
const parentOptions = computed(() => {
  const opts: { value: number | null; label: string }[] = [
    { value: null, label: '主任务（不设父级）' },
  ];
  if (!form.value.projectId) return opts;
  for (const t of allTasks.value) {
    if (String(t.projectId) === String(form.value.projectId)) {
      opts.push({ value: toNumericId(t.id), label: t.title });
    }
  }
  return opts;
});

// 选项目后清空父级（避免跨项目残留）
function onProjectChange() {
  form.value.parentId = null;
  if (!editingId.value) {
    form.value.acceptorIds = defaultAcceptorIdsForProject(form.value.projectId);
  }
}

// 选父级后自动带出父级项目（若父级来自其他项目则更新项目）
function onParentChange(val: number | null) {
  if (val == null) return;
  const t = allTasks.value.find((x) => String(x.id) === String(val));
  if (t?.projectId) {
    form.value.projectId = Number(t.projectId);
    if (!editingId.value) {
      form.value.acceptorIds = defaultAcceptorIdsForProject(Number(t.projectId));
    }
  }
}

function openCreate(parentTask: any = null) {
  const projectId = parentTask ? parentTask.projectId : null;
  if (projectId == null && !creatableProjects.value.length) {
    ElMessage.warning('你当前没有可直接新增任务的未定稿项目；已定稿项目请发起变更审核');
    return;
  }
  if (projectId != null && !canCreateTaskInProject(projectId)) {
    ElMessage.warning('你没有权限在该项目下新增任务');
    return;
  }
  editingId.value = null;
  editingIsParent.value = false;
  form.value = {
    projectId: projectId == null ? null : Number(projectId),
    parentId: parentTask?.id == null ? null : toNumericId(parentTask.id),
    title: '',
    description: '',
    assigneeIds: [],
    acceptorIds: defaultAcceptorIdsForProject(projectId == null ? null : Number(projectId)),
    startAt: '',
    dueAt: '',
  };
  dialogVisible.value = true;
}

// 编辑任务：预填表单
function openEdit(task: any) {
  editingId.value = task.id;
  editingIsParent.value = !!(task.children?.length);
  form.value = {
    projectId: toNullableNumericId(task.projectId),
    parentId: toNullableNumericId(task.parentId),
    title: task.title,
    description: task.description || '',
    assigneeIds: normalizeUserIds(task.assigneeIds, task.assigneeId),
    acceptorIds: normalizeUserIds(task.acceptorIds, task.acceptorId),
    startAt: task.startAt || '',
    dueAt: task.dueAt || '',
  };
  dialogVisible.value = true;
}

async function save() {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入任务标题');
    return;
  }
    if (!form.value.projectId) {
      ElMessage.warning('请选择所属项目');
      return;
    }
    if (!editingId.value && !canCreateTaskInProject(form.value.projectId)) {
      ElMessage.warning('你没有权限在该项目下新增任务');
      return;
    }
    if (form.value.startAt && form.value.dueAt && form.value.dueAt < form.value.startAt) {
      ElMessage.warning('截止日期不能早于开始日期');
      return;
    }
    saving.value = true;
  try {
    if (editingId.value) {
      await tasksApi.update(editingId.value, form.value);
      refreshStore.markTaskChanged();
      ElMessage.success('任务已更新');
    } else {
      await tasksApi.create(form.value);
      refreshStore.markTaskChanged();
      ElMessage.success('任务创建成功');
    }
    dialogVisible.value = false;
    editingId.value = null;
    await load();
  } catch (e: any) {
    // 全局请求拦截器已展示后端错误信息，这里避免重复弹出 “Request failed with status code 400”
  } finally {
    saving.value = false;
  }
}

function hasValidTaskMaterials(assets: any[]) {
  return assets.some((asset) => {
    if (typeof asset.filePath === 'string' && asset.filePath.trim()) return true;
    try { return ['http:', 'https:'].includes(new URL(asset.url || '').protocol); } catch { return false; }
  });
}

async function checkAcceptanceWeekly(task: any, to: string) {
  if (!['pending_accept', 'done'].includes(to)) return true;
  return checkWeeklyProgressBeforeAcceptance(task.id, async weekStart => {
    await openDetail(task, 'updates');
    if (String(detail.value?.id) !== String(task.id) || !canTransitionWithProcessDraft(task)) return;
    resetDailyForm();
    dailyForm.value.workDate = weekStart;
  }, to === 'done');
}

async function acceptanceMaterialReason(task: any): Promise<string | null> {
  const assets = await tasksApi.assets(task.id);
  if (hasValidTaskMaterials(assets)) return '';
  const reason = progressMaterialReason(await tasksApi.dailyUpdates(task.id));
  if (!reason) {
    ElMessage.warning('该任务没有资料，请先在“进展与资料”中补充资料或选择无资料原因，再提交验收。');
    return null;
  }
  try {
    await ElMessageBox.confirm(materialConfirmationMessage(reason), '提交验收', {
      confirmButtonText: '确认提交验收', cancelButtonText: '取消', customClass: 'material-reason-confirm',
    });
    return reason;
  } catch { return null; }
}

async function confirmAcceptanceMaterials(task: any) {
  const [assets, current] = await Promise.all([tasksApi.assets(task.id), tasksApi.one(task.id)]);
  if (hasValidTaskMaterials(assets)) return true;
  if (!current.materialExemptionReason?.trim()) {
    ElMessage.warning('该任务没有资料或资料不适用原因，请退回补充后再验收。');
    return false;
  }
  try {
    await ElMessageBox.confirm('资料不适用原因：' + current.materialExemptionReason + '\n请确认已核实原因合理，同意通过验收。', '确认无资料验收', {
      confirmButtonText: '已核实，通过验收', cancelButtonText: '取消', type: 'warning',
    });
    return true;
  } catch { return false; }
}

function canTransitionWithProcessDraft(task: any) {
  if (String(detail.value?.id) !== String(task.id)) return true;
  const hasPendingMaterials = processSaving.value || pendingAssets.value.length > 0 || selectedExistingAssetIds.value.length > 0
    || !!(assetForm.value.title.trim() || assetForm.value.url.trim() || assetForm.value.description.trim());
  let hasUnsavedText = false;
  if (!supplementOnly.value) {
    if (editingDailyUpdateId.value) {
      const original = dailyUpdates.value.find((update) => String(update.id) === String(editingDailyUpdateId.value));
      hasUnsavedText = !original || ['workDate', 'content', 'risk', 'nextPlan', 'noMaterialReason'].some((key) =>
        String(dailyForm.value[key as keyof typeof dailyForm.value] || '').trim() !== String(original[key] || '').trim(),
      ) || !!dailyForm.value.affectDueDate !== !!original.affectDueDate;
    } else {
      hasUnsavedText = !!(dailyForm.value.content.trim() || dailyForm.value.risk.trim() || dailyForm.value.nextPlan.trim() || dailyForm.value.noMaterialReason.trim() || dailyForm.value.affectDueDate);
    }
  }
  if (!hasPendingMaterials && !hasUnsavedText) return true;
  ElMessage.warning('当前任务有尚未保存完成的进展或资料，请先到“进展与资料”完成保存，再切换任务状态。');
  return false;
}

// 流转操作
async function act(task: any, to: string, comment?: string) {
  if (!canTransitionWithProcessDraft(task)) return;
  const isRestore = task.status === 'rejected' && to === 'todo';
  const isReopen = task.status === 'done' && to === 'doing';
  if (isReopen) {
    try {
      const { value } = await ElMessageBox.prompt('退回后任务恢复进行中，需重新提交验收；原有进展和资料保留。请填写退回原因。', '退回已完成任务', {
        confirmButtonText: '退回', cancelButtonText: '取消',
        inputValidator: (value: string) => value?.trim() ? true : '请填写退回原因',
      });
      comment = value.trim();
    } catch { return; }
  }
  if (isRestore) {
    try {
      await ElMessageBox.confirm('恢复后任务将回到待办，执行人、任务负责人或项目负责人可点击“开始”继续录入。已有进展和资料会保留。确认恢复？', '恢复待办', {
        type: 'warning', confirmButtonText: '恢复待办', cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    comment = '恢复待办，由执行人、任务负责人或项目负责人继续录入';
  }
  // 开始前二次确认，防误触（开始即进入"进行中"，需按进展填报）
  if (task.status === 'todo' && to === 'doing') {
    try {
      await ElMessageBox.confirm('任务将进入「进行中」，开始后需按要求填报关键进展。确认开始？', '开始任务', {
        type: 'info',
        confirmButtonText: '开始',
        cancelButtonText: '再想想',
      });
    } catch {
      return;
    }
  }
  try {
    if (!await checkAcceptanceWeekly(task, to)) return;
    if (to === 'done' && !await confirmAcceptanceMaterials(task)) return;
    const materialExemptionReason = to === 'pending_accept' ? await acceptanceMaterialReason(task) : '';
    if (materialExemptionReason === null) return;
    await tasksApi.transition(task.id, to, comment, materialExemptionReason || undefined);
    refreshStore.markTaskChanged();
    ElMessage.success(isRestore ? '已恢复待办，可开始录入' : '操作成功');
    if ((isRestore || isReopen) && detailVisible.value && String(detail.value?.id) === String(task.id)) {
      await openDetail(task);
    }
    await load();
  } catch (e: any) {
    if (!isMessageShown(e)) ElMessage.error(e.message || '操作失败');
  }
}

// 任务详情弹窗（进展与资料 / 操作日志）
const detailVisible = ref(false);
async function clearClosedTaskLink() {
  await nextTick();
  if (detailVisible.value) return;
  if (route.name !== 'tasks') return;
  const closedTaskId = Number(detail.value?.id ?? route.query.taskId);
  if (route.query.taskId != null) {
    const query = { ...route.query };
    if (query.projectId != null) query.focusProject = query.focusProject ?? query.projectId;
    delete query.projectId;
    delete query.taskId;
    delete query.weekStart;
    // 先同步定位状态，避免参数变化触发重载、折叠列表或再次打开详情。
    focusedTaskId.value = null;
    openedWeeklyProgressKey = '';
    await router.replace({ query, hash: route.hash });
  }
  // 弹窗释放滚动锁、恢复焦点后，再定位刚查看的任务，避免遮罩期间定位被覆盖。
  if (!detailVisible.value && route.name === 'tasks' && Number.isFinite(closedTaskId)) {
    await focusFocusedTask(closedTaskId, 5000);
  }
}
const detail = ref<any>(null);
const detailLoading = ref(false);
// 详情日期：父任务取子任务派生值
const detailRange = computed(() => deriveTaskRange(detail.value));
const detailTab = shallowRef('updates');
const dailyUpdates = ref<any[]>([]);
const taskAssets = ref<any[]>([]);
const processSaving = shallowRef(false);
type PendingAsset = { key: number; title: string; description: string; url?: string; file?: File };
const pendingAssets = ref<PendingAsset[]>([]);
const selectedExistingAssetIds = ref<number[]>([]);
let pendingAssetKey = 0;
const supplementOnly = shallowRef(false);
const materialChoice = shallowRef<'' | 'yes' | 'no'>('');
const materialSource = shallowRef<'file' | 'link' | 'feishu' | 'existing'>('file');
const hasSavedProgressMaterials = computed(() => !!editingDailyUpdateId.value && hasValidTaskMaterials(taskAssets.value.filter(asset => assetLinksProgress(asset, editingDailyUpdateId.value))));
const progressTextLocked = computed(() => supplementOnly.value);
const needsMaterialReason = computed(() => !supplementOnly.value && materialChoice.value === 'no');
const materialFilter = shallowRef('all');
const filteredTaskAssets = computed(() => taskAssets.value.filter((asset) =>
  materialFilter.value === 'all' || assetSourceType(asset) === materialFilter.value,
));
const feishuPickerVisible = shallowRef(false);
const feishuKeyword = ref('');
const feishuSearching = shallowRef(false);
const feishuDocs = ref<any[]>([]);
const feishuPickerMessage = ref('');

const DAILY_STATUS_META: Record<string, { label: string; cls: string }> = {
  normal: { label: '已填报', cls: 'normal' },
  late: { label: '逾期', cls: 'late' },
  supplemented: { label: '补填', cls: 'supplemented' },
  exempted: { label: '合理补填', cls: 'exempted' },
};
const dailyStatus = (s: string) => DAILY_STATUS_META[s] || { label: s || '已填报', cls: 'normal' };

function todayText() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dailyForm = ref({
  workDate: '',
  content: '',
  risk: '',
  nextPlan: '',
  affectDueDate: false,
  noMaterialReason: '',
});
const progressEditor = ref<HTMLElement | null>(null);
const editingDailyUpdateId = shallowRef<number | null>(null);
const assetForm = ref({
  title: '',
  url: '',
  description: '',
});

function resetDailyForm() {
  editingDailyUpdateId.value = null;
  supplementOnly.value = false;
  materialChoice.value = '';
  materialSource.value = 'file';
  pendingAssets.value = [];
  selectedExistingAssetIds.value = [];
  resetAssetForm();
  dailyForm.value = {
    workDate: '',
    content: '',
    risk: '',
    nextPlan: '',
    affectDueDate: false,
    noMaterialReason: '',
  };
}

function resetAssetForm() {
  assetForm.value = {
    title: '',
    url: '',
    description: '',
  };
}

function detailPeopleNames(ids: any, legacyId: any) {
  return normalizeUserIds(ids, legacyId).map((id) => userName(Number(id))).filter((name) => name && name !== '—').join('、') || '—';
}

function briefText(value: string | null | undefined, size = 24) {
  const text = String(value ?? '').trim();
  return text.length > size ? `${text.slice(0, size)}...` : text;
}

const detailChildren = computed(() => (detail.value?.children ?? []).filter((child: any) => child.status !== 'cancelled'));
const isDetailParent = computed(() => !!detailChildren.value.length);
const detailActiveTab = computed({
  get: () => isDetailParent.value ? 'logs' : detailTab.value,
  set: (value: string) => { detailTab.value = value; },
});
const isDetailProjectLocked = computed(() => !!detail.value?.projectId && isProjectLocked(detail.value.projectId));
const isDetailFrozen = computed(() => isProjectFrozen(detail.value?.projectId) || detail.value?.projectStatus === 'archived' || ['pending', 'closed'].includes(detail.value?.projectClosureState));
const detailProject = computed(() => projects.value.find((project) => String(project.id) === String(detail.value?.projectId)) || null);
const detailAssigneeIds = computed(() => normalizeUserIds(detail.value?.assigneeIds, detail.value?.assigneeId).map((id) => Number(id)));
const detailAcceptorIds = computed(() => normalizeUserIds(detail.value?.acceptorIds, detail.value?.acceptorId).map((id) => Number(id)));
const canManageDetailDept = computed(() => {
  const deptId = detailProject.value?.deptId;
  return (
    auth.has('admin') ||
    auth.has('leader') ||
    (auth.has('dept_head') &&
      deptId != null &&
      (String(deptId) === String(auth.user?.deptId) || auth.managedDeptIds.includes(Number(deptId))))
  );
});
// 项目可管理（含项目负责人 owner）：admin/领导/部门负责人可管理该项目/我是负责人 —— 与后端 canManageProject 对齐
const canManageDetailProject = computed(() => !isDetailFrozen.value && (
  canManageDetailDept.value ||
  isOwnerOf(detailProject.value, auth.user?.id)),
);
const canConfirmDetail = computed(() => !isDetailFrozen.value && !!detail.value && !isDetailParent.value && (detail.value.canConfirm ?? canManageDetailDept.value));
const canWorkDetail = computed(() => {
  if (isDetailFrozen.value) return false;
  if (!detail.value || isDetailParent.value) return false;
  const uid = Number(auth.user?.id);
  return (
    auth.has('admin') ||
    auth.has('leader') ||
    String(detail.value.creatorId) === String(auth.user?.id) ||
    isDetailProjectOwner.value ||
    detailAssigneeIds.value.includes(uid) ||
    detailAcceptorIds.value.includes(uid)
  );
});
const canReviewDetail = computed(() => {
  if (isDetailFrozen.value) return false;
  if (!detail.value || isDetailParent.value) return false;
  const uid = Number(auth.user?.id);
  return auth.has('admin') || auth.has('leader') || detailAcceptorIds.value.includes(uid);
});
const canMaintainDetailProcess = computed(() => !isDetailFrozen.value && (canManageDetailDept.value || canWorkDetail.value || canReviewDetail.value));
const canRestoreDetail = computed(() => !isDetailFrozen.value && (canReviewDetail.value || isDetailProjectOwner.value || detailAssigneeIds.value.includes(Number(auth.user?.id))));
// 确认合理补填：与后端 assertCanWriteTaskProcess 对齐（部门可管理/任务执行人/任务验收人），而非仅限 admin/leader/dept_head
const canEditDetailProcess = computed(() =>
  !!detail.value &&
  !isDetailParent.value &&
  isDetailProjectLocked.value &&
  canMaintainDetailProcess.value &&
  ['doing', 'done'].includes(detail.value.status),
);
const processLockTip = computed(() => {
  if (isDetailFrozen.value) return '项目结项审批中或已结项，任务与资料已锁定，仅可查看。';
  if (isDetailParent.value) return '父任务由子任务自动汇总，不需要直接填写关键进展或资料。';
  if (!detail.value) return '';
  if (!isDetailProjectLocked.value) return '项目计划未定稿，任务暂不能执行；请先定稿项目计划。';
  if (detail.value.status === 'pending_accept') return '任务正在等待验收，暂不能修改进展与资料。如需补齐周进展，请由验收负责人先退回任务。';
  if (!['doing', 'done'].includes(detail.value.status)) return '请先点击“开始”任务，任务进入进行中后才能填写关键进展和上传资料；已通过验收的任务也可以继续补充。';
  return '';
});
const sortedDailyUpdates = computed(() =>
  [...dailyUpdates.value].sort((a, b) =>
    String(b.workDate || '').localeCompare(String(a.workDate || '')) ||
    (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0) ||
    Number(b.id) - Number(a.id),
  ),
);
const dailyTimeline = computed(() => sortedDailyUpdates.value.map(update => ({
  ...update,
  assets: taskAssets.value.filter(asset => assetLinksProgress(asset, update.id)),
})));
const unlinkedTaskAssets = computed(() => taskAssets.value.filter((asset) => !assetProgressIds(asset).length));

function canModifyDailyUpdate(update: any) {
  if (isDetailFrozen.value) return false;
  if (!detail.value || isDetailParent.value || !isDetailProjectLocked.value) return false;
  if (detail.value.status !== 'doing') return false;
  if (update.status === 'exempted') return false;
  return isAdminLeader.value || canManageDetailDept.value || String(update.userId) === String(auth.user?.id);
}

function canDeleteDailyUpdate(update: any) {
  if (isDetailFrozen.value) return false;
  if (!detail.value || isDetailParent.value || !isDetailProjectLocked.value || detail.value.projectStatus === 'archived') return false;
  if (update.status === 'exempted') return false;
  return canModifyDailyUpdate(update) || (detail.value.status === 'done' && auth.has('admin'));
}

function isMessageShown(e: any) {
  return !!e?.messageShown;
}

async function openDetail(task: any, tab = 'updates') {
  if (processSaving.value) return;
  if (detail.value && String(detail.value.id) !== String(task.id) && !await discardProcessDraft()) return;
  // Reopening an empty new-entry form must not reuse a previous reminder's default date.
  if (!detailVisible.value && !editingDailyUpdateId.value && !pendingAssets.value.length && !selectedExistingAssetIds.value.length
    && !dailyForm.value.content.trim() && !dailyForm.value.noMaterialReason.trim()
    && !dailyForm.value.risk.trim() && !dailyForm.value.nextPlan.trim() && !dailyForm.value.affectDueDate
    && !assetForm.value.url.trim() && !assetForm.value.title.trim() && !assetForm.value.description.trim()) {
    dailyForm.value.workDate = '';
  }
  detailVisible.value = true;
  detailLoading.value = true;
  detailTab.value = ['assets','summary'].includes(tab) ? 'updates' : tab;
  dailyUpdates.value = [];
  taskAssets.value = [];
  if (String(detail.value?.id) !== String(task.id)) {
    resetDailyForm();
    materialFilter.value = 'all';
  }
  try {
    const [taskDetail, updates, assets] = await Promise.all([
      tasksApi.one(task.id),
      tasksApi.dailyUpdates(task.id),
      tasksApi.assets(task.id),
    ]);
    detail.value = taskDetail;
    dailyUpdates.value = updates;
    taskAssets.value = assets;
  } finally {
    detailLoading.value = false;
  }
}

let openedWeeklyProgressKey = '';
async function openWeeklyProgressFromRoute() {
  const weekStart = route.query.weekStart;
  const taskId = route.query.taskId;
  if (typeof weekStart !== 'string' || typeof taskId !== 'string') {
    openedWeeklyProgressKey = '';
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || weekStart > todayText()) return;
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== weekStart) return;
  const key = `${taskId}:${weekStart}`;
  if (openedWeeklyProgressKey === key) return;
  const task = allTasks.value.find((item) => String(item.id) === taskId);
  if (!task) return;
  await openDetail(task, 'updates');
  if (String(detail.value?.id) !== taskId || processSaving.value) return;
  if (route.query.taskId !== taskId || route.query.weekStart !== weekStart) return;
  if (!dailyForm.value.content.trim() && !editingDailyUpdateId.value) dailyForm.value.workDate = weekStart;
  openedWeeklyProgressKey = key;
  // The reminder is a one-time action. Keep project/task focus, but do not reopen on browser refresh.
  const query = { ...route.query };
  delete query.weekStart;
  // 已发送的提醒使用 projectId；消费后保留定位，避免刷新时重新套用项目筛选。
  if (query.projectId != null) {
    query.focusProject = query.projectId;
    delete query.projectId;
  }
  await router.replace({ query, hash: route.hash });
}

async function reloadTaskProcess() {
  if (!detail.value?.id) return;
  const id = detail.value.id;
  const [taskDetail, updates, assets] = await Promise.all([
    tasksApi.one(id),
    tasksApi.dailyUpdates(id),
    tasksApi.assets(id),
  ]);
  if (String(detail.value?.id) !== String(id)) return;
  detail.value = taskDetail;
  dailyUpdates.value = updates;
  taskAssets.value = assets;
}

function hasProgressMaterials() {
  const existing = editingDailyUpdateId.value
    ? taskAssets.value.filter(asset => assetLinksProgress(asset, editingDailyUpdateId.value)) : [];
  const selected = taskAssets.value.filter(asset => selectedExistingAssetIds.value.includes(Number(asset.id)));
  const links = assetForm.value.url.split(/\r?\n/).map(url => ({ url: url.trim() }));
  return pendingAssets.value.some(asset => !!asset.file)
    || hasValidTaskMaterials([...existing, ...selected, ...pendingAssets.value, ...links]);
}

async function submitDailyUpdate() {
  if (!detail.value?.id || processSaving.value) return;
  if (!canEditDetailProcess.value) {
    ElMessage.warning(processLockTip.value || '当前任务不能填写关键进展');
    return;
  }
  if (!dailyForm.value.workDate || !dailyForm.value.content.trim()) {
    ElMessage.warning(!dailyForm.value.workDate ? '请选择工作日期' : '请填写关键进展内容后再保存');
    return;
  }
  if (!materialChoice.value) { ElMessage.warning('请先选择本次是否有资料'); return; }
  const withMaterials = supplementOnly.value || materialChoice.value === 'yes';
  if (withMaterials && (assetForm.value.url.trim() || assetForm.value.title.trim() || assetForm.value.description.trim()) && !queueLinkAsset()) return;
  if (supplementOnly.value && !pendingAssets.value.length && !selectedExistingAssetIds.value.length) {
    ElMessage.warning('请添加要补充的文件或链接');
    return;
  }
  const noMaterialReason = dailyForm.value.noMaterialReason.trim();
  if (withMaterials && !hasProgressMaterials()) { ElMessage.warning('已选择有资料，请上传文件、粘贴链接或关联已有资料'); return; }
  if (!withMaterials && editingDailyUpdateId.value && hasValidTaskMaterials(taskAssets.value.filter(asset => assetLinksProgress(asset, editingDailyUpdateId.value)))) { ElMessage.warning('本条进展已有资料，请先解除关联后再选择暂无资料'); return; }
  if (!withMaterials && (!noMaterialReason || noMaterialReason.length > 500)) {
    ElMessage.warning(!noMaterialReason ? '请添加本次进展的资料，或填写无资料原因' : '无资料原因不能超过 500 字');
    return;
  }
  const assetsToSave = withMaterials ? pendingAssets.value : [];
  if (assetsToSave.filter(asset => asset.file).length > 30) {
    ElMessage.warning('每次最多上传 30 个文件，请分次补充');
    return;
  }
  if (assetsToSave.reduce((total, asset) => total + (asset.file?.size || 0), 0) > 200 * 1024 * 1024) {
    ElMessage.warning('每次上传的文件合计不能超过 200MB，请分次补充');
    return;
  }
  processSaving.value = true;
  try {
    const taskId = detail.value.id;
    const data = new FormData();
    data.append('payload', JSON.stringify({
      ...dailyForm.value,
      updateId: editingDailyUpdateId.value || undefined,
      materialsOnly: supplementOnly.value,
      existingAssetIds: withMaterials ? selectedExistingAssetIds.value : [],
      noMaterialReason: withMaterials ? '' : noMaterialReason,
      links: assetsToSave.filter(asset => !asset.file).map(asset => ({ title: asset.title, url: asset.url })),
    }));
    for (const asset of assetsToSave) {
      if (asset.file) data.append('files', asset.file, asset.file.name);
    }
    await tasksApi.saveProgress(taskId, data);
    refreshStore.markTaskChanged();
    resetDailyForm();
    ElMessage.success('进展与资料已保存');
    await reloadTaskProcess();
  } catch (e: any) {
    if (!isMessageShown(e)) ElMessage.warning(e.message || '保存未完成，填写内容和资料已保留，请重试。');
  } finally {
    processSaving.value = false;
  }
}

async function discardProcessDraft() {
  if (processSaving.value) return false;
  if (pendingAssets.value.length || selectedExistingAssetIds.value.length || dailyForm.value.content.trim() || dailyForm.value.noMaterialReason.trim() || assetForm.value.url.trim() || assetForm.value.title.trim() || assetForm.value.description.trim()) {
    try {
      await ElMessageBox.confirm('切换后会清空当前未保存的内容和待保存资料，已保存的记录会保留。', '切换进展记录', {
        confirmButtonText: '切换', cancelButtonText: '继续填写', type: 'warning',
      });
    } catch { return false; }
  }
  resetDailyForm();
  return true;
}

async function revealProgressEditor() {
  await nextTick();
  const editor = progressEditor.value;
  if (!editor) return;
  editor.scrollTop = 0;
  // 窄屏采用上下布局；桌面保持右侧当前阅读位置。
  if (window.getComputedStyle(editor).position !== 'sticky') {
    editor.scrollIntoView({ block: 'start' });
  }
}

async function editDailyUpdate(update: any, materialsOnly = false) {
  if (materialsOnly ? !canEditDetailProcess.value : !canModifyDailyUpdate(update)) return;
  if (!await discardProcessDraft()) return;
  editingDailyUpdateId.value = toNumericId(update.id);
  supplementOnly.value = materialsOnly;
  materialChoice.value = materialsOnly || hasProgressMaterials() ? 'yes' : update.noMaterialReason ? 'no' : '';
  materialSource.value = 'file';
  dailyForm.value = {
    workDate: update.workDate || '',
    content: update.content || '',
    risk: update.risk || '',
    nextPlan: update.nextPlan || '',
    affectDueDate: !!update.affectDueDate,
    noMaterialReason: update.noMaterialReason || '',
  };
  await revealProgressEditor();
}

async function deleteDailyUpdate(update: any) {
  if (!detail.value?.id || !canDeleteDailyUpdate(update)) return;
  try {
    await ElMessageBox.confirm('删除后，这条关键进展记录会移除；已关联的资料不会删除，会变成未关联资料。确认删除吗？', '删除关键进展', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await tasksApi.deleteDailyUpdate(detail.value.id, update.id);
    refreshStore.markTaskChanged();
    if (String(editingDailyUpdateId.value) === String(update.id)) resetDailyForm();
    ElMessage.success('关键进展已删除');
    await reloadTaskProcess();
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '删除失败');
  }
}

// 撤销"确认合理补填"：恢复为普通补填状态（任务会重新显示「延期完成 ⚠️」）
async function unexemptUpdate(update: any) {
  if (!detail.value?.id) return;
  try {
    await ElMessageBox.confirm(
      '撤销后，这条进展会恢复为普通补填状态，任务将重新显示「延期完成 ⚠️」。确定撤销吗？',
      '撤销合理补填',
      { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' },
    );
    await tasksApi.unexemptDailyUpdate(detail.value.id, update.id);
    refreshStore.markTaskChanged();
    ElMessage.success('已撤销合理补填');
    await reloadTaskProcess();
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '操作失败');
  }
}

// 常用"合理补填原因"：可点选、可自由输入，也允许留空
const EXEMPT_REASON_OPTIONS = [
  '历史项目补录',
  '系统上线前资料补登',
  '外出/出差无法当天填报',
  '现场作业不便当天填报',
  '由他人代报，事后补登',
  '系统或网络故障未及时填报',
  '历史遗留任务集中补录',
  '人员变动/交接期间遗漏后补',
];

const exemptDialogVisible = ref(false);
const exemptSaving = ref(false);
const exemptTarget = ref<any>(null);
const exemptReason = ref('');

function exemptDisabledReason(update: any): string {
  return typeof update?.exemptDisabledReason === 'string'
    ? update.exemptDisabledReason
    : '暂无法判断补填条件，请刷新后重试';
}

function exemptUpdate(update: any) {
  if (isDetailFrozen.value) { ElMessage.warning('项目已锁定'); return; }
  if (exemptDisabledReason(update)) return;
  exemptTarget.value = update;
  exemptReason.value = '';
  exemptDialogVisible.value = true;
}

async function submitExempt() {
  if (!detail.value?.id || !exemptTarget.value) return;
  if (exemptDisabledReason(exemptTarget.value)) return;
  exemptSaving.value = true;
  try {
    await tasksApi.exemptDailyUpdate(detail.value.id, exemptTarget.value.id, exemptReason.value.trim());
    refreshStore.markTaskChanged();
    ElMessage.success('已确认合理补填');
    exemptDialogVisible.value = false;
    await reloadTaskProcess();
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  } finally {
    exemptSaving.value = false;
  }
}

function queueLinkAsset() {
  if (!canEditDetailProcess.value || processSaving.value) return false;
  const urls = assetForm.value.url.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!urls.length) {
    ElMessage.warning('请粘贴资料链接');
    return false;
  }
  try {
    for (const url of urls) {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
    }
  } catch {
    ElMessage.warning('请检查资料链接，每行填写一个完整的 http 或 https 链接');
    return false;
  }
  for (const url of new Set(urls)) {
    if (pendingAssets.value.some(asset => asset.url === url)) continue;
    const title = urls.length === 1 && assetForm.value.title.trim()
      ? assetForm.value.title.trim() : new URL(url).hostname;
    pendingAssets.value.push({ key: ++pendingAssetKey, title, url, description: '' });
  }
  resetAssetForm();
  return true;
}

function queueLocalAsset(upload: any) {
  if (!canEditDetailProcess.value || processSaving.value || !upload.raw) return;
  const file = upload.raw as File;
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('「' + file.name + '」超过 50MB，请选择较小的文件');
    return;
  }
  pendingAssets.value.push({ key: ++pendingAssetKey, title: file.name, file, description: '' });
}

async function downloadAsset(asset: any) {
  if (!detail.value?.id) return;
  try {
    const blob = await tasksApi.downloadAsset(detail.value.id, asset.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = assetFileName(asset);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e: any) {
    ElMessage.error(e.message || '下载失败');
  }
}

async function previewAsset(asset: any) {
  if (!detail.value?.id) return;
  const previewWindow = window.open('', '_blank');
  try {
    const blob = await tasksApi.previewAsset(detail.value.id, asset.id);
    const url = URL.createObjectURL(normalizePreviewBlob(asset, blob));
    if (previewWindow) previewWindow.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) {
    previewWindow?.close();
    ElMessage.error(e.message || '预览失败');
  }
}

async function unlinkProgressAsset(update: any, asset: any) {
  if (!detail.value?.id || processSaving.value || !canEditDetailProcess.value) return;
  const taskId = detail.value.id;
  let ownsSaving = false;
  try {
    await ElMessageBox.confirm('仅解除本条进展的关联，原资料和其他进展的关联会保留。', '解除资料关联', {
      confirmButtonText: '解除关联', cancelButtonText: '取消', type: 'warning',
    });
    if (detail.value?.id !== taskId || processSaving.value) return;
    processSaving.value = true;
    ownsSaving = true;
    await tasksApi.unlinkAsset(taskId, Number(update.id), Number(asset.id));
    refreshStore.markTaskChanged();
    await reloadTaskProcess();
    ElMessage.success('已解除关联，原资料已保留');
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close' && !isMessageShown(e)) ElMessage.warning(e.message || '解除关联失败');
  } finally { if (ownsSaving) processSaving.value = false; }
}

async function removeAsset(asset: any) {
  if (!detail.value?.id) return;
  try {
    await ElMessageBox.confirm(`确定删除资料「${asset.title}」？`, '删除资料', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await tasksApi.removeAsset(detail.value.id, asset.id);
    refreshStore.markTaskChanged();
    ElMessage.success('资料已删除');
    await reloadTaskProcess();
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '删除失败');
  }
}

function openAsset(asset: any) {
  if (!asset.url) {
    if (isAssetPreviewable(asset)) previewAsset(asset);
    else downloadAsset(asset);
    return;
  }
  window.open(asset.url, '_blank', 'noopener,noreferrer');
}

function openFeishuPicker() {
  feishuPickerVisible.value = true;
  feishuKeyword.value = assetForm.value.title || '';
  feishuDocs.value = [];
  feishuPickerMessage.value = '可搜索飞书云文档；若应用权限未开通，可直接粘贴链接登记。';
}

async function searchFeishuDocs() {
  const keyword = feishuKeyword.value.trim();
  if (!keyword) {
    ElMessage.warning('请输入文件关键词');
    return;
  }
  feishuSearching.value = true;
  try {
    const res = await feishuApi.searchDocs(keyword);
    feishuDocs.value = res.items || [];
    feishuPickerMessage.value = res.message || (feishuDocs.value.length ? '' : '未搜索到文件，可手动粘贴链接。');
  } catch (e: any) {
    feishuPickerMessage.value = e.message || '飞书搜索失败，可手动粘贴链接。';
  } finally {
    feishuSearching.value = false;
  }
}

function chooseFeishuDoc(doc: any) {
  if (!canEditDetailProcess.value || processSaving.value) return;
  try {
    const url = new URL(doc.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    if (!pendingAssets.value.some(asset => asset.url === doc.url)) {
      pendingAssets.value.push({ key: ++pendingAssetKey, title: doc.title || url.hostname, url: doc.url, description: '' });
    }
  } catch {
    ElMessage.warning('文件链接无效，请重新选择');
    return;
  }
  feishuPickerVisible.value = false;
}

// 详情里的状态流转
async function actDetail(to: string) {
  if (!detail.value || !canTransitionWithProcessDraft(detail.value)) return;
  if ((detail.value?.status === 'rejected' && to === 'todo') || (detail.value?.status === 'done' && to === 'doing')) {
    await act(detail.value, to);
    return;
  }
  // 开始前二次确认，防误触
  if (detail.value?.status === 'todo' && to === 'doing') {
    try {
      await ElMessageBox.confirm('任务将进入「进行中」，开始后需按要求填报关键进展。确认开始？', '开始任务', {
        type: 'info',
        confirmButtonText: '开始',
        cancelButtonText: '再想想',
      });
    } catch {
      return;
    }
  }
  try {
    if (!await checkAcceptanceWeekly(detail.value, to)) return;
    if (to === 'done' && !await confirmAcceptanceMaterials(detail.value)) return;
    const materialExemptionReason = to === 'pending_accept' ? await acceptanceMaterialReason(detail.value) : '';
    if (materialExemptionReason === null) return;
    await tasksApi.transition(detail.value.id, to, undefined, materialExemptionReason || undefined);
    refreshStore.markTaskChanged();
    ElMessage.success('操作成功');
    openDetail(detail.value);
    await load();
  } catch (e: any) {
    if (!isMessageShown(e)) ElMessage.error(e.message || '操作失败');
  }
}
// 撤销开始（doing→todo）：仅尚未填报关键进展时可撤（误点开始的逃生口）。
// 可撤人员：任务执行人/创建者/admin/leader，外加项目负责人（对项目计划负责，可协助纠正误开始）
const isDetailProjectOwner = computed(
  () => !!auth.user && isOwnerOf(detailProject.value, auth.user.id),
);
const canUndoStartDetail = computed(
  () =>
    !!detail.value &&
    detail.value.status === 'doing' &&
    dailyUpdates.value.length === 0 &&
    (canWorkDetail.value || isDetailProjectOwner.value),
);
async function revertStart() {
  try {
    await ElMessageBox.confirm(
      '撤销开始后任务将回到「待办（未开始）」。仅当任务尚未填报过关键进展时可撤销，操作会记入日志。确认撤销？',
      '撤销开始',
      { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await tasksApi.transition(detail.value.id, 'todo');
    refreshStore.markTaskChanged();
    ElMessage.success('已撤销开始，任务回到待办');
    openDetail(detail.value);
    await load();
  } catch (e: any) {
    if (!isMessageShown(e)) ElMessage.error(e.message || '操作失败');
  }
}
async function confirm(task: any) {
  await tasksApi.confirm(task.id);
  refreshStore.markTaskChanged();
  ElMessage.success('已确认');
  await load();
}
async function reject(task: any) {
  await tasksApi.reject(task.id, '不符合要求');
  refreshStore.markTaskChanged();
  ElMessage.success('已退回');
  await load();
}
async function removeTask(task: any) {
  await ElMessageBox.confirm(`确定删除任务「${task.title}」？其下子任务、日志将一并删除。`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });
  await tasksApi.remove(task.id);
  refreshStore.markTaskChanged();
  ElMessage.success('任务已删除');
  await load();
}

// ---------- 发起变更审核 ----------
const changeDialogVisible = ref(false);
const changeSaving = ref(false);
const changeLoading = ref(false);
const changeForm = ref({ projectId: null as number | null, reason: '', rows: [] as any[] });
const recentlyMovedChangeKeys = shallowRef<Set<string>>(new Set());
let nextChangeClientId = 1;
let moveFlashTimer: number | undefined;
let moveFlashFrame: number | undefined;

function createChangeClientId() {
  return `new-${nextChangeClientId++}`;
}

function normalizeUserIds(ids: unknown, legacyId: unknown): number[] {
  return normalizeNumericIds(ids, legacyId);
}

function changeTreeStyle(depth: number) {
  return { '--tree-depth': String(depth) } as Record<string, string>;
}

function changeRowStableKey(row: any) {
  if (row?.isNew && row.clientId) return String(row.clientId);
  if (row?.taskId != null) return `task-${row.taskId}`;
  return '';
}

function changeRowKey(row: any, index: number) {
  return changeRowStableKey(row) || `row-${index}`;
}

function isRecentlyMovedChangeRow(row: any) {
  const key = changeRowStableKey(row);
  return !!key && recentlyMovedChangeKeys.value.has(key);
}

function markMovedChangeRows(rows: any[]) {
  const keys = new Set(rows.map(changeRowStableKey).filter(Boolean));
  if (!keys.size) return;

  if (moveFlashTimer) window.clearTimeout(moveFlashTimer);
  if (moveFlashFrame) window.cancelAnimationFrame(moveFlashFrame);

  recentlyMovedChangeKeys.value = new Set();
  moveFlashFrame = window.requestAnimationFrame(() => {
    recentlyMovedChangeKeys.value = keys;
    moveFlashFrame = undefined;
    moveFlashTimer = window.setTimeout(() => {
      recentlyMovedChangeKeys.value = new Set();
      moveFlashTimer = undefined;
    }, 1450);
  });
}

function buildChangeRows(tasks: any[]) {
  const byId = new Map<number, any>();
  for (const task of tasks) {
    byId.set(task.id, { ...task, children: [] });
  }

  const roots: any[] = [];
  for (const task of byId.values()) {
    if (task.parentId && byId.has(task.parentId)) {
      byId.get(task.parentId).children.push(task);
    } else {
      roots.push(task);
    }
  }

  const rows: any[] = [];
    const walk = (nodes: any[], depth: number) => {
      nodes.sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
      for (const [siblingIndex, n] of nodes.entries()) {
        const assigneeIds = normalizeUserIds(n.assigneeIds, n.assigneeId);
        const acceptorIds = normalizeUserIds(n.acceptorIds, n.acceptorId);
        const sortOrder = siblingIndex;
        rows.push({
          taskId: n.id, parentId: n.parentId ?? null, parentClientId: null, title: n.title, depth,
          startAt: n.startAt || '', dueAt: n.dueAt || '',
          origStartAt: n.startAt || '', origDueAt: n.dueAt || '',
          sortOrder, origSortOrder: sortOrder,
          assigneeIds, acceptorIds,
          origAssigneeIds: [...assigneeIds], origAcceptorIds: [...acceptorIds],
          deleted: false, isNew: false, isParent: !!(n.children?.length),
        });
      walk(n.children || [], depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

function openPlanChange(projectId: number) {
  changeForm.value = { projectId, reason: '', rows: [] };
  changeDialogVisible.value = true;

  const useLocalData = !quickFilter.value && !filterStatus.value && filterAssignee.value == null && filterDept.value == null;
  const localTasks = allTasks.value.filter((task) => String(task.projectId) === String(projectId));
  if (useLocalData && localTasks.length) {
    changeForm.value.rows = buildChangeRows(localTasks);
    return;
  }

  // Filters can hide part of a project. Hydrate the full task tree after the dialog is visible.
  changeLoading.value = true;
  tasksApi.list({ projectId, parentId: 'all', size: 100000 })
    .then((data: any) => {
      if (changeForm.value.projectId === projectId) {
        changeForm.value.rows = buildChangeRows(data.list || []);
      }
    })
    .catch((e: any) => ElMessage.error(e.message || '加载项目任务失败'))
    .finally(() => {
      changeLoading.value = false;
    });
}

// 把一条被退回申请的变更项回放到任务树行上，作为"复制重发"的预填
// 思路：行(orig*)始终代表当前任务状态；把旧单的 after 值写进行字段，
// 提交时 diff 会重新生成与旧单一致的变更（新增任务则以 isNew 行重建）。
function replayRejectedItems(rows: any[], items: any[]) {
  const list = items || [];
  const addItems = list.filter((it: any) => it.changeType === 'add');
  const others = list.filter((it: any) => it.changeType !== 'add');
  const rowByTask = new Map<string, any>();
  for (const r of rows) if (r.taskId != null) rowByTask.set(String(r.taskId), r);

  for (const it of others) {
    if (it.taskId == null) continue;
    const row = rowByTask.get(String(it.taskId));
    if (!row) continue; // 该任务当前已不存在（如已被取消）：跳过
    const a = it.after ?? {};
    if (it.changeType === 'delete') { row.deleted = true; continue; }
    if (it.changeType === 'date') {
      row.startAt = a.startAt || ''; row.dueAt = a.dueAt || '';
      row.shiftPromptHandledFor = dateChangeSignature(row); // 跳过级联顺延提示
      continue;
    }
    if (it.changeType === 'assignee') { row.assigneeIds = Array.isArray(a.assigneeIds) ? [...a.assigneeIds] : []; continue; }
    if (it.changeType === 'acceptor') { row.acceptorIds = Array.isArray(a.acceptorIds) ? [...a.acceptorIds] : []; continue; }
    // changeType === 'reorder'：树形编辑器无法无损回放顺序，跳过并提示用户手动调整
  }

  // 新增任务：按旧 clientId 关系重建 isNew 行（父级可能是本次同批新增，用 parentClientId 挂钩）
  const clientMap = new Map<string, string>(); // 旧 clientId -> 新 clientId
  for (const it of addItems) {
    const after = it.after ?? {};
    const title = String(after.title ?? '').trim();
    if (!title) continue;
    const oldCid = after.clientId != null ? String(after.clientId) : null;
    const parentOldCid = after.parentClientId != null ? String(after.parentClientId) : null;
    // 父级新增任务若因标题为空被跳过，子任务也无处可挂，一并跳过（避免生成顶层孤儿）
    if (parentOldCid && !clientMap.has(parentOldCid)) continue;

    let parentId: number | null = it.taskId != null ? Number(it.taskId) : null;
    let parentClientId: string | null = null;
    if (parentOldCid && clientMap.has(parentOldCid)) {
      parentId = null; // 父级也是本次新增
      parentClientId = clientMap.get(parentOldCid)!;
    }
    const parentRow = parentId != null ? (rowByTask.get(String(parentId)) ?? null) : null;

    let depth = 0;
    let insertIdx = rows.length;
    if (parentClientId) {
      const pidx = rows.findIndex((r: any) => r.clientId === parentClientId);
      if (pidx >= 0) { depth = (rows[pidx].depth ?? 0) + 1; insertIdx = childInsertIndex(pidx, rows[pidx].depth ?? 0); }
    } else if (parentRow) {
      const pidx = rows.indexOf(parentRow);
      if (pidx >= 0) { depth = parentRow.depth + 1; insertIdx = childInsertIndex(pidx, parentRow.depth); }
    }
    const newCid = createChangeClientId();
    rows.splice(Math.min(insertIdx, rows.length), 0, {
      taskId: null, parentId, parentClientId, clientId: newCid, title, depth,
      startAt: after.startAt || '', dueAt: after.dueAt || '', origStartAt: '', origDueAt: '',
      sortOrder: 0, origSortOrder: null,
      assigneeIds: Array.isArray(after.assigneeIds) ? [...after.assigneeIds] : [],
      acceptorIds: Array.isArray(after.acceptorIds) ? [...after.acceptorIds] : [],
      origAssigneeIds: [], origAcceptorIds: [],
      deleted: false, isNew: true,
    });
    if (oldCid) clientMap.set(oldCid, newCid);
  }
}

// 复制一条被退回的申请为可编辑内容，走既有"新建申请"流程重新提交（原单保持不变）
async function openCopyPlanChange(changeId: number) {
  changeLoading.value = true;
  try {
    const ch = await planChangesApi.one(changeId);
    if (!ch || ch.status !== 'rejected') {
      ElMessage.warning('仅被退回的申请可复制重发');
      return;
    }
    changeForm.value = { projectId: Number(ch.projectId), reason: ch.reason || '', rows: [] };
    changeDialogVisible.value = true;
    const data = await tasksApi.list({ projectId: Number(ch.projectId), parentId: 'all', size: 100000 });
    if (changeForm.value.projectId !== Number(ch.projectId)) return;
    const rows = buildChangeRows(data.list || []);
    replayRejectedItems(rows, ch.items || []);
    changeForm.value.rows = rows;
    if ((ch.items || []).some((it: any) => it.changeType === 'reorder')) {
      ElMessage.warning('已复制内容；原申请中的顺序调整无法自动复制，如需改顺序请在此手动拖动');
    }
    // 打开成功即清掉 URL 参数，避免刷新页面时再次自动弹窗
    if (route.query.copyChange != null) {
      const q = { ...route.query };
      delete q.copyChange;
      router.replace({ query: q });
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载被退回申请失败');
    changeDialogVisible.value = false;
  } finally {
    changeLoading.value = false;
  }
}
function addChangeRow() {
  changeForm.value.rows.push({
    taskId: null, parentId: null, parentClientId: null, clientId: createChangeClientId(), title: '', depth: 0,
    startAt: '', dueAt: '', origStartAt: '', origDueAt: '',
    sortOrder: 0, origSortOrder: null,
    assigneeIds: [], acceptorIds: [], origAssigneeIds: [], origAcceptorIds: [],
    deleted: false, isNew: true,
  });
}

function childInsertIndex(parentIndex: number, parentDepth: number) {
  let index = parentIndex + 1;
  while (index < changeForm.value.rows.length && changeForm.value.rows[index].depth > parentDepth) {
    index++;
  }
  return index;
}

// 在某任务下新增子任务（插入到父任务下一行）
function addChildRow(parentRow: any, parentIndex: number) {
  if (parentRow.isNew && !parentRow.clientId) parentRow.clientId = createChangeClientId();
  changeForm.value.rows.splice(childInsertIndex(parentIndex, parentRow.depth), 0, {
    taskId: null,
    parentId: parentRow.isNew ? null : parentRow.taskId,
    parentClientId: parentRow.isNew ? parentRow.clientId : null,
    clientId: createChangeClientId(),
    title: '',
    depth: parentRow.depth + 1,
    startAt: '', dueAt: '', origStartAt: '', origDueAt: '',
    sortOrder: 0, origSortOrder: null,
    assigneeIds: [], acceptorIds: [], origAssigneeIds: [], origAcceptorIds: [],
    deleted: false, isNew: true,
  });
}

function removeNewChangeRow(index: number) {
  const row = changeForm.value.rows[index];
  if (!row?.isNew) return;
  let count = 1;
  while (index + count < changeForm.value.rows.length && changeForm.value.rows[index + count].depth > row.depth) {
    count++;
  }
  changeForm.value.rows.splice(index, count);
}

function toggleDeleteRow(row: any) {
  row.deleted = !row.deleted;
}

function isInvalidDateRange(row: any) {
  return !!(row.startAt && row.dueAt && row.dueAt < row.startAt);
}

function shiftDate(s: string | null, days: number): string {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function parseDateMs(value: string | null) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function daysBetween(from: string | null, to: string | null) {
  const fromMs = parseDateMs(from);
  const toMs = parseDateMs(to);
  if (fromMs == null || toMs == null) return 0;
  return Math.round((toMs - fromMs) / 86400000);
}

function dateChangeSignature(row: any) {
  return `${row.startAt || ''}|${row.dueAt || ''}`;
}

function dateShiftDays(row: any) {
  const startDiff = daysBetween(row.origStartAt || null, row.startAt || null);
  const dueDiff = daysBetween(row.origDueAt || null, row.dueAt || null);
  if (startDiff && dueDiff && startDiff === dueDiff) return startDiff;
  return dueDiff || startDiff || 0;
}

function shouldShowCascadePrompt(row: any) {
  return !row.isNew
    && !row.deleted
    && dateShiftDays(row) !== 0
    && row.shiftPromptHandledFor !== dateChangeSignature(row);
}

function formatShiftDays(row: any) {
  const days = dateShiftDays(row);
  return days > 0 ? `+${days} 天` : `${days} 天`;
}

function ignoreCascadePrompt(row: any) {
  row.shiftPromptHandledFor = dateChangeSignature(row);
}

function applyCascadeShiftFromChange(index: number, row: any) {
  const days = dateShiftDays(row);
  if (!days) return;
  for (let k = index + 1; k < changeForm.value.rows.length; k++) {
    const next = changeForm.value.rows[k];
    if (next.deleted) continue;
    next.startAt = shiftDate(next.startAt, days);
    next.dueAt = shiftDate(next.dueAt, days);
    next.shiftPromptHandledFor = dateChangeSignature(next);
  }
  row.shiftPromptHandledFor = dateChangeSignature(row);
  ElMessage.success(`已将后续任务顺延 ${formatShiftDays(row)}`);
}

function rowSiblingKey(row: any) {
  return `${row.depth}|${row.parentClientId ?? row.parentId ?? 'root'}`;
}

function rowBlockSize(index: number) {
  const row = changeForm.value.rows[index];
  if (!row) return 0;
  let size = 1;
  while (index + size < changeForm.value.rows.length && changeForm.value.rows[index + size].depth > row.depth) {
    size++;
  }
  return size;
}

function previousSiblingIndex(index: number) {
  const row = changeForm.value.rows[index];
  if (!row) return -1;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = changeForm.value.rows[i];
    if (candidate.depth > row.depth) continue;
    if (candidate.depth < row.depth) break;
    if (rowSiblingKey(candidate) === rowSiblingKey(row)) return i;
  }
  return -1;
}

function nextSiblingIndex(index: number) {
  const row = changeForm.value.rows[index];
  if (!row) return -1;
  let i = index + rowBlockSize(index);
  while (i < changeForm.value.rows.length) {
    const candidate = changeForm.value.rows[i];
    if (candidate.depth > row.depth) {
      i++;
      continue;
    }
    if (candidate.depth < row.depth) break;
    if (rowSiblingKey(candidate) === rowSiblingKey(row)) return i;
    break;
  }
  return -1;
}

function canMoveChangeRowUp(index: number) {
  return previousSiblingIndex(index) >= 0;
}

function canMoveChangeRowDown(index: number) {
  return nextSiblingIndex(index) >= 0;
}

function moveChangeRowBlock(index: number, direction: 'up' | 'down') {
  const rows = changeForm.value.rows;
  const size = rowBlockSize(index);
  if (!size) return;

  if (direction === 'up') {
    const prevIndex = previousSiblingIndex(index);
    if (prevIndex < 0) return;
    const block = rows.splice(index, size);
    rows.splice(prevIndex, 0, ...block);
    markMovedChangeRows(block);
    return;
  }

  const nextIndex = nextSiblingIndex(index);
  if (nextIndex < 0) return;
  const nextSize = rowBlockSize(nextIndex);
  const block = rows.splice(index, size);
  rows.splice(nextIndex - size + nextSize, 0, ...block);
  markMovedChangeRows(block);
}

function currentSiblingSortOrders() {
  const counts = new Map<string, number>();
  const result = new Map<any, number>();
  for (const row of changeForm.value.rows) {
    const key = rowSiblingKey(row);
    const next = counts.get(key) ?? 0;
    counts.set(key, next + 1);
    result.set(row, next);
  }
  return result;
}

// 是否容器行（父级）：其后紧跟更深一级 = 有子任务。
// 不用建行时打死的 isParent 标记——弹窗里先新增父任务、再加子任务的行也要能被识别为父级。
function rowHasChildren(i: number) {
  const rows = changeForm.value.rows;
  const p = rows[i];
  if (!p) return false;
  const next = rows[i + 1];
  return !!next && next.depth > p.depth;
}

// 父级行汇总（仅展示，父级本身不可直接改日期/人员）：
// 日期=后代最早开始 ~ 最晚结束；执行人/负责人=后代并集。随编辑实时重算（含本次新增的子任务）。
function parentSpan(i: number) {
  const rows = changeForm.value.rows;
  const p = rows[i];
  if (!p || !rowHasChildren(i)) return { startAt: '', dueAt: '', assignees: '', acceptors: '' };
  let startAt = '';
  let dueAt = '';
  const asg = new Set<string>();
  const acc = new Set<string>();
  for (let k = i + 1; k < rows.length && rows[k].depth > p.depth; k++) {
    const r = rows[k];
    if (r.deleted) continue;
    if (r.startAt && (!startAt || r.startAt < startAt)) startAt = r.startAt;
    if (r.dueAt && r.dueAt > dueAt) dueAt = r.dueAt;
    for (const id of r.assigneeIds || []) if (id != null) asg.add(String(id));
    for (const id of r.acceptorIds || []) if (id != null) acc.add(String(id));
  }
  const names = (s: Set<string>) =>
    [...s].map((id) => userName(Number(id))).filter((n) => n && n !== '—').join('、');
  return { startAt, dueAt, assignees: names(asg), acceptors: names(acc) };
}

async function submitChange() {
  if (!changeForm.value.reason.trim()) return ElMessage.warning('请填写变更原因');
  const invalidDateRow = changeForm.value.rows.find((r) => !r.deleted && isInvalidDateRange(r));
  if (invalidDateRow) return ElMessage.warning(`「${invalidDateRow.title || '新任务'}」截止日期不能早于开始日期`);
  const items: any[] = [];
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const sortOrders = currentSiblingSortOrders();
  for (const [i, r] of changeForm.value.rows.entries()) {
    const nextSortOrder = sortOrders.get(r) ?? 0;
        if (r.isNew) {
          if (!r.title.trim()) continue;
          items.push({
            taskId: r.parentId ?? null, changeType: 'add', before: {},
          after: {
            title: r.title.trim(),
            // 父级（行下已挂子任务）自带日期/人员无意义：以子任务为准，忽略父行上误填的值
            startAt: rowHasChildren(i) ? null : (r.startAt || null),
            dueAt: rowHasChildren(i) ? null : (r.dueAt || null),
            assigneeIds: rowHasChildren(i) ? [] : r.assigneeIds,
            acceptorIds: rowHasChildren(i) ? [] : r.acceptorIds,
            clientId: r.clientId ?? null,
            parentClientId: r.parentClientId ?? null,
            sortOrder: nextSortOrder,
          },
        });
        continue;
      }
    if (r.deleted) {
      items.push({ taskId: r.taskId, changeType: 'delete', before: { title: r.title }, after: {} });
      continue;
    }
    if (!rowHasChildren(i) && (r.startAt !== r.origStartAt || r.dueAt !== r.origDueAt)) {
      items.push({
        taskId: r.taskId, changeType: 'date',
        before: { startAt: r.origStartAt || null, dueAt: r.origDueAt || null },
        after: { startAt: r.startAt || null, dueAt: r.dueAt || null },
      });
    }
    if (nextSortOrder !== r.origSortOrder) {
      items.push({ taskId: r.taskId, changeType: 'reorder', before: { sortOrder: r.origSortOrder }, after: { sortOrder: nextSortOrder } });
    }
    if (JSON.stringify(sorted(r.assigneeIds)) !== JSON.stringify(sorted(r.origAssigneeIds))) {
      items.push({ taskId: r.taskId, changeType: 'assignee', before: { assigneeIds: r.origAssigneeIds }, after: { assigneeIds: r.assigneeIds } });
    }
    if (JSON.stringify(sorted(r.acceptorIds)) !== JSON.stringify(sorted(r.origAcceptorIds))) {
      items.push({ taskId: r.taskId, changeType: 'acceptor', before: { acceptorIds: r.origAcceptorIds }, after: { acceptorIds: r.acceptorIds } });
    }
  }
  if (!items.length) return ElMessage.warning('没有检测到变更');
  changeSaving.value = true;
  try {
    await planChangesApi.create({ projectId: changeForm.value.projectId, reason: changeForm.value.reason.trim(), items });
    refreshStore.markPlanChangeChanged();
    ElMessage.success('变更申请已提交，待审核通过后生效');
    changeDialogVisible.value = false;
  } catch (e: any) {
    ElMessage.error(e.message || '提交失败');
  } finally {
    changeSaving.value = false;
  }
}

const pct = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
};

// 中文时间格式
function formatTime(d: string) {
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 跳转参数只用于定位；兼容旧通知中的 projectId，不自动限制项目列表。
function readFocusParams() {
  const tidRaw = route.query.taskId;
  const tid = tidRaw == null ? null : Number(tidRaw);
  focusedTaskId.value = tid != null && !Number.isNaN(tid) ? tid : null;
  const fpRaw = route.query.focusProject ?? route.query.projectId;
  const fp = fpRaw == null ? null : Number(fpRaw);
  focusedOnlyProjectId.value = fp != null && !Number.isNaN(fp) ? fp : null;
  filterProject.value = null;
}

// ?copyChange 自动打开"复制重发"弹窗：onMounted 与路由参数变化各会触发，用 id 去重防双开
let handledCopyId: number | null = null;
function handleCopyQuery() {
  const ccRaw = route.query.copyChange;
  const ccId = ccRaw == null ? null : Number(ccRaw);
  if (ccId == null || Number.isNaN(ccId)) { handledCopyId = null; return; }
  if (handledCopyId === ccId) return;
  handledCopyId = ccId;
  openCopyPlanChange(ccId);
}

onMounted(() => {
  readFocusParams();
  // 从"变更审批 → 我发起的"点「复制重发」跳转进来：?copyChange=<变更id> 自动打开预填弹窗
  handleCopyQuery();
  load();
});

// Tasks 页在 keep-alive 缓存里可能被复用（从变更审批跳回时不走 onMounted），参数变化也必须响应
watch(() => route.query.copyChange, handleCopyQuery);

onActivated(() => {
  if (!hasLoaded.value) return;
  if (refreshStore.isStale(seenRefreshVersions.value, ['project', 'task', 'planChange'])) load();
});

// 响应 URL 参数变化：我的待办二次跳转 / 切回 /tasks 时清除筛选
watch(
  () => [route.query.projectId, route.query.taskId, route.query.focusProject, route.query.weekStart],
  (_value, previous) => {
    const prevT = focusedTaskId.value;
    const prevFp = focusedOnlyProjectId.value;
    readFocusParams();
    // Consuming the weekly link must not reload the list or disturb the open progress draft.
    if (focusedTaskId.value === prevT &&
      focusedOnlyProjectId.value === prevFp && route.query.weekStart == null) {
      openedWeeklyProgressKey = '';
      return;
    }
    if (
      focusedTaskId.value === prevT &&
      focusedOnlyProjectId.value === prevFp && route.query.weekStart === previous?.[3]
    ) {
      return;
    }
    resetCollapseForReload();
    load();
  },
);

// 聚焦具体任务：滚动定位到该任务行并短暂高亮（我的待办点击单个任务跳转）
let focusTimer: number | undefined;
async function focusFocusedTask(taskId: number | null = focusedTaskId.value, highlightMs = 1500) {
  if (taskId == null) return;
  await nextTick();
  // 等折叠/展开过渡完成（两帧）再定位，避免高度未稳定时滚错位置
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  // 行可能因展开动画/数据渲染稍晚出现：最多重试 ~1.5s，找到再滚
  let el: HTMLElement | null = null;
  for (let i = 0; i < 15 && !el; i++) {
    el = document.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
    if (!el) await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  if (!el) return;
  document.querySelectorAll('.task-row-focused').forEach(row => row.classList.remove('task-row-focused'));
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('task-row-focused');
  if (focusTimer) window.clearTimeout(focusTimer);
  focusTimer = window.setTimeout(() => el.classList.remove('task-row-focused'), highlightMs);
}

// 只定位不筛选：滚动到目标项目条并短暂高亮（列表内容不变）
async function focusFocusedProject() {
  if (focusedOnlyProjectId.value == null || focusedTaskId.value != null) return;
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const el = document.querySelector(`[data-project-id="${focusedOnlyProjectId.value}"]`) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('project-bar-focused');
  if (focusTimer) window.clearTimeout(focusTimer);
  focusTimer = window.setTimeout(() => el.classList.remove('project-bar-focused'), 1500);
}

onUnmounted(() => {
  if (focusTimer) window.clearTimeout(focusTimer);
  if (moveFlashTimer) window.clearTimeout(moveFlashTimer);
  if (moveFlashFrame) window.cancelAnimationFrame(moveFlashFrame);
});
</script>

<template>
  <div class="task-wrap">
    <!-- 概览条 -->
    <div class="overview-bar">
      <!-- 完成率环形图 -->
      <div class="ov-donut" :style="{ background: `conic-gradient(#288174 ${donePct}%, #e4eae7 ${donePct}%)` }">
        <div class="ov-donut-hole">
          <span class="ov-donut-pct">{{ donePct }}%</span>
          <span class="ov-donut-label">完成率</span>
        </div>
      </div>

      <div class="ov-divider"></div>

      <div class="ov-item">
        <span class="ov-num blue">{{ totalCount }}</span>
        <span class="ov-label">任务总数</span>
      </div>
      <div class="ov-item">
        <span class="ov-num green">{{ doneCount }}</span>
        <span class="ov-label">已完成</span>
      </div>
      <button
        class="ov-item ov-action"
        type="button"
        :class="{ active: quickFilter === 'doing' }"
        :aria-pressed="quickFilter === 'doing'"
        title="点击筛选进行中/待验收任务，再点一次取消"
        @click="setQuickFilter('doing')"
      >
        <span class="ov-num purple">{{ doingCount }}</span>
        <span class="ov-label">进行中</span>
      </button>
      <button
        class="ov-item ov-action risk-overdue"
        type="button"
        :class="{ active: quickFilter === 'overdue' }"
        :aria-pressed="quickFilter === 'overdue'"
        title="点击筛选延期任务，再点一次取消"
        @click="setQuickFilter('overdue')"
      >
        <span class="ov-num red">{{ stats.overdue }}</span>
        <span class="ov-label">延期</span>
      </button>
      <button
        class="ov-item ov-action risk-atrisk"
        type="button"
        :class="{ active: quickFilter === 'atRisk' }"
        :aria-pressed="quickFilter === 'atRisk'"
        title="点击筛选3天内到期任务，再点一次取消"
        @click="setQuickFilter('atRisk')"
      >
        <span class="ov-num orange">{{ stats.atRisk }}</span>
        <span class="ov-label">3天内到期</span>
      </button>

      <div class="ov-spacer"></div>
      <el-button type="primary" @click="openCreate()">
        <el-icon style="margin-right:6px"><Plus /></el-icon>
        新建任务
      </el-button>
    </div>

    <div class="tasks-container">
      <div class="filter-bar">
        <SmartSelect v-model="filterDept" :items="deptFilterItems" placeholder="部门" clearable style="width:160px" @change="load" />
        <el-select v-model="filterStatus" placeholder="状态" clearable style="width:130px" @change="onStatusFilterChange">
          <el-option v-for="(m, k) in STATUS_META" :key="k" :label="m.label" :value="k" />
        </el-select>
        <SmartSelect v-model="filterProject" :items="projectFilterItems" placeholder="项目" clearable style="width:200px" @change="load" />
        <UserSelect v-model="filterAssignee" :users="users" placeholder="执行人" clearable filterable style="width:150px" @change="load" />
        <label class="mine-switch">
          <span>仅显示我参与的项目</span>
          <el-switch v-model="showMine" />
        </label>
        <div class="filter-spacer"></div>
        <el-button :loading="loading" @click="load">
          <el-icon style="margin-right:6px"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <!-- 任务树：部门 → 项目 → 主任务 → 子任务 -->
      <div v-loading="loading" class="task-tree">
        <template v-for="dept in projectGroups" :key="dept.deptId">
          <!-- 部门分组（最高级，可收起） -->
          <div class="dept-group">
            <div class="dept-bar" @click="toggleDept(dept.deptId)">
              <span class="fold-ico"><el-icon><ArrowDown v-if="!collapsedDepts.has(dept.deptId)" /><ArrowRight v-else /></el-icon></span>
              <span class="dept-name" :title="deptName(dept.deptId)">{{ deptName(dept.deptId) }}</span>
              <span class="dept-count">{{ dept.projects.length }} 个项目</span>
              <span v-if="dept.overdue" class="risk-badge rb-overdue">延期 {{ dept.overdue }}</span>
              <span v-if="dept.atRisk" class="risk-badge rb-atrisk">临期 {{ dept.atRisk }}</span>
            </div>

            <!-- 部门内容：项目列表（可收起） -->
            <Transition name="fold" @enter="onEnter" @leave="onLeave">
              <div v-show="!collapsedDepts.has(dept.deptId)" class="dept-body">
                <template v-for="group in dept.projects" :key="group.projectId">
                  <div class="project-group">
                    <div class="project-bar" :data-project-id="group.projectId" @click.stop="toggleProject(group.projectId)">
                      <span class="fold-ico"><el-icon><ArrowDown v-if="!collapsedProjects.has(group.projectId)" /><ArrowRight v-else /></el-icon></span>
                      <span class="project-ico">📁</span>
                      <span class="project-name" :title="projectName(group.projectId)">{{ projectName(group.projectId) }}</span>
                      <span class="project-count">{{ group.tasks.length }} 个主任务</span>
                      <span v-if="group.overdue" class="risk-badge rb-overdue">延期 {{ group.overdue }}</span>
                      <span v-if="group.atRisk" class="risk-badge rb-atrisk">临期 {{ group.atRisk }}</span>
                      <el-tag v-if="isProjectLocked(group.projectId)" size="small" type="warning" effect="plain" round>已定稿</el-tag>
                      <el-tag v-else size="small" type="info" effect="plain" round>未定稿</el-tag>
                      <el-button
                        v-if="isProjectLocked(group.projectId) && !isProjectFrozen(group.projectId)"
                        size="small"
                        type="warning"
                        round
                        class="project-add-btn"
                        @click.stop="openPlanChange(group.projectId)"
                      >发起变更审核</el-button>
                      <el-button
                        v-else-if="canCreateTaskInProject(group.projectId)"
                        size="small"
                        type="primary"
                        round
                        class="project-add-btn"
                        @click.stop="openCreate({ projectId: group.projectId })"
                      >+ 任务</el-button>
                      <el-button
                        v-if="canApplyClosure(group.projectId)"
                        size="small" type="primary" plain round
                        @click.stop="router.push({ name: 'closures', query: { projectId: String(group.projectId) } })"
                      >申请结项</el-button>
                    </div>

                    <!-- 未定稿项目：项目名下小斜体黄字提示任务暂不能开始 -->
                    <div v-if="!isProjectLocked(group.projectId)" class="unlock-hint">
                      该项目计划尚未定稿，任务暂不能开始执行，请先「定稿」
                    </div>

                    <!-- 项目内容（可收起），递归 TaskRow 渲染任意层级 -->
                    <Transition name="fold" @enter="onEnter" @leave="onLeave">
                      <div v-show="!collapsedProjects.has(group.projectId)" class="project-body">
                        <div class="project-task-list" :class="{ 'has-edit-actions': !isProjectLocked(group.projectId) }">
                        <TaskRow
                          v-for="root in group.tasks"
                          :key="root.id"
                          :task="root"
                          :depth="0"
                          :collapsed-tasks="collapsedTasks"
                          :project-locked="isProjectLocked(group.projectId)"
                          :project-frozen="isProjectFrozen(group.projectId)"
                          :is-project-owner="ownedProjectIds.has(Number(group.projectId))"
                          :user-name="userName"
                          :status-label="statusLabel"
                          :status-type="statusType"
                          :pct="pct"
                          :open-detail="openDetail"
                          :open-create="openCreate"
                          :open-edit="openEdit"
                          :confirm="confirm"
                          :reject="reject"
                          :act="act"
                          :remove-task="removeTask"
                          :is-admin-leader="isAdminLeader"
                          :editable-project-ids="editableProjectIds"
                          :creatable-project-ids="creatableProjectIds"
                          :dragging-task-id="draggingTask?.id ?? null"
                          :drag-task="dragTask"
                          :drop-task="dropTask"
                          @toggle="toggleTask"
                        />
                        </div>
                      </div>
                    </Transition>
                  </div>
                </template>
              </div>
            </Transition>
          </div>
        </template>

        <el-empty v-if="!loading && !projectGroups.length" description="暂无任务" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑任务' : '新建任务'" width="520px" align-center :close-on-click-modal="false">
      <el-form label-width="80px">
        <el-form-item label="所属项目" required>
          <SmartSelect v-model="form.projectId" :items="createProjectItems" placeholder="选择项目" style="width:100%" @change="onProjectChange" />
          <div v-if="!editingId && !creatableProjects.length" class="form-tip">你当前没有可直接新增任务的未定稿项目；已定稿项目请发起变更审核。</div>
        </el-form-item>
        <el-form-item label="父级任务">
          <SmartSelect
            v-model="form.parentId"
            :items="parentOptions"
            placeholder="不选 = 主任务"
            clearable
            style="width:100%"
            :disabled="!form.projectId"
            @change="onParentChange"
          />
          <div class="form-tip">选择父级任务则创建子任务；不选则创建主任务（先选项目）</div>
        </el-form-item>
        <el-form-item label="任务标题" required>
          <el-input v-model="form.title" placeholder="如：完成客户需求确认" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="执行人">
          <UserSelect v-model="form.assigneeIds" :users="users" multiple placeholder="可多选执行人" style="width:100%" filterable :reserve-keyword="false" :disabled="editingIsParent" />
        </el-form-item>
        <el-form-item label="负责人">
          <UserSelect v-model="form.acceptorIds" :users="users" multiple placeholder="可多选负责人" style="width:100%" filterable :reserve-keyword="false" :disabled="editingIsParent" />
        </el-form-item>
        <el-form-item label="起止日期">
          <DatePick
            v-model="form.startAt"
            placeholder="开始"
            :max="form.dueAt || ''"
            :disabled="editingIsParent"
            style="width:48%"
          />
          <DatePick
            v-model="form.dueAt"
            placeholder="截止"
            :min="form.startAt || ''"
            :disabled="editingIsParent"
            style="width:48%; margin-left:4%"
          />
          <span v-if="editingIsParent" class="form-hint" style="width:100%; font-size:12px; color:#8a94a6;">父任务日期由子任务汇总，无需填写</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">创建</el-button>
      </template>
    </el-dialog>

    <!-- 任务详情弹窗 -->
    <el-dialog v-model="detailVisible" @closed="clearClosedTaskLink" title="任务详情" width="min(1200px, 94vw)" class="detail-dialog" align-center top="5vh" :close-on-click-modal="false">
      <div v-loading="detailLoading" class="detail-body" v-if="detail">
        <!-- 基本信息 -->
        <div class="d-head">
          <div>
            <h3 :title="detail.title">{{ detail.title }}</h3>
            <div class="d-meta">
              <span :title="projectName(detail.projectId)">项目：{{ projectName(detail.projectId) }}</span>
              <span :title="detailPeopleNames(detail.assigneeIds, detail.assigneeId)">执行人：{{ detailPeopleNames(detail.assigneeIds, detail.assigneeId) }}</span>
              <span :title="detailPeopleNames(detail.acceptorIds, detail.acceptorId)">负责人：{{ detailPeopleNames(detail.acceptorIds, detail.acceptorId) }}</span>
              <span :title="detailRange.startAt || '—'">开始：{{ detailRange.startAt || '—' }}</span>
              <span :title="detailRange.dueAt || '—'">预计完成：{{ detailRange.dueAt || '—' }}</span>
            </div>
          </div>
          <el-tag v-if="detail.status !== 'done'" :type="statusType(detail.status)" size="small" round>{{ statusLabel(detail.status) }}</el-tag>
          <TaskCompletionTag :task="detail" />
        </div>
        <div class="detail-common-actions">
            <div class="d-prog d-prog-compact">
              <span class="d-prog-label">总进度</span>
              <el-progress :percentage="pct(detail.progress)" :stroke-width="6" style="flex:1" />
            </div>
            <p v-if="detail.description" class="d-desc" :title="detail.description">{{ detail.description }}</p>

            <div v-if="detailChildren.length" class="d-ms">
              <div class="d-sec-title">下级任务</div>
              <div v-for="child in detailChildren" :key="child.id" class="d-ms-item">
                <div class="d-ms-top">
                  <span class="d-ms-name" :title="child.title">{{ child.title }}</span>
                  <span class="d-ms-due" :title="child.dueAt || '—'">预计完成：{{ child.dueAt || '—' }}</span>
                  <span class="d-ms-status" :class="child.status">{{ statusLabel(child.status) }}</span>
                </div>
                <div class="d-ms-bottom">
                  <el-progress :percentage="pct(child.progress)" :stroke-width="5" style="flex:1" />
                </div>
              </div>
            </div>

            <div v-if="isDetailParent" class="d-rollup-tip">
              父任务由子任务自动汇总：任一子任务开始即进入进行中，全部子任务验收通过后自动完成。
            </div>

            <!-- 状态流转 -->
            <div v-else class="d-actions">
              <el-button v-if="detail.status === 'pending_confirm' && canConfirmDetail" size="small" type="success" @click="actDetail('todo')">确认</el-button>
              <el-button v-if="detail.status === 'pending_confirm' && canConfirmDetail" size="small" type="danger" plain @click="reject(detail)">退回</el-button>
              <el-button v-if="detail.status === 'todo' && isDetailProjectLocked && canWorkDetail" size="small" type="primary" @click="actDetail('doing')">开始</el-button>
              <el-button v-if="detail.status === 'rejected' && canRestoreDetail" size="small" type="primary" plain @click="actDetail('todo')">恢复待办</el-button>
              <el-button v-if="detail.status === 'doing' && canWorkDetail" size="small" type="warning" @click="actDetail('pending_accept')">提交验收</el-button>
              <el-button v-if="detail.status === 'doing' && canUndoStartDetail" size="small" type="info" plain @click="revertStart">撤销开始</el-button>
              <el-button v-if="detail.status === 'pending_accept' && canReviewDetail" size="small" type="success" @click="actDetail('done')">通过</el-button>
              <el-button v-if="detail.status === 'pending_accept' && canReviewDetail" size="small" type="danger" plain @click="actDetail('doing')">退回</el-button>
              <el-button v-if="!isDetailFrozen && detail.status === 'done' && detail.canReopenCompleted" size="small" type="danger" plain @click="actDetail('doing')">退回</el-button>
            </div>
          </div>
        <el-tabs v-if="!isDetailParent || canViewOperationLogs" v-model="detailActiveTab" class="detail-tabs">

          <el-tab-pane v-if="!isDetailParent" label="进展与资料" name="updates">
            <div v-if="processLockTip" class="process-lock-tip">{{ processLockTip }}</div>
            <div class="process-panel">
              <div ref="progressEditor" class="progress-editor">
                <el-form label-position="top" class="process-form" :disabled="!canEditDetailProcess || processSaving">
                  <div class="d-sec-title">{{ supplementOnly ? '为已有进展补资料' : editingDailyUpdateId ? '编辑进展与资料' : '填写进展与资料' }}</div>
                  <p class="form-tip">记录本次工作，并附上资料；没有资料时请说明原因。</p>
                  <fieldset class="progress-text-fields" :disabled="progressTextLocked">
                  <el-form-item v-if="progressTextLocked" label="当前进展">{{ dailyForm.workDate }} · {{ dailyForm.content }}</el-form-item>
                  <div v-show="!progressTextLocked">
                      <el-form-item label="工作日期" required>
                        <div class="progress-date-week">
                        <DatePick v-model="dailyForm.workDate" placeholder="请选择实际工作日期" style="width: 200px; max-width: 100%" />
                        <TaskProgressWeek :planned-start="detail?.startAt" :planned-due="detail?.dueAt" :work-date="dailyForm.workDate" />
                        </div>
                      </el-form-item>
                  <el-form-item label="关键进展" required>
                    <el-input
                      v-model="dailyForm.content"
                      type="textarea"
                      :rows="6"
                      :autosize="{ minRows: 6, maxRows: 16 }"
                      resize="vertical"
                      maxlength="800"
                      show-word-limit
                      placeholder="这次完成了什么？遇到的问题也可以写在这里"
                    />
                  </el-form-item>
                  </div>
                  </fieldset>
                  <div class="draft-materials">
                    <div class="d-sec-title">相关资料</div>
                    <ProgressMaterialsChoice v-model="materialChoice" v-model:source="materialSource" :disabled="!canEditDetailProcess || processSaving" :has-saved-materials="hasSavedProgressMaterials" :supplement-only="supplementOnly" feishu>
                    <template #existing>
                    <ExistingTaskAssetsSelect v-model="selectedExistingAssetIds" :assets="taskAssets"
                      :update-id="editingDailyUpdateId" :disabled="!canEditDetailProcess || processSaving" />
                    </template>
                    <template #file>
                    <el-upload drag multiple :auto-upload="false" :show-file-list="false" :on-change="queueLocalAsset" :disabled="!canEditDetailProcess || processSaving" class="asset-uploader">
                      <div class="upload-text">点击或拖入文件<small>单个最大 50MB，每次最多 30 个、合计 200MB</small></div>
                    </el-upload>
                    </template>
                    <template #link>
                    <el-form-item class="material-links" label="资料链接">
                      <el-input v-model="assetForm.url" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="飞书文档或其他链接，每行一个" />
                    </el-form-item>
                    </template>
                    <template #feishu><el-button :disabled="processSaving" @click="openFeishuPicker">选择飞书文件</el-button></template>
                    <template #selected>
                    <p v-if="selectedExistingAssetIds.length || assetForm.url.trim()" class="form-tip">已选已有资料 {{ selectedExistingAssetIds.length }} 份 · 待保存链接 {{ assetForm.url.split(/\r?\n/).filter(s => s.trim()).length }} 条</p>
                    <ul v-if="pendingAssets.length" class="pending-materials">
                      <li v-for="asset in pendingAssets" :key="asset.key"><span>{{ assetDisplayTitle(asset) }}</span><el-button link type="danger" @click="pendingAssets = pendingAssets.filter(item => item.key !== asset.key)">移除</el-button></li>
                    </ul>
                    </template>
                    <template #reason>
                    <el-form-item v-if="needsMaterialReason" class="material-reason" label="本次无资料原因" required>
                      <NoMaterialReasonSelect v-model="dailyForm.noMaterialReason" :disabled="processSaving || !canEditDetailProcess" />
                    </el-form-item>
                    </template>
                    </ProgressMaterialsChoice>
                  </div>
                  <div class="process-submit">

                    <div class="process-submit-actions">
                      <el-button v-if="editingDailyUpdateId" @click="discardProcessDraft">填写新进展</el-button>
                      <el-button type="primary" :loading="processSaving" :disabled="!canEditDetailProcess" @click="submitDailyUpdate">
                        保存
                      </el-button>
                    </div>
                  </div>
                </el-form>
              </div>

              <div class="process-list">
                <div class="d-sec-title">进展记录</div>
                <el-empty v-if="!dailyTimeline.length" description="暂无关键进展" :image-size="80" />
                <div v-else class="daily-timeline">
                <div v-for="u in dailyTimeline" :key="u.id" class="daily-timeline-item">
                  <div class="daily-date-title" title="实际工作日期"><span>工作</span> {{ u.workDate || '未填写日期' }}</div>
                  <div class="daily-card">
                    <div class="daily-top">
                      <div class="daily-meta">
                        <span class="daily-user" :title="userName(u.userId)">{{ userName(u.userId) }}</span>
                        <span class="daily-time" title="进展提交时间">提交：{{ formatTime(u.createdAt) }}</span>
                      </div>
                      <div class="daily-status" :class="dailyStatus(u.status).cls">{{ dailyStatus(u.status).label }}</div>
                    </div>
                    <div class="daily-content">{{ u.content }}</div>
                    <p v-if="u.noMaterialReason" class="daily-material-reason">无资料原因：{{ u.noMaterialReason }}</p>
                    <div v-if="u.risk || u.nextPlan || u.affectDueDate || u.exemptReason" class="daily-extra">
                      <p v-if="u.risk" :title="u.risk">风险：{{ u.risk }}</p>
                      <p v-if="u.nextPlan" :title="u.nextPlan">下一步：{{ u.nextPlan }}</p>
                      <p v-if="u.affectDueDate">已标记：可能影响预计完成时间</p>
                      <p v-if="u.exemptReason" :title="u.exemptReason">合理补填原因：{{ u.exemptReason }}</p>
                    </div>
                    <div v-if="u.assets?.length" class="daily-assets">
                      <div class="daily-section-label">相关资料 · {{ u.assets.length }} 份</div>
                      <div v-for="asset in u.assets" :key="asset.id" class="linked-material-row">
                        <TaskMaterialLink :asset="asset" @open="openAsset" />
                        <el-button v-if="canEditDetailProcess" link type="info" :disabled="processSaving" @click="unlinkProgressAsset(u, asset)">解除关联</el-button>
                      </div>
                    </div>
                    <div class="daily-footer">
                    <div class="daily-actions" v-if="canEditDetailProcess || canModifyDailyUpdate(u) || canDeleteDailyUpdate(u) || canManageDetailProject">
                      <el-button v-if="canEditDetailProcess" link type="primary" size="small" :disabled="processSaving" @click="editDailyUpdate(u, true)">补资料</el-button>
                      <el-button v-if="canModifyDailyUpdate(u)" link type="primary" size="small" @click="editDailyUpdate(u)">编辑</el-button>
                      <el-button v-if="canDeleteDailyUpdate(u)" link type="danger" size="small" @click="deleteDailyUpdate(u)">删除</el-button>
                      <el-button v-if="canManageDetailProject && u.status !== 'exempted'" link type="primary" size="small" :disabled="!!exemptDisabledReason(u)" :aria-describedby="exemptDisabledReason(u) ? `exempt-disabled-${u.id}` : undefined" @click="exemptUpdate(u)">确认合理补填</el-button>
                      <el-button v-if="canManageDetailProject && u.status === 'exempted'" link type="warning" size="small" @click="unexemptUpdate(u)">撤销合理补填</el-button>
                    </div>
                    <details v-if="canManageDetailProject && u.status !== 'exempted' && exemptDisabledReason(u)" class="daily-explanation">
                      <summary>补填说明</summary>
                      <p :id="`exempt-disabled-${u.id}`" class="exempt-disabled-reason">{{ exemptDisabledReason(u) }}</p>
                    </details>
                    </div>
                  </div>
                </div>
                </div>
              <details v-if="taskAssets.length" class="asset-list">
                <summary class="d-sec-title">全部资料（{{ taskAssets.length }}）</summary>
                <el-select v-model="materialFilter" aria-label="筛选任务资料" style="width: 100%; margin-bottom: 12px">
                  <el-option label="全部资料" value="all" />
                  <el-option label="文件" value="file" />
                  <el-option label="链接" value="link" />
                </el-select>
                <div v-if="unlinkedTaskAssets.length" class="asset-list-tip warn">
                  有 {{ unlinkedTaskAssets.length }} 份历史资料未关联关键进展；可在对应进展记录中补充新资料。
                </div>
                <el-empty v-if="!filteredTaskAssets.length" :description="materialFilter === 'link' ? '暂无链接资料' : '暂无文件资料'" :image-size="64" />
                <div v-for="asset in filteredTaskAssets" :key="asset.id" class="asset-card">
                  <div class="asset-main">
                    <div>
                      <TaskMaterialLink :asset="asset" @open="openAsset" />
                      <div class="asset-meta" :title="`上传人：${userName(asset.uploaderId)} · ${formatTime(asset.createdAt)}`">
                        <span :title="userName(asset.uploaderId)">上传人：{{ userName(asset.uploaderId) }}</span> · {{ formatTime(asset.createdAt) }}
                        <span v-if="!assetProgressIds(asset).length"> · 未关联进展</span>
                      </div>
                    </div>
                  </div>
                  <div class="asset-actions">
                    <template v-if="!asset.url">
                      <el-button v-if="isAssetPreviewable(asset)" link type="primary" @click="previewAsset(asset)">预览</el-button>
                      <el-button link type="primary" @click="downloadAsset(asset)">下载</el-button>
                    </template>
                    <el-button v-if="!isDetailFrozen && assetProgressIds(asset).length <= 1" link type="danger" @click="removeAsset(asset)">删除</el-button>
                  </div>
                  <p v-if="asset.description" class="asset-desc" :title="asset.description">{{ asset.description }}</p>
                </div>
              </details>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane v-if="canViewOperationLogs" label="操作日志" name="logs">
            <div v-if="detail.logs?.length" class="d-logs">
              <div v-for="l in detail.logs" :key="l.id" class="d-log">
                <div class="d-log-content">
                  <div class="d-log-heading">
                    <span class="d-log-action" :data-tone="logActionMeta(l).type">{{ logActionMeta(l).label }}</span>
                    <span class="d-log-operator">操作人：{{ l.operatorName || userName(l.operatorId) }}</span>
                    <span class="d-log-status" v-if="l.fromStatus && l.toStatus">{{ statusLabel(l.fromStatus) }} → {{ statusLabel(l.toStatus) }}</span>
                  </div>
                  <p v-if="logNote(l)" class="d-log-note">{{ logNote(l) }}</p>
                </div>
                <span class="d-log-time">{{ formatTime(l.createdAt) }}</span>
              </div>
            </div>
            <el-empty v-else description="暂无操作日志" :image-size="80" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>

    <el-dialog v-model="feishuPickerVisible" title="选择飞书文件" width="680px" align-center>
      <div class="feishu-picker">
        <div class="feishu-search">
          <el-input
            v-model="feishuKeyword"
            placeholder="输入飞书文件关键词"
            clearable
            @keyup.enter="searchFeishuDocs"
          />
          <el-button type="primary" :loading="feishuSearching" @click="searchFeishuDocs">搜索</el-button>
        </div>
        <div v-if="feishuPickerMessage" class="feishu-message">{{ feishuPickerMessage }}</div>
        <div class="feishu-docs">
          <el-empty v-if="!feishuDocs.length" description="暂无搜索结果" :image-size="80" />
          <div v-for="doc in feishuDocs" :key="doc.id || doc.url || doc.title" class="feishu-doc" :title="doc.title" @click="chooseFeishuDoc(doc)">
            <div>
              <div class="feishu-title" :title="doc.title">{{ doc.title }}</div>
              <div class="feishu-meta">{{ doc.type || 'doc' }} · {{ doc.owner || '未知创建人' }}</div>
            </div>
            <el-button link type="primary">选择</el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="feishuPickerVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 发起变更审核弹窗 -->
    <el-dialog
      v-model="changeDialogVisible"
      class="change-dialog"
      width="min(1180px, 92vw)"
      align-center
      top="4vh"
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="change-dialog-header">
          <div>
            <div class="change-kicker">计划变更申请</div>
            <div class="change-dialog-title">发起变更审核</div>
          </div>
          <el-tag type="warning">审核通过后生效</el-tag>
        </div>
      </template>

      <div class="change-tip">
        <span class="tip-dot"></span>
        定稿项目变更不立即生效：改日期 / 执行人 / 负责人 / 删除任务 / 新增任务，提交后需审批通过才生效（发起人不是项目负责人时，先经项目负责人审核，再经总经办负责人终审；项目负责人/管理角色发起则直接终审）。
      </div>

      <div class="change-section-title">变更任务明细</div>
      <div class="change-head">
        <span class="change-title">任务</span>
        <span class="ch-date">开始</span>
        <span class="ch-date">截止</span>
        <span class="change-people">执行人</span>
        <span class="change-people">负责人</span>
        <span class="ch-op">操作</span>
      </div>
        <div class="change-list" v-loading="changeLoading">
          <TransitionGroup name="change-row-list" tag="div" class="change-list-inner">
          <div
            v-for="(r, i) in changeForm.rows"
            :key="changeRowKey(r, i)"
            class="change-row"
            :class="{
              'is-deleted': r.deleted,
              'is-new': r.isNew,
              'has-date-error': isInvalidDateRange(r),
              'is-moved-flash': isRecentlyMovedChangeRow(r),
            }"
          >
              <div
                class="change-title change-tree-cell"
                :class="{ 'is-root': r.depth === 0, 'is-child': r.depth > 0 }"
                :style="changeTreeStyle(r.depth)"
              >
                <span class="sort-controls" title="调整同级顺序">
                  <button
                    class="sort-btn"
                    type="button"
                    :disabled="!canMoveChangeRowUp(i)"
                    @click="moveChangeRowBlock(i, 'up')"
                  >↑</button>
                  <button
                    class="sort-btn"
                    type="button"
                    :disabled="!canMoveChangeRowDown(i)"
                    @click="moveChangeRowBlock(i, 'down')"
                  >↓</button>
                </span>
                <span class="tree-indent" aria-hidden="true"></span>
                <span class="tree-node" aria-hidden="true"></span>
                <div class="tree-content">
                  <el-input v-if="r.isNew" v-model="r.title" placeholder="新任务名称" size="small" />
                  <span v-else class="tree-label" :title="r.title">{{ r.title }}</span>
              </div>
              <span v-if="!r.isNew" class="tree-badge">{{ r.depth === 0 ? '父级' : '子级' }}</span>
            </div>
            <template v-if="!rowHasChildren(i)">
              <DatePick
                v-model="r.startAt"
                placeholder="开始"
                size="small"
                class="ch-date"
                :max="r.dueAt || ''"
                :disabled="r.deleted"
              />
              <DatePick
                v-model="r.dueAt"
                placeholder="截止"
                size="small"
                class="ch-date"
                :min="r.startAt || ''"
                :disabled="r.deleted"
              />
              <UserSelect v-model="r.assigneeIds" :users="users" multiple filterable :reserve-keyword="false" collapse-tags collapse-tags-tooltip placeholder="执行人" size="small" class="change-people" :disabled="r.deleted" />
              <UserSelect v-model="r.acceptorIds" :users="users" multiple filterable :reserve-keyword="false" collapse-tags collapse-tags-tooltip placeholder="负责人" size="small" class="change-people" :disabled="r.deleted" />
            </template>
            <template v-else>
              <span class="ch-date ch-ro" :title="parentSpan(i).startAt || '子任务未排开始时间'">{{ parentSpan(i).startAt || '—' }}</span>
              <span class="ch-date ch-ro" :title="parentSpan(i).dueAt || '子任务未排截止时间'">{{ parentSpan(i).dueAt || '—' }}</span>
              <span class="change-people ch-ro" :title="parentSpan(i).assignees || '子任务未指定执行人'">{{ parentSpan(i).assignees || '—' }}</span>
              <span class="change-people ch-ro" :title="parentSpan(i).acceptors || '子任务未指定负责人'">{{ parentSpan(i).acceptors || '—' }}</span>
            </template>
            <div class="ch-op">
              <el-button v-if="!r.deleted" size="small" link type="primary" @click="addChildRow(r, i)">+ 子任务</el-button>
              <el-button v-if="!r.isNew" size="small" link :type="r.deleted ? 'info' : 'danger'" @click="toggleDeleteRow(r)">{{ r.deleted ? '已删' : '删除' }}</el-button>
              <el-button v-else size="small" link type="danger" @click="removeNewChangeRow(i)">移除</el-button>
            </div>
            <div v-if="isInvalidDateRange(r)" class="date-error">
              截止日期不能早于开始日期
            </div>
            <div v-if="shouldShowCascadePrompt(r)" class="cascade-prompt">
              <span class="cascade-dot"></span>
              <span class="cascade-copy">
                已调整日期，是否将后续任务同步顺延 {{ formatShiftDays(r) }}？
              </span>
              <div class="cascade-actions">
                <el-button size="small" link @click="ignoreCascadePrompt(r)">仅修改本任务</el-button>
                <el-button size="small" type="primary" plain @click="applyCascadeShiftFromChange(i, r)">顺延后续任务</el-button>
              </div>
            </div>
          </div>
          </TransitionGroup>
        </div>
      <div class="change-footer-form">
        <el-button size="small" type="primary" plain class="change-add" @click="addChangeRow">+ 新增任务</el-button>
        <div class="reason-label">变更原因</div>
        <el-input
          v-model="changeForm.reason"
          type="textarea"
          :rows="3"
          placeholder="请说明变更原因，如：设备到货延迟 2 周、资源调整、现场排期变化等"
        />
      </div>
      <template #footer>
        <el-button @click="changeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="changeSaving" @click="submitChange">提交变更申请</el-button>
      </template>
    </el-dialog>

    <!-- 确认合理补填：原因可选（常用理由快选 / 可自由输入 / 可留空） -->
    <el-dialog v-model="exemptDialogVisible" title="确认合理补填" width="460px" align-center :close-on-click-modal="false">
      <p class="exempt-tip">
        确认后，这条补填进展将不再计入异常提醒，记录仍会保留。<br />
        仅工作日期不晚于任务截止日期时可标记；标记生效后会通知总经办负责人知晓，无需审批。<br />
        原因<strong>可不填</strong>，也可从常用理由中选择，或直接输入自定义原因。
      </p>
      <el-select
        v-model="exemptReason"
        filterable
        allow-create
        default-first-option
        clearable
        placeholder="选择常用理由，或直接输入（可留空）"
        style="width: 100%"
      >
        <el-option v-for="r in EXEMPT_REASON_OPTIONS" :key="r" :label="r" :value="r" />
      </el-select>
      <template #footer>
        <el-button @click="exemptDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="exemptSaving" :disabled="!!exemptDisabledReason(exemptTarget)" @click="submitExempt">确认合理补填</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.task-wrap {
  --brand: var(--color-primary);
  --ink: var(--text-1);
  --ink-2: var(--text-2);
  --ink-3: var(--text-3);
  --line: var(--border);
}
.overview-bar {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  background: #fff; border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 22px; margin-bottom: 14px;
}
.ov-item { display: flex; align-items: baseline; gap: 8px; }
.ov-num { font-size: 24px; font-weight: 700; }
.ov-num.blue { color: var(--brand); }
.ov-num.green { color: var(--color-success); }
.ov-num.purple { color: var(--color-accent); }
.ov-num.orange { color: var(--color-warning); }
.ov-num.red { color: var(--color-danger); }
.ov-label { font-size: 13px; color: var(--ink-3); }
.ov-divider { width: 1px; height: 22px; background: var(--line); }
.ov-spacer { flex: 1; }
.ov-action {
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}
.ov-action:hover {
  border-color: var(--color-primary-200);
  background: #f7faf8;
  transform: translateY(-1px);
}
.ov-action.active {
  border-color: var(--brand);
  background: var(--brand-light);
  box-shadow: 0 0 0 3px rgba(40, 129, 116, 0.10);
}
.ov-action:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* 风险指标：红色/橙色底，一眼看出异常 */
.ov-item.risk-overdue, .ov-item.risk-atrisk { align-items: center; padding: 6px 12px; border-radius: 10px; }
.ov-item.risk-overdue { background: #fff1f2; }
.ov-item.risk-atrisk { background: #fff8e8; }
.ov-item.risk-overdue.active {
  border-color: #ffd5d8;
  background: #fff1f2;
}
.ov-item.risk-atrisk.active {
  border-color: #ffe4b5;
  background: #fff8e8;
}

/* 完成率环形图 */
.ov-donut {
  width: 62px; height: 62px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ov-donut-hole {
  width: 46px; height: 46px; border-radius: 50%; background: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1;
}
.ov-donut-pct { font-size: 15px; font-weight: 700; color: var(--color-success); }
.ov-donut-label { font-size: 10px; color: #8a94a6; margin-top: 2px; }

.tasks-container {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #e9eef2;
  border-radius: 22px;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
/* 未定稿项目提示：项目名后小斜体黄字 */
.unlock-hint {
  font-size: 12px;
  font-style: italic;
  color: #d8a400;
  padding: 0 0 6px 46px;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #edf2f4;
  background: #fbfcfb;
}
.mine-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  color: #667085;
  font-size: 13px;
  white-space: nowrap;
}
.filter-spacer { flex: 1; }

/* ---------- 任务树：父卡片 + 子卡片分组 ---------- */
.task-tree { padding: 20px; min-height: 200px; }
.parent-group { margin-bottom: 20px; }

/* 项目区块：项目头 + 该项目任务 */
.project-section { margin-bottom: 24px; }
.project-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 16px;
  margin-bottom: 12px;
}
.project-ico { font-size: 16px; }
.project-name { font-size: 15px; font-weight: 800; color: #111827; }
.project-count { font-size: 12px; color: #98a2b3; margin-left: auto; }
/* ---------- 任务树：项目分组 + 行式任务 ---------- */
.task-tree { padding: 20px; min-height: 200px; }


/* 项目分组：明显标题条 */
.project-group { margin-bottom: 18px; }
.project-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px;
  cursor: pointer;
  user-select: none;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 16px;
  margin-bottom: 10px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.035);
}
.project-bar:hover {
  border-color: #dce8e4;
  background: #fbfdfc;
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.05);
}
.project-ico { font-size: 16px; }
.project-name { font-size: 16px; font-weight: 850; color: #111827; }
.project-count { font-size: 13px; color: #98a2b3; margin-left: auto; }
.project-add-btn { margin-left: 10px; flex-shrink: 0; }
.project-dept {
  margin-left: auto;
  font-size: 13px; font-weight: 600;
  color: var(--brand-hover);
  background: #eef5f1;
  border: 1px solid #d7f5ed;
  border-radius: 999px;
  padding: 2px 10px;
}
.fold-ico { display: inline-flex; color: #98a2b3; font-size: 14px; width: 16px; }

.project-body {
  margin-left: 16px;
  padding-left: 16px;
  border-left: 1px solid #e4ece9;
  overflow-x: auto;
}
.project-task-list { min-width: 1230px; }
.project-task-list.has-edit-actions { min-width: 1366px; }
@media (max-width: 760px) {
  .project-task-list,
  .project-task-list.has-edit-actions { min-width: 0; }
}

/* ---------- 部门层级（最高级，最显眼） ---------- */
.dept-group { margin-bottom: 22px; }
.dept-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 15px 18px;
  cursor: pointer;
  user-select: none;
  background: #f7faf8;
  border: 1px solid #e1eee9;
  border-radius: 20px;
  margin-bottom: 12px;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.045);
}
.dept-bar:hover {
  border-color: #d4e8e1;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
}
.dept-bar .fold-ico { color: var(--brand-hover); width: 18px; }
.dept-ico { font-size: 18px; }
.dept-name { font-size: 19px; font-weight: 900; color: #111827; letter-spacing: -0.03em; }
.dept-count { font-size: 13px; color: #98a2b3; margin-left: 6px; }
.dept-body { margin-left: 18px; }

/* 延期 / 临期风险标记 */
.risk-badge {
  font-size: 11px; font-weight: 800; border-radius: 999px;
  padding: 1px 7px; line-height: 18px; flex-shrink: 0; margin-left: 8px;
}
.rb-overdue { background: #fff1f2; color: #e5484d; border: 1px solid #ffd5d8; }
.rb-atrisk { background: #fff8e8; color: #d88a06; border: 1px solid #ffe4b5; }

/* 折叠动画：Transition + JS 测量高度，height 过渡（顺滑） */
.fold-enter-active,
.fold-leave-active {
  transition: height .3s cubic-bezier(.25,.8,.25,1), opacity .25s ease;
  overflow: hidden;
}
.fold-enter-from,
.fold-leave-to {
  opacity: 0;
}

/* 任务行：紧凑卡片 */
.task-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 11px 12px;
  border-radius: 15px;
  margin-bottom: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
.task-row:hover {
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
  transform: translateY(-1px);
}

/* 主任务行 */
.parent-row {
  background: #fff;
  border: 1px solid #e3eee9;
}
.parent-row:hover { border-color: #cfeee6; }
/* 子任务行 */
.child-row {
  background: #fff;
  border: 1px solid #edf2f4;
}
.child-row:hover { border-color: #dfe8eb; }

/* 类型圆点 */
.type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.parent-dot { background: #3f7667; box-shadow: 0 0 0 4px rgba(63, 118, 103, 0.12); }
.child-dot { background: #9aa7b5; }

.row-title {
  font-size: 13px; font-weight: 650; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 300px; flex-shrink: 1;
}
.parent-row .row-title { font-weight: 850; color: #111827; }

.child-count { font-size: 11px; color: var(--brand-hover); background: var(--color-primary-bg); border-radius: 999px; padding: 0 7px; line-height: 18px; flex-shrink: 0; }

/* 行右侧：进度条 + 按钮 */
.row-right { margin-left: auto; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.row-prog { display: flex; align-items: center; gap: 8px; width: 130px; }
.row-prog .el-progress { flex: 1; min-width: 80px; }
.prog-pct { font-size: 12px; font-weight: 700; color: var(--ink); width: 36px; text-align: right; flex-shrink: 0; }

.row-actions { display: flex; align-items: center; gap: 2px; }
.row-actions .el-button { font-size: 12px; }

/* 第二行元信息：负责人/验收人/起止 */
.row-meta {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14px;
  width: 100%;
  padding-left: 26px;
  margin-top: 2px;
  font-size: 12px; color: #98a2b3;
}
.row-meta .meta-item { display: inline-flex; align-items: center; gap: 4px; }
.row-meta .meta-item .el-icon { font-size: 13px; }
.row-meta .meta-item.overdue { color: #e5484d; font-weight: 700; }

/* 子任务容器：纵向排列（display 由 collapse-box 的 grid 控制） */
.child-rows { }
/* 孙任务更深缩进 */
.grand-rows { margin-left: 22px; padding-left: 14px; border-left: 1px solid #e6eaee; }
.grand-row { background: #fbfcfd; }

.overdue { color: #e5484d; font-weight: 650; }
.form-tip { font-size: 11px; color: #98a2b3; line-height: 1.6; margin-top: 4px; }

/* ---------- 任务详情弹窗 ---------- */
:global(.detail-dialog > .el-dialog__header) { padding: 8px 24px 10px; }
:global(.detail-dialog > .el-dialog__body) { padding: 12px 24px 20px; }
.detail-body { --detail-scroll-height: 74vh; max-height: var(--detail-scroll-height); overflow: auto; padding-right: 4px; }
.d-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.d-head h3 { margin: 0; font-size: 19px; color: #111827; font-weight: 900; }
.d-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; font-size: 12px; color: #8a94a6; }
.detail-common-actions { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 0 18px; align-items: center; margin-top: 10px; }
.detail-common-actions > .d-desc, .detail-common-actions > .d-ms, .detail-common-actions > .d-rollup-tip { grid-column: 1 / -1; }
.d-prog { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.d-prog-compact { grid-column: 1; grid-row: 1; width: 100%; max-width: 320px; margin-top: 0; min-height: 28px; }
.d-prog-label { font-size: 13px; color: #4b5563; white-space: nowrap; }
.d-desc { margin: 10px 0 0; font-size: 13px; color: #6b7280; background: #f9fafb; border-radius: 8px; padding: 10px; }
.detail-tabs { margin-top: 10px; }
/* 让左侧吸顶相对于弹窗滚动区，避免标签页的 overflow 截断。 */
.detail-tabs :deep(.el-tabs__content) { overflow: visible; }
.detail-tabs :deep(.el-tabs__item) { font-weight: 800; }
.d-actions { grid-column: 2; grid-row: 1; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 0; }
.d-actions :deep(.el-button + .el-button) { margin-left: 0; }
@media (max-width: 600px) {
  .detail-common-actions { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .d-actions { grid-column: 1; grid-row: auto; }
}
.d-rollup-tip {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f0fdfa;
  color: #0f766e;
  font-size: 13px;
}
.d-ms { margin-top: 16px; }
.d-sec-title { font-size: 13px; font-weight: 600; color: #1f2733; margin-bottom: 8px; }
.d-ms-item { display: grid; grid-template-columns: minmax(0, 1fr) 180px; align-items: center; gap: 24px; border: 1px solid #e4eae7; border-radius: 10px; padding: 14px 16px; margin-bottom: 8px; background: #fff; }
.d-ms-top { display: grid; grid-template-columns: minmax(0, 1fr) 170px 70px; align-items: center; gap: 14px; min-width: 0; }
.d-ms-name { font-size: 13px; font-weight: 500; color: #1f2733; overflow-wrap: anywhere; }
.d-ms-due { font-size: 12px; color: #64748b; }
.d-ms-weight { font-size: 11px; color: #8a94a6; }
.d-ms-status { font-size: 12px; }
.d-ms-status.done { color: var(--color-success); }
.d-ms-status.doing,
.d-ms-status.pending_accept { color: var(--brand); }
.d-ms-status.todo,
.d-ms-status.pending_confirm { color: #8a94a6; }
.d-ms-bottom { display: flex; align-items: center; gap: 10px; }
.d-ms-bottom :deep(.el-progress__text), .d-prog-compact :deep(.el-progress__text) { font-size: 12px !important; color: #64748b; min-width: 35px; }
@media (max-width: 980px) {
  .d-ms-top { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; }
  .d-ms-due { grid-row: 2; grid-column: 1 / -1; }
  .d-ms-status { grid-column: 2; grid-row: 1; }
}
@media (max-width: 600px) {
  .d-ms-item { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 12px; }
  .d-ms-bottom { width: 180px; max-width: 100%; }
}
.d-logs { margin-top: 16px; }
.d-log { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; line-height: 1.6; color: #596579; padding: 10px 0; border-bottom: 1px dashed #e5e7eb; }
.d-log-content { flex: 1 1 360px; min-width: 0; }
.d-log-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; }
.d-log-action { background: #f1f5f9; color: #475569; border-radius: 4px; padding: 1px 7px; font-size: 12px; font-weight: 600; }
.d-log-action[data-tone="primary"] { background: #eff6ff; color: #1d4ed8; }
.d-log-action[data-tone="success"] { background: #ecfdf5; color: #047857; }
.d-log-action[data-tone="warning"] { background: #fffbeb; color: #92400e; }
.d-log-action[data-tone="danger"] { background: #fef2f2; color: #b91c1c; }
.d-log-operator { color: #334155; font-weight: 600; }
.d-log-time { margin-left: auto; color: #64748b; white-space: nowrap; }
.d-log-note { margin: 5px 0 0; color: #475569; white-space: pre-wrap; overflow-wrap: anywhere; }
.progress-text-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.linked-material-row { display: flex; align-items: center; gap: 12px; }
.linked-material-row > :first-child { flex: 1; min-width: 0; }
.linked-material-row :deep(.material-link) { align-items: center; }
.linked-material-row > .el-button { flex-shrink: 0; margin: 0; }
.draft-materials { border-top: 1px solid #dcebe8; margin-top: 16px; padding-top: 16px; }
.pending-materials { padding: 0; list-style: none; }
.pending-materials li { display: flex; justify-content: space-between; gap: 8px; overflow-wrap: anywhere; margin-top: 8px; }
.process-panel { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 18px; align-items: start; }
.progress-editor {
  position: sticky;
  top: 0;
  min-width: 0;
  max-height: var(--detail-scroll-height);
  overflow-y: auto;
  /* 内栏未溢出或已到边缘时，允许滚轮继续滚动外层详情弹窗。 */
  overscroll-behavior-y: auto;
  scrollbar-gutter: stable;
}
.asset-workbench {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(280px, 0.85fr);
  gap: 18px;
  align-items: start;
}
.process-lock-tip {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
  font-weight: 700;
}
.process-form,
.asset-form {
  border: 1px solid #dcebe8;
  border-radius: 16px;
  padding: 16px;
  background: #fff;
}
.asset-form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.asset-form-head p {
  max-width: 60ch;
  margin: -2px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}
.asset-empty-hint {
  margin: -6px 0 14px;
  padding: 9px 11px;
  border: 1px solid #fdecc8;
  border-radius: 10px;
  background: #fff8eb;
  color: #9a5b00;
  font-size: 12px;
  line-height: 1.6;
}
.process-submit { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.exempt-disabled-reason { margin: 6px 0 0; color: var(--el-text-color-secondary, #909399); font-size: 12px; line-height: 1.6; text-align: right; }
.process-submit-actions { display: flex; align-items: center; gap: 10px; }
.process-list,
.asset-list {
  border: 1px solid #e4eae7;
  border-radius: 16px;
  padding: 14px;
  background: #fbfdfd;
  min-height: 230px;
  min-width: 0;
  overflow: hidden;
}
.process-panel > .process-list {
  box-sizing: border-box;
  max-height: var(--detail-scroll-height);
  overflow-y: auto;
  overscroll-behavior-y: auto;
  scrollbar-gutter: stable;
}
.asset-list-tip {
  margin: -2px 0 10px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.6;
}
.asset-list-tip.warn {
  color: #b45309;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 10px;
  padding: 8px 10px;
}
.daily-timeline { position: relative; padding-left: 20px; }
.daily-timeline::before { content: ''; position: absolute; left: 5px; top: 10px; bottom: 20px; width: 2px; background: #cfe2da; }
.daily-timeline-item { position: relative; display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 10px; padding-bottom: 10px; }
.daily-timeline-item::before { content: ''; position: absolute; left: -19px; top: 8px; width: 10px; height: 10px; border-radius: 50%; background: #0f9f8f; box-shadow: 0 0 0 4px #ecf8f5; }
.daily-date-title {
  padding-top: 4px;
  color: #3569a6;
  font-size: 12px;
  font-weight: 700;
}
.daily-date-title > span { font-weight: 500; }
.daily-card,
.asset-card {
  position: relative;
  padding: 12px;
  border: 1px solid #e8eef2;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
  min-width: 0;
}
.daily-card + .daily-card,
.asset-card + .asset-card { margin-top: 10px; }
.daily-top,
.asset-main { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.daily-card { padding: 8px 10px; box-shadow: none; border-radius: 10px; }
.daily-top { align-items: flex-start; flex-wrap: wrap; }
.daily-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.daily-user, .daily-time { font-size: 12px; color: #64748b; overflow-wrap: anywhere; }
.daily-status {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 800;
  background: #e6f3ef;
  color: var(--color-success);
}
.daily-status.late { background: var(--color-danger-bg); color: var(--color-danger); }
.daily-status.supplemented { background: var(--color-warning-bg); color: var(--color-warning); }
.daily-status.exempted { background: #f1f5f9; color: #64748b; }
.daily-section-label { color: #64748b; font-size: 12px; font-weight: 600; margin-top: 12px; }
.daily-content { margin-top: 3px; color: #273444; line-height: 1.5; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.daily-extra {
  margin-top: 4px;
  padding: 0;
  color: #64748b;
  font-size: 12px;
}
.daily-extra p { margin: 0; line-height: 1.5; }
.daily-assets { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e8eef2; }
.daily-assets .daily-section-label { margin-top: 0; }
.daily-footer { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-end; gap: 0 10px; margin-top: 3px; }
.daily-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0 10px; margin-top: 0; }
.daily-actions :deep(.el-button--small) { min-height: 20px; height: 20px; padding-top: 0; padding-bottom: 0; }
.daily-explanation { color: #64748b; font-size: 12px; }
.daily-explanation summary { cursor: pointer; line-height: 20px; }
.daily-explanation[open] { flex-basis: 100%; text-align: right; }
.daily-explanation summary:focus-visible { outline: 2px solid #3569a6; outline-offset: 2px; }
.daily-actions :deep(.el-button + .el-button) { margin-left: 0; }
.exempt-disabled-reason { margin: 6px 0 0; color: #909399; font-size: 12px; line-height: 1.6; text-align: right; overflow-wrap: anywhere; }

/* 确认合理补填弹窗的说明文字 */
.exempt-tip {
  margin: 0 0 12px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.7;
}
.asset-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
  row-gap: 8px;
}
.asset-main { justify-content: flex-start; align-items: flex-start; min-width: 0; }
.asset-main > div { min-width: 0; flex: 1; }
.asset-meta {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-actions { display: flex; align-items: flex-start; gap: 6px; flex-shrink: 0; }
.asset-desc {
  grid-column: 1 / -1;
  margin: 2px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.upload-box {
  grid-column: 1 / -1;
  border: 1px dashed #b9ded8;
  border-radius: 16px;
  padding: 14px;
  background: #fbfffe;
}
.asset-uploader { margin-top: 12px; }
.asset-uploader :deep(.el-upload-dragger) {
  padding: 20px 12px;
  border-color: #b9ded8;
  background: #f7faf8;
}
.material-links { margin-top: 16px; }
.material-reason { margin-top: 16px; }
.daily-material-reason { margin: 4px 0 0; padding: 0; color: #8a5c1b; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.material-links :deep(.el-button) { margin-top: 8px; }
.asset-list summary { cursor: pointer; }
.upload-text { color: var(--brand-hover); font-weight: 700; }
.upload-text small { display: block; margin-top: 4px; color: #94a3b8; font-weight: 500; }
.feishu-picker { display: flex; flex-direction: column; gap: 12px; }
.feishu-search { display: flex; gap: 10px; }
.feishu-message {
  border-radius: 10px;
  padding: 8px 10px;
  background: #f2f5f3;
  color: #64748b;
  font-size: 12px;
}
.feishu-docs { min-height: 160px; }
.feishu-doc {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  cursor: pointer;
}
.feishu-doc + .feishu-doc { margin-top: 8px; }
.feishu-doc:hover { background: #f7fffd; border-color: #b9ded8; }
.feishu-title { color: #111827; font-weight: 800; }
.feishu-meta { margin-top: 3px; color: #94a3b8; font-size: 12px; }

@media (max-width: 980px) {
  .process-panel { grid-template-columns: 1fr; }
  .progress-editor { position: static; max-height: none; overflow: visible; scrollbar-gutter: auto; }
  .process-panel > .process-list { max-height: none; overflow: visible; scrollbar-gutter: auto; }
  .asset-workbench { grid-template-columns: 1fr; }
  .asset-actions { position: static; justify-content: flex-end; margin-top: 8px; }
}
@media (max-width: 600px) {
  .daily-timeline-item { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .linked-material-row { flex-wrap: wrap; }
}

/* 发起变更审核 */
.change-dialog :deep(.el-dialog__header) {
  padding: 22px 26px 16px;
  background: #fff;
}

.change-dialog :deep(.el-dialog__body) {
  padding: 18px 26px 20px;
  background: #fff;
}

.change-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.change-kicker {
  color: var(--brand);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.change-dialog-title {
  margin-top: 3px;
  color: var(--text-1);
  font-size: 20px;
  font-weight: 900;
}

.change-tip {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 14px;
  margin-bottom: 16px;
  border: 1px solid #fdecc8;
  border-radius: var(--radius-md);
  color: #8a4b00;
  background: #fff8eb;
  font-size: 13px;
  line-height: 1.65;
}

.tip-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 4px rgba(217, 119, 6, 0.12);
}

.change-section-title {
  margin: 0 0 8px;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 900;
}

.change-list {
  max-height: min(520px, calc(100vh - 390px));
  overflow-y: auto;
  padding: 2px 2px 4px;
}

.change-list-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.change-row-list-move {
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.change-row-list-enter-active,
.change-row-list-leave-active {
  transition:
    opacity 220ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.change-row-list-enter-from,
.change-row-list-leave-to {
  opacity: 0;
  transform: translate3d(0, 8px, 0);
}

.change-head {
  display: grid;
  grid-template-columns: minmax(260px, 1.5fr) 132px 132px minmax(150px, 1fr) minmax(150px, 1fr) minmax(190px, auto);
  align-items: center;
  column-gap: 10px;
  padding: 10px 14px;
  border: 1px solid #e6ecea;
  border-radius: var(--radius-md);
  color: #52615d;
  background: #f5f8f7;
  font-size: 12px;
  font-weight: 900;
}

.change-row {
  display: grid;
  grid-template-columns: minmax(260px, 1.5fr) 132px 132px minmax(150px, 1fr) minmax(150px, 1fr) minmax(190px, auto);
  align-items: center;
  column-gap: 10px;
  padding: 11px 14px;
  border: 1px solid #e6ecea;
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.03);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

.change-row:hover {
  border-color: var(--color-primary-200);
  box-shadow: 0 8px 18px rgba(63, 118, 103, 0.08);
}

.change-row.has-date-error {
  border-color: #fecaca;
}

.change-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 700;
}

.change-tree-cell {
  display: grid;
  grid-template-columns: 18px calc(var(--tree-depth) * 26px) 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 38px;
}

.sort-controls {
  width: 18px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.sort-btn {
  width: 18px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 5px;
  color: #7b8a86;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  transition: background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
}

.sort-btn:hover:not(:disabled) {
  color: var(--brand);
  background: var(--brand-light);
}

.sort-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.sort-btn:disabled {
  color: #cbd5d2;
  cursor: not-allowed;
}

.tree-indent {
  position: relative;
  width: calc(var(--tree-depth) * 26px);
  height: 38px;
}

.change-tree-cell.is-child .tree-indent::before {
  position: absolute;
  top: -20px;
  right: 7px;
  bottom: 18px;
  width: 1px;
  background: #cfe0dc;
  content: "";
}

.change-tree-cell.is-child .tree-indent::after {
  position: absolute;
  right: 7px;
  bottom: 18px;
  width: 18px;
  height: 1px;
  background: #cfe0dc;
  content: "";
}

.tree-node {
  position: relative;
  width: 12px;
  height: 12px;
  border: 2px solid var(--brand);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 4px var(--brand-light);
}

.change-tree-cell.is-root .tree-node {
  width: 14px;
  height: 14px;
  border-radius: 5px;
  background: var(--brand);
  box-shadow: 0 0 0 5px var(--brand-light);
}

.tree-content {
  min-width: 0;
}

.tree-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: keep-all;
}

.tree-badge {
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--brand);
  background: var(--brand-light);
  font-size: 11px;
  font-weight: 800;
}

.change-tree-cell.is-child .tree-badge {
  color: #52615d;
  background: #f1f5f4;
}

.ch-date {
  width: auto;
  min-width: 0;
}

.change-people {
  width: auto;
  min-width: 0;
}

/* 父级行只读汇总单元格：灰底文本，展示子任务自动带出的区间与人员 */
.ch-ro {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8a94a6;
  font-size: 12px;
  background: #f4f6f8;
  border: 1px dashed #e3e8ee;
  border-radius: 6px;
  padding: 4px 8px;
  min-height: 24px;
  box-sizing: border-box;
  line-height: 1.4;
}

.ch-op {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 0;
  white-space: nowrap;
}

.ch-op .el-button {
  padding-right: 5px;
  padding-left: 5px;
  font-weight: 700;
}

.date-error {
  grid-column: 2 / 4;
  color: var(--danger);
  font-size: 12px;
  font-weight: 700;
}

.cascade-prompt {
  display: flex;
  grid-column: 2 / -1;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  margin-top: 4px;
  border: 1px solid var(--color-primary-200);
  border-radius: var(--radius-sm);
  color: #0f5f57;
  background: var(--brand-light);
  font-size: 12px;
}

.cascade-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 0 4px rgba(63, 118, 103, 0.10);
}

.cascade-copy {
  flex: 1;
  min-width: 0;
  font-weight: 700;
}

.cascade-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.change-row.is-new {
  border-style: dashed;
  border-color: var(--color-primary-200);
  background: var(--brand-light);
}

.change-row.is-deleted {
  opacity: 0.58;
  background: #f8f5f4;
}

.change-row.is-deleted .tree-label {
  text-decoration: line-through;
}

.change-row.is-moved-flash {
  animation: change-row-moved 1450ms cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: transform, box-shadow, background;
}

@keyframes change-row-moved {
  0% {
    border-color: var(--color-primary-300);
    background: #eef5f1;
    box-shadow: 0 14px 34px rgba(63, 118, 103, 0.18);
  }

  18% {
    border-color: var(--color-primary-200);
    background: #f7faf8;
    box-shadow: 0 8px 22px rgba(63, 118, 103, 0.12);
  }

  68% {
    border-color: var(--color-primary-200);
    background: #f7faf8;
    box-shadow: 0 0 0 3px rgba(63, 118, 103, 0.10);
  }

  100% {
    border-color: #e6ecea;
    background: #fff;
    box-shadow: 0 1px 2px rgba(28, 25, 23, 0.03);
  }
}

.change-footer-form {
  padding: 14px;
  margin-top: 14px;
  border: 1px solid #e6ecea;
  border-radius: var(--radius-md);
  background: #f8fbfa;
}

.change-add {
  margin-bottom: 12px;
}

.reason-label {
  margin-bottom: 7px;
  color: #52615d;
  font-size: 13px;
  font-weight: 900;
}

@media (max-width: 1120px) {
  .change-head { display: none; }
  .change-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); row-gap: 8px; }
  .change-title, .ch-op, .cascade-prompt, .date-error { grid-column: 1 / -1; }
  .ch-date, .change-people { width: 100%; }
  .ch-op { justify-content: flex-start; }
  .cascade-prompt { align-items: flex-start; flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .change-row.is-moved-flash {
    animation: none;
    border-color: var(--color-primary-300);
    background: var(--brand-light);
    box-shadow: 0 0 0 3px rgba(63, 118, 103, 0.12);
  }

  .sort-btn {
    transition: none;
  }

  .change-row-list-move,
  .change-row-list-enter-active,
  .change-row-list-leave-active {
    transition: none;
  }
}
</style>

<style>
/* 我的待办聚焦跳转：目标任务行高亮（非 scoped，作用于 TaskRow 内部根元素） */
.task-row-focused {
  outline: 2px solid #288174;
  background: #ecf4f2 !important;
  box-shadow: 0 0 0 3px rgba(40, 129, 116, 0.15);
}

/* 从项目总览点项目名跳来：仅定位（不筛选）时的高亮 */
.project-bar-focused {
  outline: 2px solid #288174;
  border-radius: 8px;
  box-shadow: 0 0 0 3px rgba(40, 129, 116, 0.15);
}
</style>
