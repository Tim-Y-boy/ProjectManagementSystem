<script setup lang="ts">
import { computed, onActivated, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { dashboardApi, departmentsApi, usersApi } from '@/api';
import { useCategoriesStore } from '@/stores/categories';
import { useRefreshStore, type RefreshSnapshot } from '@/stores/refresh';
import { riskDays, completionDays } from '@/utils/task-risk';
import { deriveTaskRange } from '@/utils/task-dates';
import { taskManagementLocation } from '@/utils/task-navigation';
import UserAvatar from '@/components/UserAvatar.vue';
import ProjectRateChart from '@/components/ProjectRateChart.vue';

const router = useRouter();
const catsStore = useCategoriesStore();
const refreshStore = useRefreshStore();
const catMeta = (c: string) => catsStore.catMeta(c || '未分类');
const projects = ref<any[]>([]);
const depts = ref<any[]>([]);
const users = ref<any[]>([]);
const usersMap = computed(() => {
  const m = new Map<string, any>();
  for (const u of users.value) m.set(String(u.id), u);
  return m;
});
const loading = shallowRef(false);
const hasLoaded = shallowRef(false);
const seenRefreshVersions = shallowRef<RefreshSnapshot>(refreshStore.snapshot());

const boardMode = shallowRef<'dept' | 'category' | 'owner'>('dept');
const selectedGroup = ref('');
const groupFilterLabel = computed(() => boardMode.value === 'dept' ? '部门' : boardMode.value === 'category' ? '类别' : '负责人');
watch(boardMode, () => { selectedGroup.value = ''; });
const collapsedGroups = shallowRef<Set<string>>(new Set());
const expandedProjects = shallowRef<Set<number>>(new Set());
const expandedChildren = shallowRef<Set<string>>(new Set());

const deptName = (id: number | null) => depts.value.find((d) => String(d.id) === String(id))?.name || '未分配部门';

// 我的项目：后端 overview 已算好 mine（我担任项目负责人，或执行/验收其中任一任务），用于"我的项目优先"排序
const isMyProject = (p: any) => !!p.mine;

const COLORS: Record<string, string> = {
  green: '#288174',
  'green-late': '#288174',
  // 进行中 / 待验收：与品牌青同色（保持统一青色；状态由文字与呼吸灯区分）
  blue: '#288174',
  yellow: '#bd8433',
  red: '#b9555b',
  gray: '#cbd5e1',
  cancel: '#9aa3b2',
};

const STATUS_TEXT: Record<string, string> = {
  pending_confirm: '待确认',
  todo: '未开始',
  doing: '进行中',
  pending_accept: '待验收',
  done: '完成',
  rejected: '已退回',
  cancelled: '已取消',
};

interface NodeState {
  color: string;
  label: string;
  late?: boolean;
}

function riskState(node: any): NodeState {
  const d = riskDays(node.dueAt);
  const prefix = node.status === 'rejected' ? '已退回 · ' : '';
  if (node.dueAt && d != null) {
    if (d < 0) return { color: 'red', label: `${prefix}延期 ${-d} 天` };
    if (d <= 3) return { color: 'yellow', label: `${prefix}剩 ${d} 天` };
  }
  if (node.status === 'rejected') return { color: 'gray', label: '已退回' };
  if (node.status === 'doing') return { color: 'blue', label: '进行中' };
  if (node.status === 'pending_accept') return { color: 'blue', label: '待验收' };
  return { color: 'gray', label: '未开始' };
}

function nodeState(node: any): NodeState {
  const children = (node.children ?? []).filter((child: any) => child.status !== 'cancelled');
  if (node.status === 'cancelled') {
    return { color: 'cancel', label: '已取消' };
  }
  if (children.length) {
    if (children.every((c: any) => c.status === 'done')) {
      // 父级完成态：看子任务各自的完成状态（迟到的子任务，其合理补填要在父级也体现）
      let hasPlainLate = false;
      let hasSupplementLate = false;
      for (const c of children) {
        const st = nodeState(c);
        if (st.label === '延期完成') hasPlainLate = true;
        else if (st.label === '延期合理补填') hasSupplementLate = true;
      }
      // 还有未核实的迟到子任务 → 父级仍"延期完成"；全部迟到都已合理补填 → 父级降级为"延期合理补填"
      if (hasPlainLate) return { color: 'green-late', label: '延期完成', late: true };
      if (hasSupplementLate) return { color: 'green-late', label: '延期合理补填', late: false };
      return { color: 'green', label: '完成' };
    }
    // 阶段的截止日可能晚于已延期的子任务，风险必须先看子任务。
    const childStates = children.map((child: any) => child._state ?? nodeState(child));
    if (childStates.some((state: NodeState) => state.color === 'red')) return { color: 'red', label: '含延期子任务' };
    if (childStates.some((state: NodeState) => state.color === 'yellow')) return { color: 'yellow', label: '含临期子任务' };
    const anyStarted = children.some((c: any) => !['todo', 'pending_confirm', 'cancelled', 'rejected'].includes(c.status));
    if (!anyStarted) return { color: 'gray', label: '未开始' };
    return riskState(node);
  }
  if (node.status === 'done') {
    const days = completionDays(node);
    if (days != null && days > 0) return { color: 'green', label: `提前 ${days} 天完成` };
    const late = days != null && days < 0;
    if (!late) return { color: 'green', label: '完成' };
    return node.reasonableSupplement
      ? { color: 'green-late', label: '延期合理补填', late: false }
      : { color: 'green-late', label: '延期完成', late: true };
  }
  return riskState(node);
}

function annotate(node: any) {
  // 先递归子节点：父级派生日期（最早开始/最晚结束）需子节点就绪
  (node.children ?? []).forEach(annotate);
  if (node.children?.length) {
    const r = deriveTaskRange(node);
    node.dueAt = r.dueAt;
    node.startAt = r.startAt;
  }
  node._state = nodeState(node);
}

function isIgnoredNode(node: any) {
  return node.status === 'cancelled';
}

function leafNodes(nodes: any[]): any[] {
  const leaves: any[] = [];
  const walk = (items: any[]) => {
    for (const item of items ?? []) {
      if (isIgnoredNode(item)) continue;
      const children = (item.children ?? []).filter((child: any) => !isIgnoredNode(child));
      if (children.length) walk(children);
      else leaves.push(item);
    }
  };
  walk(nodes);
  return leaves;
}

function leafStats(nodes: any[]) {
  const leaves = leafNodes(nodes);
  const done = leaves.filter((n: any) => n.status === 'done').length;
  const overdue = leaves.filter((n: any) => n._state?.color === 'red').length;
  const atRisk = leaves.filter((n: any) => n._state?.color === 'yellow').length;
  return {
    total: leaves.length,
    done,
    overdue,
    atRisk,
    remaining: Math.max(leaves.length - done, 0),
    progress: leaves.length ? Math.round((done / leaves.length) * 100) : 0,
  };
}

function projectProgress(p: any): number {
  return leafStats(p.stages ?? []).progress;
}

function stageProgress(stage: any): number {
  return leafStats([stage]).progress;
}

function formatPlanDate(date?: string | null) {
  if (!date) return '未设置';
  const text = String(date);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}-${match[3]}`;
  return text.slice(0, 10);
}

function stageMeta(stage: any) {
  const children = stage.children ?? [];
  if (!children.length) return STATUS_TEXT[stage.status] || '未开始';
  return `${children.filter((c: any) => c.status === 'done').length}/${children.length} 个子任务完成`;
}

function projectRisk(p: any): number {
  let risk = 0;
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      if (n._state.color === 'red') risk = Math.max(risk, 2);
      else if (n._state.color === 'yellow') risk = Math.max(risk, 1);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(p.stages ?? []);
  return risk;
}

function projectActivity(p: any, progress: number, risk: number): number {
  if (risk === 2) return 0;
  if (risk === 1) return 1;
  if (progress === 100) return 4;
  const started = (p.stages ?? []).some((s: any) => {
    if (['doing', 'pending_accept', 'done'].includes(s.status)) return true;
    return (s.children ?? []).some((c: any) => ['doing', 'pending_accept', 'done'].includes(c.status));
  });
  return started ? 2 : 3;
}

function projectDoneStageCount(p: any) {
  return (p.stages ?? []).filter((s: any) => ['green', 'green-late'].includes(s._state.color)).length;
}

function projectLeafStats(p: any) {
  return leafStats(p.stages ?? []);
}

function groupHealth(projectsInGroup: any[]) {
  const summary = {
    total: 0,
    done: 0,
    overdue: 0,
    atRisk: 0,
    remaining: 0,
    progress: 0,
    overdueItems: [] as Array<{ projectName: string; title: string; dueAt?: string | null; label: string }>,
  };

  for (const project of projectsInGroup) {
    // 未定稿项目尚未开始执行，任务全为 0%，不计入部门完成率（仅作标记展示）
    if (project.planLocked === false) continue;
    const stats = projectLeafStats(project);
    summary.total += stats.total;
    summary.done += stats.done;
    summary.overdue += stats.overdue;
    summary.atRisk += stats.atRisk;
    summary.remaining += stats.remaining;

    const overdueLeaves = leafNodes(project.stages ?? [])
      .filter((task: any) => task.status !== 'done' && task._state?.color === 'red')
      .map((task: any) => ({
        projectName: project.name,
        title: task.title,
        dueAt: task.dueAt,
        label: task._state?.label || '延期',
      }));
    summary.overdueItems.push(...overdueLeaves);
  }

  summary.progress = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
  summary.overdueItems.sort((a, b) => String(a.dueAt || '').localeCompare(String(b.dueAt || '')));
  return summary;
}

function groupOverdueTitle(group: any) {
  const items = group.health?.overdueItems ?? [];
  if (!items.length) return '暂无延期任务';
  return items
    .map((item: any) => `${item.projectName} / ${item.title}（${item.label}）`)
    .join('\n');
}

function groupOverduePreview(group: any) {
  const items = group.health?.overdueItems ?? [];
  if (!items.length) return '暂无延期任务';
  const shown = items
    .slice(0, 3)
    .map((item: any) => `${item.title} ${item.label}`);
  return items.length > 3 ? `${shown.join('、')} 等 ${items.length} 项` : shown.join('、');
}

function criticalTask(p: any) {
  const leaves = leafNodes(p.stages ?? []).filter((n: any) => n.status !== 'done');
  return leaves.find((n: any) => n._state?.color === 'red')
    ?? leaves.find((n: any) => n._state?.color === 'yellow')
    ?? leaves.find((n: any) => n._state?.color === 'blue')
    ?? leaves[0]
    ?? null;
}

function projectFocusText(p: any) {
  const task = criticalTask(p);
  if (!task) return '暂无待处理任务';
  return `${task.title} · ${task._state?.label ?? '未开始'}`;
}

// 进行中态（含待验收）：多个阶段可并行，凡进行中的都标注 + 呼吸灯聚焦，不再只标"当前"一个
const isDoingState = (state: NodeState) => state.color === 'blue';

function stateClass(state: NodeState) {
  return `state-${state.color}`;
}

function projectProgressText(p: any) {
  const total = p.stages?.length ?? 0;
  if (!total) return '暂无父级任务';
  return `父级任务 ${projectDoneStageCount(p)}/${total}`;
}

function isGroupCollapsed(groupKey: string) {
  return collapsedGroups.value.has(groupKey);
}

function isProjectExpanded(projectId: number) {
  return expandedProjects.value.has(projectId);
}

function toggleSet<T>(source: Set<T>, key: T) {
  const next = new Set(source);
  next.has(key) ? next.delete(key) : next.add(key);
  return next;
}

function toggleGroup(groupKey: string) {
  collapsedGroups.value = toggleSet(collapsedGroups.value, groupKey);
}

function toggleProject(projectId: number) {
  expandedProjects.value = toggleSet(expandedProjects.value, projectId);
}

function childKey(projectId: number | string, childId: number | string) {
  return `${projectId}:${childId}`;
}

function isChildExpanded(projectId: number | string, childId: number | string) {
  return expandedChildren.value.has(childKey(projectId, childId));
}

function toggleChild(projectId: number | string, childId: number | string) {
  expandedChildren.value = toggleSet(expandedChildren.value, childKey(projectId, childId));
}

// 点击项目 → 直达「任务管理」：列表仍显示全部任务，只展开并滚动定位到该项目（不筛选）。
// 项目详情偏概览、用处不大；要看"这个项目具体在做什么"更常去任务管理。
function openProjectTasks(projectId: number | string) {
  router.push(taskManagementLocation(projectId));
}

// 点阶段卡片 / 子任务 / 孙任务 → 任务管理并定位到该任务（自动展开父级 + 滚动高亮）。
// 必须同时带上项目 id：任务管理页项目分组默认收起，只给 taskId 找不到任务行。
function openTaskInTasks(projectId: number | string, taskId: number | string) {
  router.push(taskManagementLocation(projectId, taskId));
}

// 统计条 → 跳项目列表并按对应维度筛选
function gotoProjects(riskFilter?: string) {
  router.push({ name: 'projects', query: riskFilter ? { riskFilter } : {} });
}

const boardGroups = computed(() => {
  const map = new Map<string, any>();
  for (const p of projects.value) {
    const category = p.category || '未分类';
    const meta = catMeta(category);
    const group = boardMode.value === 'category'
      ? {
          key: `category:${category}`,
          name: category,
          icon: meta.emoji,
          color: meta.color,
          sort: catsStore.list.findIndex((c: any) => c.name === category),
          projects: [] as any[],
        }
      : boardMode.value === 'owner'
        ? {
            key: `owner:${p.ownerId ?? 'none'}`,
            ownerId: p.ownerId ?? null,
            name: p.ownerId != null ? (usersMap.value.get(String(p.ownerId))?.name || '项目负责人') : '未指定负责人',
            avatarUrl: p.ownerId != null ? (usersMap.value.get(String(p.ownerId))?.avatarUrl || null) : null,
            color: '#288174',
            sort: 0,
            projects: [] as any[],
          }
        : {
            key: `dept:${p.deptId ?? 0}`,
            deptId: p.deptId ?? 0,
            name: deptName(p.deptId ?? 0),
            icon: '🏢',
            color: '#288174',
            headUserId: depts.value.find((d) => String(d.id) === String(p.deptId))?.headUserId ?? null,
            sort: 0,
            projects: [] as any[],
          };
    if (!map.has(group.key)) map.set(group.key, group);
    map.get(group.key).projects.push(p);
  }
  const groups = [...map.values()].map((g) => {
    g.projects.sort((a: any, b: any) => (a._rank - b._rank) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    g.priority = Math.min(...g.projects.map((p: any) => p._rank));
    g.overdue = g.projects.filter((p: any) => p._risk === 2).length;
    g.atRisk = g.projects.filter((p: any) => p._risk === 1).length;
    g.done = g.projects.filter((p: any) => p._progress === 100).length;
    g.health = groupHealth(g.projects);
    return g;
  });
  groups.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (boardMode.value === 'category' && a.sort !== b.sort) return (a.sort < 0 ? 999 : a.sort) - (b.sort < 0 ? 999 : b.sort);
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
  });
  // 按部门/负责人/类别分组：给每个大类分配不同颜色（色板轮换），类别用分类色，部门/负责人用色板区分
  const DEPT_PALETTE = ['#288174', '#3178c6', '#bd8433', '#7b6ca1', '#c2555b', '#2a9d8f'];
  if (boardMode.value === 'dept' || boardMode.value === 'owner') {
    groups.forEach((g, i) => {
      g.color = boardMode.value === 'owner' && g.ownerId == null
        ? '#8a94a6' // 未指定负责人：中性灰，避免与具体负责人撞色
        : DEPT_PALETTE[i % DEPT_PALETTE.length];
    });
  }
  return groups;
});

// 选项始终来自完整分组，避免选中后其他选项消失。
const groupFilterOptions = computed(() => boardGroups.value.map((group) => ({
  value: group.key,
  label: group.name,
})));
const visibleBoardGroups = computed(() => selectedGroup.value
  ? boardGroups.value.filter((group) => group.key === selectedGroup.value)
  : boardGroups.value);

// —— 完成率对比柱状图：固定展示全部项目（完成率降序 + 风险深浅），
//    与下方 部门/类别/负责人 分组卡片解耦，不随 boardMode 改变 ——
const rateRows = computed(() =>
  projects.value.map((p: any) => {
    const ownerId = p.ownerId != null ? String(p.ownerId) : null;
    const ownerName = ownerId ? usersMap.value.get(ownerId)?.name : '';
    return {
      id: p.id,
      name: p.name || '未命名项目',
      rate: p._progress || 0,
      // 0 延期 / 1 临期 / 2 进行中 / 3 未动工 / 4 已完成（与 projectActivity 同源）
      activity: p._activity ?? 0,
      locked: p.planLocked === false,
      owner: ownerName || '',
      dept: p.deptId != null ? deptName(p.deptId) : '',
      category: p.category || '',
    };
  }),
);

const totalCount = computed(() => projects.value.length);
const doneCount = computed(() => projects.value.filter((p: any) => p._progress === 100).length);
const atRiskCount = computed(() => projects.value.filter((p: any) => p._risk === 1).length);
const overdueCount = computed(() => projects.value.filter((p: any) => p._risk === 2).length);

async function load() {
  loading.value = true;
  try {
    const [projs, ds, us] = await Promise.all([dashboardApi.overview(), departmentsApi.list(), usersApi.list()]);
    depts.value = ds;
    users.value = us || [];
    projects.value = projs.map((p: any) => {
      (p.stages ?? []).forEach(annotate);
      const progress = projectProgress(p);
      const risk = projectRisk(p);
      const activity = projectActivity(p, progress, risk);
      const mine = isMyProject(p);
      // _rank：我的项目(0~4) 恒排在别人项目(10~14)之前，组内/组间都按它排
      return { ...p, _mine: mine, _progress: progress, _risk: risk, _activity: activity, _rank: (mine ? 0 : 10) + activity };
    });
    seenRefreshVersions.value = refreshStore.snapshot();
    hasLoaded.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  catsStore.load();
});

onActivated(() => {
  if (!hasLoaded.value) return;
  const shouldReloadCategories = refreshStore.isStale(seenRefreshVersions.value, ['category']);
  if (shouldReloadCategories) catsStore.load(true);
  if (refreshStore.isStale(seenRefreshVersions.value, ['project', 'task', 'category'])) load();
});
</script>

<template>
  <div class="dash-wrap">
    <div class="summary-bar">
      <div class="sum-item" @click="gotoProjects()"><span class="sum-num blue">{{ totalCount }}</span><span class="sum-label">项目总数</span></div>
      <div class="sum-divider"></div>
      <div class="sum-item" @click="gotoProjects('done')"><span class="sum-num green">{{ doneCount }}</span><span class="sum-label">已全部完成</span></div>
      <div class="sum-divider"></div>
      <div class="sum-item" @click="gotoProjects('atRisk')"><span class="sum-num orange">{{ atRiskCount }}</span><span class="sum-label">临期项目</span></div>
      <div class="sum-divider"></div>
      <div class="sum-item" @click="gotoProjects('overdue')"><span class="sum-num red">{{ overdueCount }}</span><span class="sum-label">延期项目</span></div>
      <div class="sum-spacer"></div>
      <div class="view-switch">
        <el-segmented
          v-model="boardMode"
          :options="[
            { label: '按部门', value: 'dept' },
            { label: '按类别', value: 'category' },
            { label: '按负责人', value: 'owner' },
          ]"
        />
        <el-select
          :key="boardMode"
          v-model="selectedGroup"
          class="group-filter"
          :placeholder="`全部${groupFilterLabel}`"
          :aria-label="`筛选${groupFilterLabel}`"
          filterable
          clearable
        >
          <el-option
            v-for="option in groupFilterOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
    </div>

    <ProjectRateChart v-if="rateRows.length" :rows="rateRows" @open="openProjectTasks" />

    <div v-loading="loading" class="dept-list">
      <el-empty v-if="!loading && !visibleBoardGroups.length" :description="selectedGroup ? '暂无符合筛选条件的项目' : '暂无进行中的项目'" />

      <section
        v-for="(g, groupIndex) in visibleBoardGroups"
        :key="g.key"
        class="dept-card"
        :class="boardMode === 'category' ? 'group-by-category' : 'group-by-dept'"
        :style="{ '--enter-index': String(groupIndex), '--group-accent': g.color }"
      >
        <button class="dept-head" type="button" :title="g.name" @click="toggleGroup(g.key)">
          <span class="fold-caret" :class="{ folded: isGroupCollapsed(g.key) }">▾</span>
          <span class="group-level">{{ boardMode === 'category' ? '类别' : boardMode === 'owner' ? '项目负责人' : '部门' }}</span>
          <span class="dept-name">
            <!-- 负责人视图：负责人头像为组图标；部门/类别：图标/emoji + 名称 -->
            <UserAvatar
              v-if="boardMode === 'owner'"
              :name="g.name"
              :avatar-url="g.avatarUrl"
              :size="26"
            />
            <span v-else class="group-icon" :style="{ color: g.color }">{{ g.icon }}</span>
            {{ g.name }}
          </span>
          <span class="dept-count">{{ g.projects.length }} 个项目</span>
          <span v-if="g.overdue" class="risk-badge rb-red">延期 {{ g.overdue }}</span>
          <span v-if="g.atRisk" class="risk-badge rb-orange">临期 {{ g.atRisk }}</span>
          <span v-if="g.done" class="risk-badge rb-green">完成 {{ g.done }}</span>
          <span class="dept-head-spacer"></span>
          <span v-if="boardMode !== 'category'" class="dept-health">
            <span class="health-rate">
              <strong>{{ g.health.progress }}%</strong>
              <em>完成率</em>
            </span>
          </span>
          <!-- 部门模式：第二行显示部门负责人（小头像+姓名） -->
          <span
            v-if="boardMode === 'dept' && g.headUserId"
            class="dept-owner"
          >
            <em class="do-label">部门负责人</em>
            <UserAvatar
              :name="usersMap.get(String(g.headUserId))?.name"
              :avatar-url="usersMap.get(String(g.headUserId))?.avatarUrl"
              :size="18"
              show-name
            />
          </span>
        </button>

        <Transition name="fold">
          <div v-show="!isGroupCollapsed(g.key)" class="dept-projects">
            <article
              v-for="(p, projectIndex) in g.projects"
              :key="p.id"
              class="project-card"
              :style="{ '--enter-index': String(projectIndex) }"
            >
              <div class="project-summary">
                <button
                  class="project-toggle"
                  type="button"
                  :aria-label="isProjectExpanded(p.id) ? '收起项目明细' : '展开项目明细'"
                  @click="toggleProject(p.id)"
                >
                  <span class="fold-caret" :class="{ folded: !isProjectExpanded(p.id) }">▾</span>
                </button>

                <div class="project-main">
                  <div class="project-title-line">
                    <span class="project-level">项目</span>
                    <button class="project-name" type="button" :title="p.name" @click="openProjectTasks(p.id)">
                      {{ p.name }}
                    </button>
                    <span v-if="p._risk === 2" class="risk-badge rb-red">延期</span>
                    <span v-else-if="p._risk === 1" class="risk-badge rb-orange">临期</span>
                    <span v-else-if="p._progress === 100" class="risk-badge rb-green">已完成</span>
                    <span v-if="p.planLocked === false" class="risk-badge rb-plan">未定稿</span>
                  </div>
                  <div class="project-brief-grid">
                    <div class="focus-card" :class="p._risk === 2 ? 'focus-danger' : p._risk === 1 ? 'focus-warning' : ''">
                      <span class="brief-label">关键剩余</span>
                      <span class="focus-text" :title="projectFocusText(p)">{{ projectFocusText(p) }}</span>
                    </div>
                  </div>

                  <div class="project-expanded-summary">
                    <div class="phase-strip" aria-label="项目阶段概览">
                      <span
                        v-for="s in p.stages"
                        :key="s.id"
                        class="phase-pill"
                        :class="[stateClass(s._state), { active: isDoingState(s._state) }]"
                        :style="{ '--stage-accent': COLORS[s._state.color], '--stage-progress': `${stageProgress(s)}%` }"
                        @click="toggleProject(p.id)"
                      >
                        <span class="phase-dot" :style="{ background: COLORS[s._state.color] }"></span>
                        <span class="phase-name" :title="s.title">{{ s.title }}</span>
                        <span class="phase-percent">{{ stageProgress(s) }}%</span>
                        <span class="phase-due" :class="{ missing: !s.dueAt }" :title="`预计完成 ${formatPlanDate(s.dueAt)}`">
                          预计完成 {{ formatPlanDate(s.dueAt) }}
                        </span>
                        <span class="phase-bar" aria-hidden="true">
                          <i :style="{ width: `${stageProgress(s)}%` }"></i>
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                <div class="project-progress">
                  <el-progress
                    :percentage="p._progress"
                    :stroke-width="10"
                    color="#288174"
                    style="width:180px"
                  />
                  <div class="project-risk-metrics">
                    <span :class="{ hot: projectLeafStats(p).overdue }">延期 {{ projectLeafStats(p).overdue }}</span>
                    <span :class="{ hot: projectLeafStats(p).atRisk }">临期 {{ projectLeafStats(p).atRisk }}</span>
                  </div>
                  <!-- 项目负责人：置右侧进度列下方空白（按负责人视图组头已显示则省略） -->
                  <div v-if="p.ownerId && boardMode !== 'owner'" class="project-owner-side">
                    <em class="po-label">项目负责人</em>
                    <UserAvatar
                      :name="usersMap.get(String(p.ownerId))?.name"
                      :avatar-url="usersMap.get(String(p.ownerId))?.avatarUrl"
                      :size="22"
                      show-name
                    />
                  </div>
                </div>
              </div>

              <Transition name="fold">
                <div v-show="isProjectExpanded(p.id)" class="stage-flow-wrap">
                  <div v-if="!p.stages?.length" class="empty-detail">暂无父级任务</div>

                  <div v-else class="stage-flow" role="list" aria-label="项目父级任务流程">
                    <template v-for="(s, stageIndex) in p.stages" :key="s.id">
                      <div
                        class="flow-stage"
                        role="listitem"
                        :style="{ '--enter-index': String(stageIndex) }"
                      >
                        <div
                          class="flow-node clickable"
                          :class="[stateClass(s._state), { 'is-doing': isDoingState(s._state) }]"
                          title="在任务管理中打开该阶段"
                          @click="openTaskInTasks(p.id, s.id)"
                        >
                          <div class="flow-node-main">
                            <span class="flow-title" :title="s.title">{{ s.title }}</span>
                            <span class="task-plan-date" :class="{ missing: !s.dueAt }" :title="`预计完成 ${formatPlanDate(s.dueAt)}`">预计完成 {{ formatPlanDate(s.dueAt) }}</span>
                          </div>
                          <div class="flow-node-meta">
                            <span class="state-pill" :class="[stateClass(s._state), { 'is-plain': isDoingState(s._state) }]">
                              {{ s._state.label }}<span v-if="s._state.late"> ⚠️</span>
                            </span>
                            <span class="stage-meta" :title="stageMeta(s)">{{ stageMeta(s) }}</span>
                          </div>
                          <div class="flow-progress">
                            <el-progress class="mini-progress" :percentage="stageProgress(s)" :stroke-width="7" :show-text="false" />
                            <span>{{ stageProgress(s) }}%</span>
                          </div>
                        </div>

                        <div class="flow-children">
                          <div v-if="!s.children?.length" class="empty-child">暂无子任务</div>
                          <div
                            v-for="(c, childIndex) in s.children"
                            :key="c.id"
                            class="flow-child clickable"
                            :class="{ 'is-doing': isDoingState(c._state) }"
                            :style="{ '--enter-index': String(childIndex) }"
                            title="在任务管理中打开该任务"
                            @click="openTaskInTasks(p.id, c.id)"
                          >
                            <button
                              v-if="c.children?.length"
                              class="grand-toggle"
                              type="button"
                              :aria-label="isChildExpanded(p.id, c.id) ? '收起孙任务' : '展开孙任务'"
                              @click.stop="toggleChild(p.id, c.id)"
                            >
                              <span class="fold-caret mini-caret" :class="{ folded: !isChildExpanded(p.id, c.id) }">▾</span>
                            </button>
                            <span v-else class="grand-spacer" aria-hidden="true"></span>
                            <span class="sub-dot" :style="{ background: COLORS[c._state.color] }"></span>
                            <span class="child-title" :title="c.title">{{ c.title }}</span>
                            <span class="child-state" :style="{ color: COLORS[c._state.color] }">
                              {{ c._state.label }}<span v-if="c._state.late"> ⚠️</span>
                            </span>
                            <span class="inline-plan-date child-plan-date" :class="{ missing: !c.dueAt }" :title="`预计完成 ${formatPlanDate(c.dueAt)}`">预计完成 {{ formatPlanDate(c.dueAt) }}</span>

                            <Transition v-if="c.children?.length" name="subfold">
                              <div v-show="isChildExpanded(p.id, c.id)" class="grandchild-list">
                                <div
                                  v-for="gc in c.children"
                                  :key="gc.id"
                                  class="grandchild-row clickable"
                                  :class="{ 'is-doing': isDoingState(gc._state) }"
                                  title="在任务管理中打开该任务"
                                  @click="openTaskInTasks(p.id, gc.id)"
                                >
                                  <span class="grand-dot" :style="{ background: COLORS[gc._state.color] }"></span>
                                  <span class="grand-title" :title="gc.title">{{ gc.title }}</span>
                                  <span class="grand-state" :style="{ color: COLORS[gc._state.color] }">
                                    {{ gc._state.label }}<span v-if="gc._state.late"> ⚠️</span>
                                  </span>
                                  <span class="inline-plan-date grand-plan-date" :class="{ missing: !gc.dueAt }" :title="`预计完成 ${formatPlanDate(gc.dueAt)}`">预计完成 {{ formatPlanDate(gc.dueAt) }}</span>
                                </div>
                              </div>
                            </Transition>
                          </div>
                        </div>
                      </div>

                      <div v-if="stageIndex < p.stages.length - 1" class="flow-connector" aria-hidden="true">
                        <span class="connector-line"></span>
                        <span class="connector-arrow">›</span>
                      </div>
                    </template>
                  </div>
                </div>
              </Transition>
            </article>
          </div>
        </Transition>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dash-wrap {
  --ink: var(--text-1);
  --ink-2: var(--text-2);
  --ink-3: var(--text-3);
  --line: #e9eef2;
  --soft: #f7faf9;
}

.summary-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  padding: 16px 22px;
  margin-bottom: 20px;
  border: 1px solid var(--color-border);
  border-radius: 22px;
  background: #ffffff;
  box-shadow: var(--shadow-sm);
  animation: dashboard-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  isolation: isolate;
  overflow: hidden;
}

.summary-bar::before {
  content: none;
}

.sum-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  margin: -4px -10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease;
}
.sum-item:hover { background: rgba(255, 255, 255, 0.62); }
.sum-item:active { transform: scale(0.97); }

.sum-num {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.sum-num.blue { color: var(--color-info); }
.sum-num.green { color: var(--color-success); }
.sum-num.orange { color: var(--color-warning); }
.sum-num.red { color: var(--color-danger); }

.sum-label {
  color: #65735f;
  font-size: 13px;
}

.sum-divider {
  width: 1px;
  height: 24px;
  background: #bfd8c7;
}

.sum-spacer {
  flex: 1;
}

.legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.view-switch {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 10px;
  border: 1px solid #e7edf2;
  border-radius: 999px;
  color: #237266;
  background: #f8fbf7;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.group-filter {
  width: 200px;
  max-width: 100%;
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #65735f;
  font-size: 12px;
}

.lg-warn {
  margin-left: 2px;
}

.dot,
.sub-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dept-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dept-card {
  position: relative;
  padding: 0;
  overflow: hidden;
  border: 1px solid #dbe6ea;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.06);
  animation: dashboard-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--enter-index, 0) * 70ms);
  transition:
    border-color var(--transition-base),
    box-shadow 240ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* 大类左侧贯穿色条：覆盖头部+内容区，作为「大类」视觉锚点且不断开 */
.dept-card::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  border-radius: 22px 0 0 22px;
  background: var(--group-accent, #288174);
  opacity: 0.65;
  pointer-events: none;
}

.dept-card:hover {
  border-color: #d8e8e2;
  box-shadow: 0 22px 50px rgba(15, 23, 42, 0.075);
  transform: translateY(-1px);
}

.dept-card:hover::after {
  animation: none;
}

.dept-head {
  position: relative;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-height: 66px;
  padding: 16px 24px;
  border: 0;
  border-bottom: 1px solid #eef3f4;
  background: #f7faf8;
  text-align: left;
  cursor: pointer;
}
.dept-head:hover {
  background: #f1f6f3;
}

/* 第二行：部门负责人（小头像+姓名） */
.dept-owner {
  flex: 1 0 100%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: -2px;
}
.dept-owner .do-label {
  font-style: normal;
  font-size: 11px;
  color: #98a2b3;
  margin-right: 2px;
}

.fold-caret {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  font-size: 14px;
  line-height: 1;
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    color var(--transition-fast),
    background var(--transition-fast);
}

.fold-caret.folded {
  transform: rotate(-90deg);
}

.dept-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--ink);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.group-level,
.project-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  white-space: nowrap;
}

.group-level {
  height: 24px;
  padding: 0 8px;
  border: 1px solid #d9f7e8;
  border-radius: 999px;
  color: var(--brand-hover);
  background: #eef5f1;
  font-size: 12px;
  font-weight: 900;
}

.group-icon {
  display: inline-flex;
  width: 22px;
  align-items: center;
  justify-content: center;
  margin-right: 2px;
}

.dept-count {
  color: var(--ink-3);
  font-size: 12px;
}

.dept-head-spacer {
  flex: 1;
  min-width: 12px;
}

.dept-health {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
  color: #65735f;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.health-rate {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 5px 9px;
  border: 1px solid #d4e6e3;
  border-radius: 999px;
  background: #fff;
  color: var(--brand-hover);
}

.health-rate strong {
  color: var(--brand);
  font-size: 16px;
  line-height: 1;
}

.health-rate em {
  font-style: normal;
  color: #65735f;
}

.health-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #65735f;
}

.health-stat.danger {
  color: var(--color-danger);
}

.health-stat.warning {
  color: var(--color-warning);
}

.health-late-list {
  max-width: min(30vw, 420px);
  overflow: hidden;
  color: var(--color-danger);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-late-list.empty {
  color: var(--color-success);
}

.risk-badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  line-height: 18px;
}

.rb-red {
  border: 1px solid #ffd5d8;
  color: #e5484d;
  background: #fff1f2;
}

.rb-orange {
  border: 1px solid #ffe4b5;
  color: #d88a06;
  background: #fff8e8;
}

.rb-green {
  border: 1px solid #c9f6d8;
  color: #288174;
  background: #f0fdf4;
}

.rb-plan {
  border: 1px solid #ffe4b5;
  color: #d88a06;
  background: #fff8e8;
}

.dept-projects {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 30px 38px 34px;
  background: #fbfcfb;
}

.project-card {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 18px rgba(15, 23, 42, 0.06);
  animation: detail-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--enter-index, 0) * 45ms);
  transition:
    border-color var(--transition-base),
    box-shadow var(--transition-base),
    transform var(--transition-base);
  overflow: visible;
}

.project-card:hover {
  border-color: var(--color-primary-200);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 12px 26px rgba(15, 23, 42, 0.10);
  transform: translateY(-1px);
}

.project-summary {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
  padding: 20px 18px 22px 16px;
  transition: background var(--transition-base);
}

.project-card:hover .project-summary {
  border-radius: 18px;
  background: #fff;
}

.project-toggle {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #e6edf0;
  border-radius: 11px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.project-toggle:hover {
  border-color: #cfeee6;
  background: var(--brand-light);
  box-shadow: 0 8px 18px rgba(63, 118, 103, 0.12);
  transform: translateY(-1px);
}

.project-toggle:active {
  transform: translateY(0) scale(0.96);
}

.project-main {
  min-width: 0;
}

.project-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project-level {
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  color: var(--brand-hover);
  background: #eef5f1;
  font-size: 11px;
  font-weight: 900;
}

.project-name {
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  color: var(--ink);
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  font-weight: 800;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-name:hover {
  color: var(--brand);
}

.project-brief-grid {
  display: grid;
  grid-template-columns: minmax(260px, 700px);
  gap: 8px;
  margin-top: 8px;
}

.project-owner-side {
  flex-basis: 100%;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.project-owner-side .po-label {
  font-style: normal;
  font-size: 12px;
  color: #98a2b3;
  margin-right: 2px;
}

.project-expanded-summary {
  margin-top: 16px;
}

.focus-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #fbfdfc;
}

.focus-card {
  background: rgba(255, 255, 255, 0.78);
}

.focus-card.focus-warning {
  border-color: #ffe4b5;
  background: #fffbf1;
}

.focus-card.focus-danger {
  border-color: #ffd5d8;
  background: #fff7f8;
}

.brief-label {
  color: var(--brand-hover);
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.brief-stage,
.focus-text {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brief-progress {
  color: var(--color-info);
  font-size: 13px;
  font-weight: 900;
}

.phase-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: stretch;
  gap: 10px;
  margin-top: 0;
}

.phase-pill {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  row-gap: 5px;
  column-gap: 7px;
  min-height: 68px;
  max-width: none;
  padding: 10px 12px 20px;
  border: 1px solid #e9eef2;
  border-radius: 14px;
  color: #64748b;
  background: #fbfcfd;
  font-size: 13px;
  font-weight: 800;
  box-shadow: none;
  cursor: pointer;
  transition:
    border-color var(--transition-base),
    box-shadow var(--transition-base),
    background var(--transition-base),
    transform var(--transition-base);
}

.phase-pill:hover {
  border-color: var(--color-primary-200);
  background: #fff;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  transform: translateY(-2px);
}

.phase-pill.active {
  border-color: var(--stage-accent, var(--color-primary-500));
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.10);
  transform: translateY(-1px);
}

.phase-pill.active .phase-name {
  color: var(--text-1);
  font-weight: 700;
}

.phase-pill.active::after {
  content: '进行中';
  position: absolute;
  top: -7px;
  right: 10px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--stage-accent, var(--color-primary-500));
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}

.phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.phase-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phase-percent {
  color: currentColor;
  font-size: 13px;
  font-weight: 900;
}

.phase-due {
  grid-column: 2 / 4;
  min-width: 0;
  overflow: hidden;
  color: rgba(71, 85, 105, 0.82);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phase-due.missing {
  color: #94a3b8;
}

.phase-bar {
  position: absolute;
  right: 12px;
  bottom: 9px;
  left: 12px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
}

.phase-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--stage-accent, currentColor);
  opacity: 0.72;
  transition: width 260ms var(--ease-out);
}

.dash-wrap :deep(.el-progress-bar__outer) {
  background-color: #edf2f7;
}

.dash-wrap :deep(.el-progress-bar__inner) {
  position: relative;
  overflow: hidden;
  box-shadow: none;
}

.dash-wrap :deep(.el-progress-bar__inner)::after {
  content: none;
}

.project-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
  flex-basis: 196px;
  width: 196px;
  padding-top: 4px;
}

.project-risk-metrics {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 800;
}

.project-risk-metrics .hot {
  color: var(--color-danger);
}

.stage-flow-wrap {
  padding: 2px 16px 18px 52px;
  overflow: hidden;
}

.stage-flow {
  display: flex;
  flex-flow: row nowrap;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 188px;
  box-sizing: border-box;
  padding: 8px 22px 12px 4px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scroll-padding-left: 16px;
  scrollbar-gutter: stable;
}

.stage-flow::-webkit-scrollbar {
  height: 8px;
}

.stage-flow::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #d4e4df;
}

.stage-flow::-webkit-scrollbar-track {
  border-radius: 999px;
  background: #f4f8f7;
}

.flow-stage {
  position: relative;
  flex: 0 0 264px;
  max-width: 264px;
  min-width: 0;
  animation: detail-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--enter-index, 0) * 58ms);
}

.flow-node {
  position: relative;
  min-height: 92px;
  padding: 12px 12px 10px;
  overflow: hidden;
  border: 1px solid #e9eef2;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.045);
  transition:
    border-color var(--transition-base),
    box-shadow 240ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.flow-node::before {
  content: none;
}

.flow-node:hover {
  border-color: #dce8e4;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.flow-node-main,
.flow-node-meta,
.flow-progress {
  position: relative;
  z-index: 1;
}

.flow-node-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.level-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--brand-hover);
  background: #eef5f1;
  font-size: 11px;
  font-weight: 900;
}

.flow-title,
.child-title {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-title {
  font-size: 15px;
  font-weight: 900;
}

.task-plan-date {
  justify-self: end;
  color: rgba(71, 85, 105, 0.78);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.task-plan-date.missing,
.inline-plan-date.missing {
  color: #94a3b8;
}

.flow-node-meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.stage-meta {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.flow-progress {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 8px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.mini-progress {
  flex: 0 0 92px;
  width: 92px;
  min-width: 92px;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

/* 进行中的状态胶囊：只去掉绿色胶囊底（保留"进行中"文字与状态点） */
.state-pill.is-plain {
  padding: 0;
  background: transparent;
}

.state-pill::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent);
  content: "";
}

.state-green,
.state-green-late {
  color: #288174;
  background: #e6f3ef;
}

.state-blue {
  color: #1e6258;
  background: #ddefec;
}

.state-yellow {
  color: #d88a06;
  background: #fff8e8;
}

.state-red {
  color: #e5484d;
  background: #fff1f2;
}

.state-gray {
  color: #94a3b8;
  background: #f1f5f9;
}

.state-cancel {
  color: #94a3b8;
  background: #f1f5f9;
  text-decoration: line-through;
}

.flow-connector {
  flex: 0 0 50px;
  position: relative;
  display: block;
  margin-top: 42px;
  padding: 0 7px;
  height: 18px;
}

.connector-line {
  position: absolute;
  top: 50%;
  left: 7px;
  right: 16px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: #dce8e4;
  transform: translateY(-50%);
}

.connector-line::after {
  content: none;
}

.connector-arrow {
  position: absolute;
  top: 50%;
  right: 5px;
  width: 10px;
  height: 10px;
  border-top: 3px solid #b8c8c3;
  border-right: 3px solid #b8c8c3;
  color: transparent;
  font-size: 0;
  line-height: 0;
  transform: translateY(-50%) rotate(45deg);
}

.flow-children {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding-left: 13px;
}

.flow-children::before {
  position: absolute;
  top: -7px;
  bottom: 14px;
  left: 6px;
  width: 1px;
  background: #d8e7e3;
  content: "";
}

.flow-child {
  position: relative;
  display: grid;
  grid-template-columns: 18px 8px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 6px;
  row-gap: 2px;
  min-height: 28px;
  padding: 5px 7px;
  border: 1px solid #edf2f4;
  border-radius: 12px;
  background: #fff;
  box-shadow: none;
  animation: detail-rise 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc((var(--enter-index, 0) * 28ms) + 120ms);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.flow-child:hover {
  border-color: #dfe8eb;
  background: #fbfdfd;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.045);
  transform: translateX(2px);
}

.child-branch {
  visibility: hidden;
  width: 16px;
  height: 1px;
  background: #d8e7e3;
}

.grand-toggle,
.grand-spacer {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--brand);
  background: transparent;
}

.grand-toggle {
  cursor: pointer;
  /* 展开/收起孙任务：做成看得见的小按钮（原来只是个很淡的三角，几乎找不到） */
  color: var(--color-primary-700);
  background: #f1f5f2;
  border: 1px solid #dbe5e0;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
}

.grand-toggle:hover {
  color: var(--brand);
  background: var(--brand-light);
  border-color: var(--color-primary-300);
  transform: translateY(-1px);
}

.grand-toggle .mini-caret {
  color: inherit;
}

.mini-caret {
  width: 14px;
  height: 14px;
  font-size: 12px;
  font-weight: 700;
  transition: transform var(--transition-fast);
}

.flow-child .sub-dot {
  width: 8px;
  height: 8px;
}

.flow-child .child-title {
  grid-column: 3 / 4;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.child-state {
  grid-column: 3 / 4;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.25;
  white-space: nowrap;
}

.inline-plan-date {
  overflow: hidden;
  color: rgba(71, 85, 105, 0.72);
  font-size: 10.5px;
  font-weight: 700;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.child-plan-date {
  grid-column: 4 / 5;
  grid-row: 1 / span 2;
  align-self: center;
  justify-self: end;
  max-width: 118px;
}

.grandchild-list {
  position: relative;
  grid-column: 3 / -1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 5px;
  padding: 6px 0 2px 16px;
}

.grandchild-list::before {
  position: absolute;
  top: 0;
  bottom: 6px;
  left: 6px;
  width: 1px;
  background: #d8e7e3;
  content: "";
}

.grandchild-row {
  display: grid;
  grid-template-columns: 7px minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  padding: 3px 5px;
  border-radius: 7px;
  background: #f8fbfa;
}

.grand-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

/* 进行中：整张/整行卡片外框用青色线 + 呼吸灯（光晕由弱到强再收）——
   把视线聚焦到"正在做"的任务上，已完成/未开始不加动效 */
@keyframes card-breathe {
  0% {
    box-shadow:
      0 0 0 1px rgba(40, 129, 116, 0.22),
      0 6px 16px rgba(40, 129, 116, 0.08);
  }
  50% {
    box-shadow:
      0 0 0 3px rgba(40, 129, 116, 0.16),
      0 10px 22px rgba(40, 129, 116, 0.16);
  }
  100% {
    box-shadow:
      0 0 0 1px rgba(40, 129, 116, 0.22),
      0 6px 16px rgba(40, 129, 116, 0.08);
  }
}

.flow-node.is-doing,
.flow-child.is-doing,
.grandchild-row.is-doing {
  border-color: var(--color-primary-500);
  animation: card-breathe 2.4s ease-in-out infinite;
}

/* 展开后的第一层（阶段卡片）进行中：底色透明，只留青框 + 呼吸 */
.flow-node.is-doing {
  background: transparent;
}

/* 展开后可点击：阶段卡片 / 子任务 / 孙任务 → 任务管理并定位到该任务 */
.clickable {
  cursor: pointer;
}
.flow-node.clickable:hover {
  border-color: var(--color-primary-400);
}
.grandchild-row.clickable:hover {
  background: #eef5f2;
}

@media (prefers-reduced-motion: reduce) {
  .flow-node.is-doing,
  .flow-child.is-doing,
  .grandchild-row.is-doing {
    animation: none;
  }
}

.grand-title {
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grand-state {
  grid-column: 2 / 3;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.2;
}

.grand-plan-date {
  grid-column: 3 / 4;
  grid-row: 1 / span 2;
  align-self: center;
  justify-self: end;
  max-width: 112px;
}

.empty-detail,
.empty-child {
  padding: 12px;
  border: 1px dashed #dce8e4;
  border-radius: 10px;
  color: var(--ink-3);
  background: #fff;
  font-size: 12px;
}

.empty-child {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.72);
}

.fold-enter-active,
.fold-leave-active {
  transition:
    opacity 220ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    filter 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.fold-enter-from,
.fold-leave-to {
  opacity: 0;
  filter: blur(3px);
  transform: translateY(-6px) scale(0.992);
}

.subfold-enter-active,
.subfold-leave-active {
  transition:
    opacity 180ms ease,
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.subfold-enter-from,
.subfold-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes dashboard-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes detail-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes sheen-sweep {
  0% {
    opacity: 0;
    transform: translateX(-80%);
  }

  24% {
    opacity: 0.75;
  }

  100% {
    opacity: 0;
    transform: translateX(90%);
  }
}

@keyframes progress-sheen {
  0%,
  55% {
    transform: translateX(-120%);
  }

  100% {
    transform: translateX(120%);
  }
}

@keyframes connector-flow {
  0%,
  45% {
    transform: translateX(-110%);
  }

  100% {
    transform: translateX(110%);
  }
}

@media (max-width: 1180px) {
  .dept-head {
    flex-wrap: wrap;
  }

  .dept-head-spacer {
    flex-basis: 100%;
    height: 0;
  }

  .dept-health {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .health-late-list {
    max-width: 100%;
  }

  .project-summary {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .project-progress {
    grid-column: 2 / -1;
    justify-content: flex-start;
    min-width: 0;
  }

  .project-risk-metrics {
    text-align: left;
    justify-content: flex-start;
  }

  .project-brief-grid {
    grid-template-columns: 1fr;
  }

  .flow-stage {
    flex-basis: 260px;
  }
}

@media (max-width: 760px) {
  .summary-bar {
    gap: 12px;
  }

  .sum-divider {
    display: none;
  }

  .dept-projects {
    padding: 12px;
  }

  .project-summary {
    padding: 12px;
  }

  .project-brief-grid {
    gap: 8px;
  }

  .focus-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .brief-progress {
    grid-column: 2 / -1;
  }

  .phase-strip {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .phase-pill {
    flex: 0 0 188px;
    min-height: 70px;
  }

  .stage-flow-wrap {
    padding-left: 14px;
    padding-right: 12px;
  }

  .flow-stage {
    flex-basis: 236px;
  }

  .flow-connector {
    flex-basis: 46px;
    margin-top: 52px;
    padding: 0 6px;
  }

  .flow-child {
    grid-template-columns: 18px 8px minmax(0, 1fr) auto;
  }

  .child-branch {
    display: none;
  }

  .flow-child .child-title,
  .child-state {
    grid-column: 3 / 4;
  }

  .child-plan-date {
    grid-column: 4 / 5;
  }

  .flow-node-main {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .task-plan-date {
    grid-column: 2 / -1;
    justify-self: start;
  }

  .inline-plan-date {
    max-width: 108px;
  }

  .grandchild-list {
    grid-column: 1 / -1;
    padding-left: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .summary-bar,
  .dept-card,
  .project-card,
  .flow-stage,
  .flow-child,
  .grandchild-row {
    animation: none;
  }

  .fold-caret,
  .fold-enter-active,
  .fold-leave-active,
  .dept-card,
  .project-card,
  .flow-node,
  .flow-child,
  .project-toggle,
  .grand-toggle,
  .subfold-enter-active,
  .subfold-leave-active {
    transition: none;
  }

  .dept-card:hover,
  .project-card:hover,
  .flow-node:hover,
  .flow-child:hover,
  .project-toggle:hover,
  .grand-toggle:hover {
    transform: none;
  }

  .dept-card:hover::after,
  .dash-wrap :deep(.el-progress-bar__inner)::after,
  .connector-line::after {
    animation: none;
  }
}
</style>
