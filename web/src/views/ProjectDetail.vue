<script setup lang="ts">
import { assetProgressIds } from '@/utils/task-assets';
import { ref, computed, onActivated, onMounted, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { projectsApi, usersApi, tasksApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore, type RefreshSnapshot } from '@/stores/refresh';
import { useCategoriesStore } from '@/stores/categories';
import { ElMessage, ElMessageBox } from 'element-plus';
import { deriveTaskRange } from '@/utils/task-dates';
import { taskManagementLocation } from '@/utils/task-navigation';
import { Refresh, ArrowLeft, Edit } from '@element-plus/icons-vue';
import { assetFileName, assetSourceLabel, isAssetPreviewable, normalizePreviewBlob } from '@/utils/task-assets';
import { toNullableNumericId, toNumericId } from '@/utils/ids';
import UserSelect from '@/components/UserSelect.vue';
import { projectOwnerIds, isOwnerOf, ownerLabel, canApplyProjectClosure } from '@/utils/project-owner';
import SmartSelect from '@/components/SmartSelect.vue';
import DatePick from '@/components/DatePick.vue';
import TaskCompletionTag from '@/components/TaskCompletionTag.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const refreshStore = useRefreshStore();
const catsStore = useCategoriesStore();
const catItems = computed(() =>
  catsStore.list.map((c: any) => ({ value: c.name, label: `${c.emoji || ''} ${c.name}`.trim() })),
);

const projectId = Number(route.params.id);
const project = ref<any>(null);
const users = ref<any[]>([]);
const projectLogs = ref<any[]>([]);
const processData = ref<any>({ updates: [], assets: [] });
const loading = ref(false);
const hasLoaded = shallowRef(false);
const seenRefreshVersions = shallowRef<RefreshSnapshot>(refreshStore.snapshot());
const selectedProcessTaskId = ref<number | null>(null);
const roleCanViewOperationLogs = computed(() => auth.has('admin') || auth.has('leader') || auth.has('dept_head'));
const canViewProjectLogs = computed(() => roleCanViewOperationLogs.value || project.value?.status === 'archived');

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
const userName = (id: number | null) => users.value.find((u) => String(u.id) === String(id))?.name || '—';

// 任务树（只读展示）
const flatTaskRows = ref<any[]>([]);
function flattenTasks(nodes: any[], depth = 0): any[] {
  const rows: any[] = [];
  for (const t of nodes) {
    rows.push({ ...t, depth, hasChildren: (t.children || []).length > 0 });
    if (t.children?.length) rows.push(...flattenTasks(t.children, depth + 1));
  }
  return rows;
}

async function load() {
  loading.value = true;
  catsStore.load();
  try {
    const [proj, usrs, process] = await Promise.all([
      projectsApi.one(projectId),
      usersApi.list(),
      projectsApi.process(projectId),
    ]);
    project.value = proj;
    users.value = usrs;
    processData.value = process;
    projectLogs.value = (roleCanViewOperationLogs.value || proj.status === 'archived')
      ? await projectsApi.logs(projectId)
      : [];
    const rows = flattenTasks(proj.tasks || []);
    flatTaskRows.value = rows;
    if (!selectedProcessTaskId.value || !rows.some((row) => String(row.id) === String(selectedProcessTaskId.value))) {
      selectedProcessTaskId.value = toNullableNumericId((rows.find((row) => !row.hasChildren) || rows[0])?.id);
    }
    seenRefreshVersions.value = refreshStore.snapshot();
    hasLoaded.value = true;
  } finally {
    loading.value = false;
  }
}

// 项目统计
const totalTasks = computed(() => flatTaskRows.value.length);
const doneTasks = computed(
  () => flatTaskRows.value.filter((t) => t.status === 'done').length,
);
const doingTasks = computed(
  () => flatTaskRows.value.filter((t) => t.status === 'doing' || t.status === 'pending_accept').length,
);
const keyProgressRows = computed(() => processData.value?.updates || []);
const processAssetRows = computed(() => processData.value?.assets || []);
const taskProcessMap = computed(() => {
  const map = new Map<string, { updates: any[]; assets: any[] }>();
  const ensure = (taskId: any) => {
    const key = String(taskId);
    if (!map.has(key)) map.set(key, { updates: [], assets: [] });
    return map.get(key)!;
  };
  for (const update of keyProgressRows.value) {
    if (update.taskId == null) continue;
    ensure(update.taskId).updates.push(update);
  }
  for (const asset of processAssetRows.value) {
    if (asset.taskId == null) continue;
    ensure(asset.taskId).assets.push(asset);
  }
  return map;
});
const selectedProcessTask = computed(() =>
  flatTaskRows.value.find((task) => String(task.id) === String(selectedProcessTaskId.value)) || null,
);
const selectedTaskProcess = computed(() =>
  selectedProcessTask.value
    ? taskProcessMap.value.get(String(selectedProcessTask.value.id)) || { updates: [], assets: [] }
    : { updates: [], assets: [] },
);
const selectedTaskTimeline = computed(() => {
  const groups: Array<{ key: string; date: string; updates: any[]; unlinkedAssets: any[] }> = [];
  const byDate = new Map<string, { key: string; date: string; updates: any[]; unlinkedAssets: any[] }>();
  const updates = [...selectedTaskProcess.value.updates].sort((a, b) =>
    String(a.workDate || '').localeCompare(String(b.workDate || '')) ||
    new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );

  for (const update of updates) {
    const date = update.workDate || '未填写日期';
    if (!byDate.has(date)) {
      const group = { key: date, date, updates: [], unlinkedAssets: [] };
      byDate.set(date, group);
      groups.push(group);
    }
    byDate.get(date)!.updates.push(update);
  }

  const linkedAssetIds = new Set<number>();
  for (const update of updates) {
    for (const asset of update.assets || []) linkedAssetIds.add(Number(asset.id));
  }
  const unlinkedAssets = selectedTaskProcess.value.assets.filter((asset) =>
    !assetProgressIds(asset).length && !linkedAssetIds.has(Number(asset.id)),
  );
  if (unlinkedAssets.length) {
    groups.push({ key: '__unlinked__', date: '未关联进展', updates: [], unlinkedAssets });
  }
  return groups;
});
function taskProcessStats(taskId: number) {
  const data = taskProcessMap.value.get(String(taskId));
  return {
    updateCount: data?.updates.length || 0,
    assetCount: data?.assets.length || 0,
  };
}
function selectTaskProcess(task: any) {
  selectedProcessTaskId.value = toNumericId(task.id);
}
// 项目总进度：所有顶层任务进度的平均（子任务已计入父任务）
const projectProgress = computed(() => {
  const roots = flatTaskRows.value.filter((t) => t.depth === 0);
  if (!roots.length) return 0;
  return Math.round((roots.reduce((s, t) => s + (t.progress || 0), 0) / roots.length) * 100);
});

// 编辑项目
const projEditVisible = ref(false);
const projForm = ref({ name: '', description: '', startAt: '', endAt: '', ownerIds: [] as number[] });
function openProjEdit() {
  projForm.value = {
    name: project.value.name,
    description: project.value.description || '',
    startAt: project.value.startAt || '',
    endAt: project.value.endAt || '',
    ownerIds: projectOwnerIds(project.value),
  };
  projEditVisible.value = true;
}
async function saveProjEdit() {
  if (!projForm.value.name.trim()) {
    ElMessage.warning('请输入项目名称');
    return;
  }
  await projectsApi.update(projectId, projForm.value);
  refreshStore.markProjectChanged();
  ElMessage.success('项目已更新');
  projEditVisible.value = false;
  await load();
}

// 可管理该项目（编辑/定稿）：admin/leader，或部门负责人且项目属于我可管理部门，或我是项目任一负责人
const isFrozen = computed(() => project.value?.status === 'archived' || ['pending', 'closed'].includes(project.value?.closureState));
const canWriteProject = computed(() => !isFrozen.value && (
  auth.has('admin') ||
  auth.has('leader') ||
  (auth.has('dept_head') &&
    (String(project.value?.deptId) === String(auth.user?.deptId) ||
      auth.managedDeptIds.includes(Number(project.value?.deptId)))) ||
  isOwnerOf(project.value, auth.user?.id)),
);
// 与项目列表共用结项条件：已定稿、全部有效任务完成、当前用户为负责人或管理员。
const canArchiveProject = computed(() =>
  canApplyProjectClosure({ ...project.value, taskCount: totalTasks.value, doneCount: doneTasks.value }, auth.user?.id, auth.has('admin')),
);
const isProjectComplete = computed(() => totalTasks.value === doneTasks.value);
// 计划定稿：可管理 或 我是项目负责人；解除定稿：仅管理员
// 已定稿时非 admin 隐藏「解除定稿」按钮（后端同样仅 admin 可解除）
const canLockPlan = computed(() => {
  if (isFrozen.value) return false;
  const isAdmin = auth.has('admin');
  if (project.value?.planLocked) return isAdmin; // 已定稿 → 只有 admin 能解除
  return canWriteProject.value || isOwnerOf(project.value, auth.user?.id);
});
async function togglePlanLock() {
  const locking = !project.value.planLocked;
  if (locking) {
    await ElMessageBox.confirm(
      '定稿后项目进入可执行状态，但计划将被锁定：新增/删除任务、改日期、改执行人/负责人等调整，均须通过「计划变更审核」。是否确认定稿？',
      '计划定稿',
      { type: 'warning', confirmButtonText: '确认定稿', cancelButtonText: '取消' },
    );
  } else {
    await ElMessageBox.confirm(
      '解除定稿后，任务将不可开始执行，计划字段可自由修改（仅管理员可解除）。是否解除？',
      '解除定稿',
      { type: 'info', confirmButtonText: '解除定稿', cancelButtonText: '取消' },
    );
  }
  await projectsApi.setPlanLocked(projectId, !project.value.planLocked);
  refreshStore.markProjectPlanChanged();
  ElMessage.success(project.value.planLocked ? '已解除定稿' : '计划已定稿，改动将需申请审批');
  await load();
}

// 保存为模板（结构反哺模板库）：导出项目任务树为模板骨架
const saveTplVisible = ref(false);
const saveTplSaving = ref(false);
const tplForm = ref({ name: '', category: '未分类', description: '' });
// 与后端 saveProjectAsTemplate 的 daysBetween / max(1,·) 算法保持一致，所见即所存
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function previewDuration(t: any): number | null {
  const d = daysBetween(t.startAt ?? null, t.dueAt ?? null);
  return d == null ? null : Math.max(1, d);
}
// 预览用 project.tasks（getProject 已排除取消任务），口径与后端一致：阶段数=顶层数，任务数=全部节点
const templatePreview = computed(() => {
  const roots = project.value?.tasks ?? [];
  const flat = flattenTasks(roots);
  return { flat, stageCount: roots.length, taskCount: flat.length };
});
function openSaveTpl() {
  tplForm.value = {
    name: project.value.name || '',
    category: project.value.category || '未分类',
    description: project.value.description || '',
  };
  saveTplVisible.value = true;
}
async function saveTemplate() {
  if (!tplForm.value.name.trim()) {
    ElMessage.warning('请输入模板名称');
    return;
  }
  if (!templatePreview.value.flat.length) {
    ElMessage.warning('项目无可导出的任务');
    return;
  }
  saveTplSaving.value = true;
  try {
    const res = await projectsApi.saveAsTemplate(projectId, {
      name: tplForm.value.name.trim(),
      category: tplForm.value.category,
      description: tplForm.value.description.trim() || null,
    });
    saveTplVisible.value = false;
    ElMessage.success(`已保存模板「${res.name}」，共 ${res.stageCount} 个阶段、${res.taskCount} 个任务`);
  } catch (e: any) {
    if (!e?.messageShown) ElMessage.error(e?.message || '保存失败');
  } finally {
    saveTplSaving.value = false;
  }
}

// 归档 / 恢复 / 删除
async function archive() {
  router.push({ name: 'closures', query: { projectId: String(projectId) } });
}
async function unarchive() {
  try {
    await projectsApi.unarchive(projectId);
    refreshStore.markProjectChanged();
    ElMessage.success('项目已恢复');
    await load();
  } catch (e: any) {
    if (!e?.messageShown) ElMessage.error(e?.message || '恢复失败');
  }
}
async function remove() {
  await ElMessageBox.confirm(`确定删除项目「${project.value.name}」？其下所有任务将一并删除，不可恢复。`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });
  await projectsApi.remove(projectId);
  refreshStore.markProjectChanged();
  ElMessage.success('项目已删除');
  router.replace('/projects');
}

// 任务详情弹窗（只读查看）
const detailVisible = ref(false);
const detail = ref<any>(null);
// 详情日期：父任务取子任务派生值
const detailRange = computed(() => deriveTaskRange(detail.value));
const detailLoading = ref(false);
const ACTION_LABEL: Record<string, string> = {
  create: '创建任务', update: '更新任务', transition: '状态流转', reassign: '改派',
  accept: '验收通过', reject: '退回', archive: '归档', delete: '删除任务', plan_change: '计划变更',
  auto_rollup: '父级汇总', daily_update: '关键进展', daily_update_edit: '编辑关键进展', daily_update_delete: '删除关键进展', daily_update_exempt: '确认合理补填',
  task_asset: '过程资料', task_asset_delete: '删除资料',
};
const actionLabel = (a: string) => ACTION_LABEL[a] || a;
function formatTime(d: string) {
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
async function openTaskDetail(task: any) {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    detail.value = await tasksApi.one(task.id);
  } finally {
    detailLoading.value = false;
  }
}

function openAsset(asset: any) {
  if (asset.url) {
    window.open(asset.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (isAssetPreviewable(asset)) previewAsset(asset);
  else downloadAsset(asset);
}

function backToProjects() {
  const from = String(route.query.from || '');
  if (from === 'dashboard') {
    router.push('/dashboard');
    return;
  }
  if (from === 'archived-projects') {
    router.push({path:'/projects',query:{view:'closed'}});
    return;
  }
  if (from === 'my-todo') {
    router.push('/my-todo');
    return;
  }
  router.push({path:'/projects',query:{view:project.value?.status==='archived'?'closed':'active'}});
}

async function downloadAsset(asset: any) {
  if (!asset.taskId) return;
  try {
    const blob = await tasksApi.downloadAsset(asset.taskId, asset.id);
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
  if (!asset.taskId) return;
  const previewWindow = window.open('', '_blank');
  try {
    const blob = await tasksApi.previewAsset(asset.taskId, asset.id);
    const url = URL.createObjectURL(normalizePreviewBlob(asset, blob));
    if (previewWindow) previewWindow.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) {
    previewWindow?.close();
    ElMessage.error(e.message || '预览失败');
  }
}

onMounted(load);

onActivated(() => {
  if (!hasLoaded.value) return;
  if (refreshStore.isStale(seenRefreshVersions.value, ['project', 'task', 'planChange'])) load();
});
</script>

<template>
  <div v-if="project" class="proj-detail">
    <!-- 项目头部 -->
    <div class="proj-head">
      <el-button text @click="backToProjects">
        <el-icon><ArrowLeft /></el-icon>
        <span style="margin-left:4px">返回</span>
      </el-button>
      <div class="head-main">
        <div class="head-title-row">
          <h2 :title="project.name">{{ project.name }}</h2>
          <el-tag size="small" :type="project.status === 'active' ? 'success' : 'info'" round>
            {{ project.closureState === 'closed' ? '已结项' : project.closureState === 'pending' ? '结项审批中' : project.status === 'active' ? '进行中' : '历史归档' }}
          </el-tag>
        </div>
        <p class="head-desc" :title="project.description || '暂无描述'">{{ project.description || '暂无描述' }}</p>
        <div class="head-meta">
          <span class="meta-item" :title="project ? ownerLabel(project, userName, 5) : '未指定负责人'">负责人 {{ project ? ownerLabel(project, userName, 5) : '未指定负责人' }}</span>
          <span class="meta-item">开始 {{ project.startAt || '—' }}</span>
          <span class="meta-item">结束 {{ project.endAt || '—' }}</span>
          <el-tag v-if="project.planLocked" size="small" type="warning" effect="plain">计划已定稿</el-tag>
        </div>
      </div>
      <div class="head-spacer"></div>
      <div class="head-actions">
        <el-button v-if="canWriteProject" size="small" @click="openSaveTpl">保存为模板</el-button>
        <el-button v-if="canWriteProject" size="small" @click="openProjEdit"><el-icon><Edit /></el-icon>编辑</el-button>
        <el-button v-if="canLockPlan && project.status === 'active'" size="small" :type="project.planLocked ? 'warning' : 'primary'" plain @click="togglePlanLock">
          {{ project.planLocked ? '解除定稿' : '计划定稿' }}
        </el-button>
        <el-button v-if="canArchiveProject && project.status === 'active'" size="small" @click="archive">申请结项</el-button>
        <el-button v-else-if="project.status === 'archived' && project.closureState !== 'closed'" size="small" @click="unarchive">恢复历史归档</el-button>
        <el-button v-if="!isFrozen && (auth.has('admin') || auth.has('leader'))" size="small" type="danger" plain @click="remove">删除</el-button>
      </div>
    </div>

    <!-- 进度概览 -->
    <div class="prog-overview">
      <div class="prog-main">
        <div class="prog-label">项目总进度</div>
        <el-progress
          :percentage="projectProgress"
          :stroke-width="12"
          :color="projectProgress >= 100 ? '#288174' : '#288174'"
          class="prog-bar"
        />
        <span class="prog-num">{{ projectProgress }}%</span>
      </div>
      <div class="prog-stats">
        <div class="stat-box">
          <span class="stat-num blue">{{ totalTasks }}</span>
          <span class="stat-label">任务总数</span>
        </div>
        <div class="stat-box">
          <span class="stat-num green">{{ doneTasks }}</span>
          <span class="stat-label">已完成</span>
        </div>
        <div class="stat-box">
          <span class="stat-num orange">{{ doingTasks }}</span>
          <span class="stat-label">进行中</span>
        </div>
      </div>
    </div>

    <!-- 任务清单（只读，树形） -->
    <div class="proj-tasks">
      <div class="section-head">
        <span class="section-title">任务清单</span>
        <span class="section-sub">点击任务名称跳转任务管理并定位；点击进展或资料数量查看过程记录</span>
      </div>

      <div v-loading="loading" class="project-process-layout">
        <div class="task-tree-list">
          <el-empty v-if="!loading && !flatTaskRows.length" description="暂无任务，请到任务管理页创建" />
          <div
            v-for="t in flatTaskRows"
            :key="t.id"
            class="task-line"
            :class="{ active: String(t.id) === String(selectedProcessTaskId) }"
            :style="{ paddingLeft: 10 + t.depth * 20 + 'px' }"
            @click="selectTaskProcess(t)"
          >
            <span class="type-dot" :class="t.depth === 0 ? 'parent' : 'child'"></span>
            <RouterLink
              class="line-title task-link"
              :class="{ parent: t.depth === 0 }"
              :to="taskManagementLocation(projectId, t.id)"
              :title="`在任务管理中查看：${t.title}`"
              @click.stop
            >{{ t.title }}</RouterLink>
            <el-tag :type="statusType(t.status)" size="small" round>{{ statusLabel(t.status) }}</el-tag>
            <TaskCompletionTag :task="t" />
            <span class="line-assignee" :title="userName(t.assigneeId)">{{ userName(t.assigneeId) }}</span>
            <div class="line-right">
              <span class="line-stat">{{ taskProcessStats(t.id).updateCount }} 条进展</span>
              <span class="line-stat">{{ taskProcessStats(t.id).assetCount }} 份资料</span>
              <template v-if="t.hasChildren">
                <el-progress
                  :percentage="Math.round((t.progress || 0) * 100)"
                  :stroke-width="6"
                  :show-text="false"
                  :color="t.depth === 0 ? '#288174' : '#7b6ca1'"
                  class="line-prog"
                />
                <span class="line-pct">{{ Math.round((t.progress || 0) * 100) }}%</span>
              </template>
            </div>
          </div>
        </div>

        <div class="task-process-panel">
          <div v-if="selectedProcessTask" class="process-panel-inner">
            <div class="process-panel-head">
              <div>
                <div class="process-kicker">任务过程记录</div>
                <h3>
                  <RouterLink
                    class="task-link"
                    :to="taskManagementLocation(projectId, selectedProcessTask.id)"
                    :title="`在任务管理中查看：${selectedProcessTask.title}`"
                  >{{ selectedProcessTask.title }}</RouterLink>
                </h3>
              </div>
              <el-tag :type="statusType(selectedProcessTask.status)" round>{{ statusLabel(selectedProcessTask.status) }}</el-tag>
              <TaskCompletionTag :task="selectedProcessTask" />
            </div>
            <div class="process-summary">
              <span>{{ selectedTaskProcess.updates.length }} 条关键进展</span>
              <span>{{ selectedTaskProcess.assets.length }} 份过程资料</span>
              <span :title="userName(selectedProcessTask.assigneeId)">执行人：{{ userName(selectedProcessTask.assigneeId) }}</span>
            </div>
            <el-empty v-if="!selectedTaskTimeline.length" description="该任务暂无关键进展和过程资料" :image-size="88" />
            <div v-else class="task-timeline">
              <div v-for="group in selectedTaskTimeline" :key="group.key" class="timeline-day">
                <div class="timeline-date">{{ group.date }}</div>
                <div class="timeline-body">
                  <template v-if="group.updates.length">
                    <div v-for="row in group.updates" :key="row.id" class="progress-line">
                      <div class="progress-top">
                        <span class="progress-user" :title="userName(row.userId)">{{ userName(row.userId) }}</span>
                        <span class="progress-time">{{ formatTime(row.createdAt) }}</span>
                      </div>
                      <div class="progress-content" :title="row.content">{{ row.content }}</div>
                      <div v-if="row.risk || row.affectDueDate" class="progress-risk">
                        <span v-if="row.risk" :title="row.risk">风险：{{ row.risk }}</span>
                        <span v-if="row.affectDueDate">可能影响预计完成时间</span>
                      </div>
                      <div v-if="row.assets?.length" class="progress-assets">
                        <button
                          v-for="asset in row.assets"
                          :key="asset.id"
                          type="button"
                          class="timeline-asset"
                          :title="asset.title"
                          @click.stop="openAsset(asset)"
                        >
                          <span>{{ assetSourceLabel(asset) }}</span>
                          {{ asset.title }}
                        </button>
                      </div>
                    </div>
                  </template>
                  <div v-for="asset in group.unlinkedAssets" :key="asset.id" class="asset-line unlinked">
                    <div class="asset-info">
                      <el-tag size="small" type="warning" round>{{ assetSourceLabel(asset) }}</el-tag>
                      <div>
                        <div class="asset-title" :title="asset.title">{{ asset.title }}</div>
                        <div class="asset-path" title="历史资料：未关联关键进展">历史资料：未关联关键进展</div>
                      </div>
                    </div>
                    <div class="asset-actions">
                      <el-button v-if="asset.url" size="small" type="primary" plain @click="openAsset(asset)">打开</el-button>
                      <template v-else>
                        <el-button v-if="isAssetPreviewable(asset)" size="small" type="primary" plain @click="previewAsset(asset)">预览</el-button>
                        <el-button size="small" type="primary" plain @click="downloadAsset(asset)">下载</el-button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <el-empty v-else description="请选择左侧任务" :image-size="88" />
        </div>
      </div>
    </div>

    <div v-if="canViewProjectLogs" class="proj-logs">
      <div class="section-head">
        <span class="section-title">最近操作日志</span>
        <span class="section-sub">保留审批、删除、状态流转等关键动作</span>
      </div>
      <div class="project-log-list">
        <el-empty v-if="!projectLogs.length" description="暂无操作日志" />
        <div v-for="l in projectLogs.slice(0, 12)" :key="l.id" class="project-log-line">
          <span class="pd-log-action">{{ actionLabel(l.action) }}</span>
          <span class="project-log-title" :title="l.taskTitle || `任务 #${l.taskId}`">{{ l.taskTitle || `任务 #${l.taskId}` }}</span>
          <span class="pd-log-operator" :title="l.operatorName || userName(l.operatorId)">操作人：{{ l.operatorName || userName(l.operatorId) }}</span>
          <span v-if="l.fromStatus" class="pd-log-status">{{ statusLabel(l.fromStatus) }} → {{ statusLabel(l.toStatus || '') }}</span>
          <span class="pd-log-time">{{ formatTime(l.createdAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 编辑项目弹窗 -->
    <el-dialog v-model="projEditVisible" title="编辑项目" width="480px" align-center>
      <el-form label-width="80px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="projForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="负责人">
          <UserSelect v-model="projForm.ownerIds" :users="users" placeholder="选择项目负责人（可多选，首位为主负责人）" clearable filterable multiple collapse-tags :reserve-keyword="false" style="width:100%" />
        </el-form-item>
        <el-form-item label="开始日期">
          <DatePick v-model="projForm.startAt" placeholder="开始日期" :max="projForm.endAt || ''" style="width:100%" />
        </el-form-item>
        <el-form-item label="结束日期">
          <DatePick v-model="projForm.endAt" placeholder="结束日期" :min="projForm.startAt || ''" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="projEditVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProjEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 任务详情弹窗（只读） -->
    <el-dialog v-model="detailVisible" title="任务详情" width="520px" align-center>
      <div v-loading="detailLoading" v-if="detail" class="pd-detail">
        <div class="pd-head">
          <h3 :title="detail.title">{{ detail.title }}</h3>
          <el-tag :type="statusType(detail.status)" size="small" round>{{ statusLabel(detail.status) }}</el-tag>
        </div>
        <div class="pd-meta">
          <span :title="userName(detail.assigneeId)">执行人：{{ userName(detail.assigneeId) }}</span>
          <span :title="userName(detail.acceptorId)">负责人：{{ userName(detail.acceptorId) }}</span>
          <span>开始：{{ detailRange.startAt || '—' }}</span>
          <span>截止：{{ detailRange.dueAt || '—' }}</span>
        </div>
        <div class="pd-prog">
          <span>总进度</span>
          <el-progress :percentage="Math.round((detail.progress || 0) * 100)" :stroke-width="10" style="flex:1" />
        </div>
        <p v-if="detail.description" class="pd-desc" :title="detail.description">{{ detail.description }}</p>

        <div v-if="detail.logs?.length" class="pd-logs">
          <div class="pd-sec">操作记录</div>
          <div v-for="l in detail.logs.slice(0, 8)" :key="l.id" class="pd-log">
            <span class="pd-log-action">{{ actionLabel(l.action) }}</span>
            <span class="pd-log-operator">操作人：{{ l.operatorName || userName(l.operatorId) }}</span>
            <span v-if="l.fromStatus" class="pd-log-status">{{ statusLabel(l.fromStatus) }} → {{ statusLabel(l.toStatus || '') }}</span>
            <span class="pd-log-time">{{ formatTime(l.createdAt) }}</span>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 保存为模板弹窗 -->
    <el-dialog v-model="saveTplVisible" title="保存为模板" width="640px" align-center>
      <el-form label-width="80px">
        <el-form-item label="模板名称" required>
          <el-input v-model="tplForm.name" placeholder="默认使用项目名称，可修改" maxlength="128" show-word-limit />
        </el-form-item>
        <el-form-item label="分类">
          <SmartSelect v-model="tplForm.category" :items="catItems" style="width:100%" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="tplForm.description" type="textarea" :rows="2" placeholder="一句话说明该模板适用什么项目" maxlength="255" show-word-limit />
        </el-form-item>
      </el-form>
      <div class="editor-label">结构预览（共 {{ templatePreview.stageCount }} 个阶段、{{ templatePreview.taskCount }} 个任务，不含已取消）</div>
      <div class="tpl-preview">
        <el-empty v-if="!templatePreview.flat.length" description="项目暂无任务可导出" :image-size="72" />
        <div v-for="t in templatePreview.flat" :key="t.id" class="tpl-preview-row"
             :style="{ paddingLeft: 12 + t.depth * 18 + 'px' }">
          <span class="type-dot" :class="t.depth === 0 ? 'parent' : 'child'"></span>
          <span class="line-title" :class="{ parent: t.depth === 0 }" :title="t.title">{{ t.title }}</span>
          <span v-if="!t.hasChildren" class="tpl-preview-days">
            {{ previewDuration(t) != null ? previewDuration(t) + ' 天' : '无排期' }}
          </span>
        </div>
      </div>
      <template #footer>
        <el-button @click="saveTplVisible = false">取消</el-button>
        <el-button type="primary" :loading="saveTplSaving" @click="saveTemplate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.proj-detail { min-width: 0; }
.proj-head {
  background: #fff; border: 1px solid #eef1f5; border-radius: 12px;
  padding: 16px 20px; margin-bottom: 14px;
  display: flex; align-items: flex-start; gap: 12px;
}
.head-main { flex: 1; }
.head-title-row { display: flex; align-items: center; gap: 10px; }
.head-title-row h2 { margin: 0; font-size: 18px; color: #1f2733; }
.head-desc { margin: 4px 0 8px; font-size: 13px; color: #8a94a6; }
.head-meta { display: flex; gap: 16px; }
.meta-item { font-size: 12px; color: #8a94a6; }
.head-spacer { flex: 1; }
.head-actions { display: flex; gap: 8px; }

/* 进度概览 */
.prog-overview {
  background: #fff; border: 1px solid #eef1f5; border-radius: 12px;
  padding: 18px 20px; margin-bottom: 14px;
  display: flex; align-items: center; gap: 30px;
}
.prog-main { display: flex; align-items: center; gap: 12px; flex: 1; }
.prog-label { font-size: 13px; color: #4b5563; white-space: nowrap; }
.prog-bar { flex: 1; max-width: 300px; }
.prog-num { font-size: 20px; font-weight: 700; color: var(--color-info); }
.prog-stats { display: flex; gap: 26px; }
.stat-box { display: flex; flex-direction: column; align-items: center; }
.stat-num { font-size: 22px; font-weight: 700; }
.stat-num.blue { color: var(--color-info); }
.stat-num.green { color: var(--color-success); }
.stat-num.orange { color: var(--color-warning); }
.stat-label { font-size: 12px; color: #8a94a6; margin-top: 2px; }

/* 任务清单 */
.proj-tasks {
  background: #fff; border: 1px solid #eef1f5; border-radius: 12px;
  padding: 16px 20px;
}
.section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.section-title { font-size: 15px; font-weight: 600; color: #1f2733; }
.section-sub { font-size: 12px; color: #8a94a6; }

.project-process-layout {
  display: grid;
  grid-template-columns: minmax(420px, 0.9fr) minmax(420px, 1.1fr);
  gap: 16px;
  align-items: start;
}
.task-tree-list { min-height: 120px; border-right: 1px solid #eef2f7; padding-right: 14px; }
.task-line {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  font-size: 13px; color: #4b5563;
  border-bottom: 1px solid #f5f7fb;
  transition: background .16s ease, box-shadow .16s ease, transform .16s ease;
}
.task-line:hover { background: #f7faff; }
.task-line.active {
  background: #f2f7f4;
  box-shadow: inset 3px 0 0 var(--brand), 0 8px 18px rgba(15, 23, 42, 0.05);
  transform: translateX(2px);
}
.type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.type-dot.parent { background: var(--color-info); }
.type-dot.child { background: var(--color-accent); }
.line-title { font-size: 13px; flex-shrink: 0; }
.line-title.parent { font-weight: 600; color: #1a2b52; }
.task-link { color: var(--brand, #288174); text-decoration: none; }
.task-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.task-link:focus-visible { outline: 2px solid var(--brand, #288174); outline-offset: 3px; border-radius: 2px; }
.line-assignee { font-size: 12px; color: #8a94a6; }
.line-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.line-stat {
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #edf2f7;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  white-space: nowrap;
}
.line-prog { width: 100px; }
.line-pct { font-size: 12px; font-weight: 600; color: #4b5563; width: 34px; text-align: right; }
.task-line { cursor: pointer; }
.task-line:hover { background: #f2f6ff; }

.task-process-panel {
  background: #fff;
  border: 1px solid #eef1f5;
  border-radius: 12px;
  padding: 14px;
  min-height: 320px;
}
.process-panel-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 8px;
}
.process-kicker {
  color: #0f9f8f;
  font-size: 12px;
  font-weight: 800;
}
.process-panel-head h3 {
  margin: 3px 0 0;
  color: #111827;
  font-size: 17px;
}
.process-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.process-summary span {
  color: #475569;
  background: #f8fafc;
  border: 1px solid #edf2f7;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
}
.task-timeline {
  position: relative;
  padding-left: 18px;
}
.task-timeline::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: #cfe2da;
}
.timeline-day {
  position: relative;
  display: grid;
  grid-template-columns: 94px minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.timeline-day::before {
  content: '';
  position: absolute;
  left: -17px;
  top: 8px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #0f9f8f;
  box-shadow: 0 0 0 4px #ecfeff;
}
.timeline-date {
  color: #0f766e;
  font-weight: 900;
  font-size: 13px;
  padding-top: 2px;
}
.timeline-body { min-width: 0; }
.timeline-asset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border: 1px solid #dbeafe;
  background: #f8fbff;
  color: #1d4ed8;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.timeline-asset span {
  color: #0f766e;
  font-weight: 800;
}
.progress-line {
  padding: 12px;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  background: #fff;
}
.progress-line + .progress-line { margin-top: 10px; }
.progress-top { display: flex; align-items: center; gap: 8px; }
.progress-date { color: #0f766e; font-weight: 800; }
.progress-user { color: #94a3b8; font-size: 12px; }
.progress-time { color: #cbd5e1; font-size: 12px; }
.progress-task { margin-top: 5px; color: #64748b; font-size: 12px; }
.progress-content { margin-top: 8px; color: #1f2733; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.progress-risk {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  color: var(--color-danger);
  font-size: 12px;
}
.progress-assets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.asset-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed #eef2f7;
}
.asset-line.unlinked {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  padding: 10px 12px;
}
.asset-info { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.asset-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.asset-title {
  color: #1f2733;
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.asset-path {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}

.proj-logs {
  background: #fff; border: 1px solid #eef1f5; border-radius: 12px;
  padding: 16px 20px; margin-top: 14px;
}
.project-log-list { min-height: 60px; }
.project-log-line {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed #f0f2f6;
  font-size: 12px; color: #6b7280;
}
.project-log-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2733;
}

/* 任务详情弹窗（只读） */
.pd-detail { max-height: 70vh; overflow: auto; }
.pd-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pd-head h3 { margin: 0; font-size: 16px; color: #1f2733; }
.pd-meta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12px; color: #8a94a6; }
.pd-prog { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 13px; color: #4b5563; }
.pd-desc { margin: 10px 0 0; font-size: 13px; color: #6b7280; background: #f9fafb; border-radius: 8px; padding: 10px; }
.pd-ms { margin-top: 16px; }
.pd-sec { font-size: 13px; font-weight: 600; color: #1f2733; margin-bottom: 8px; }
.pd-ms-item { border: 1px solid #eef1f5; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.pd-ms-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pd-ms-name { font-size: 13px; font-weight: 500; color: #1f2733; flex: 1; }
.pd-ms-weight { font-size: 11px; color: #8a94a6; }
.pd-ms-status { font-size: 12px; }
.pd-ms-status.done { color: var(--color-success); }
.pd-ms-status.in_progress { color: var(--color-info); }
.pd-ms-status.not_started { color: #8a94a6; }
.pd-logs { margin-top: 16px; }
.pd-log { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #6b7280; padding: 6px 0; border-bottom: 1px dashed #f0f2f6; }
.pd-log-action { background: var(--color-info-bg); color: var(--color-info); border-radius: 4px; padding: 0 6px; font-size: 11px; }
.pd-log-operator { color: #334155; font-weight: 600; }
.pd-log-time { margin-left: auto; color: #9aa3b2; }

/* 保存为模板弹窗 */
.editor-label { font-size: 13px; font-weight: 600; color: #1f2733; margin: 4px 0 8px; }
.tpl-preview {
  border: 1px solid #eef2f7; border-radius: 10px;
  max-height: 260px; overflow: auto; padding: 8px 10px;
  background: #fafbfc;
}
.tpl-preview-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px;
  font-size: 13px; color: #4b5563;
}
.tpl-preview-row:hover { background: #f2f6ff; }
.tpl-preview-days {
  margin-left: auto; flex-shrink: 0;
  color: #64748b; background: #fff;
  border: 1px solid #edf2f7; border-radius: 999px;
  padding: 0 8px; font-size: 11px; white-space: nowrap;
}

@media (max-width: 980px) {
  .project-process-layout { grid-template-columns: 1fr; }
  .task-tree-list { border-right: 0; border-bottom: 1px solid #eef2f7; padding-right: 0; padding-bottom: 14px; }
}
</style>
