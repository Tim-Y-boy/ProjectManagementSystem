<script setup lang="ts">
import { computed, onActivated, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { projectsApi, departmentsApi, projectTemplatesApi, usersApi, closuresApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useCategoriesStore } from '@/stores/categories';
import { useRefreshStore, type RefreshSnapshot } from '@/stores/refresh';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, Folder, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { toNullableNumericId, toNumericId } from '@/utils/ids';
import { projectOwnerIds, isOwnerOf, canApplyProjectClosure } from '@/utils/project-owner';
import UserSelect from '@/components/UserSelect.vue';
import DeptSelect from '@/components/DeptSelect.vue';
import SmartSelect from '@/components/SmartSelect.vue';
import DatePick from '@/components/DatePick.vue';
import UserAvatar from '@/components/UserAvatar.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const catsStore = useCategoriesStore();
const refreshStore = useRefreshStore();
const catMeta = (c: string) => catsStore.catMeta(c);
// 类别下拉选项（label 带 emoji，支持缩写跳字搜索）
const catItems = computed(() =>
  catsStore.list.map((c: any) => ({ value: c.name, label: `${c.emoji || '📁'} ${c.name}` })),
);

const list = ref<any[]>([]);
const depts = ref<any[]>([]);

// 顶部统计数字滚动（纯展示，不影响 list/activeCount 等真实值）
const ovAnimated = ref<{ total: number; active: number; locked: number; archived: number }>({ total: 0, active: 0, locked: 0, archived: 0 });
let ovRAF = 0;
function animateOv(to: { total: number; active: number; locked: number; archived: number }, duration = 700) {
  cancelAnimationFrame(ovRAF);
  const from = { ...ovAnimated.value };
  const start = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const p = Math.min((now - start) / duration, 1);
    const e = ease(p);
    ovAnimated.value = {
      total: Math.round(from.total + (to.total - from.total) * e),
      active: Math.round(from.active + (to.active - from.active) * e),
      locked: Math.round(from.locked + (to.locked - from.locked) * e),
      archived: Math.round(from.archived + (to.archived - from.archived) * e),
    };
    if (p < 1) ovRAF = requestAnimationFrame(step);
  };
  ovRAF = requestAnimationFrame(step);
}
// 项目表单部门下拉的选项（含层级展示为简单名称，与筛选器一致）
const deptItems = computed(() => depts.value.map((d: any) => ({ value: toNumericId(d.id), label: d.name })));
const templates = ref<any[]>([]);
const users = ref<any[]>([]);
const loading = ref(false);
const hasLoaded = shallowRef(false);
const seenRefreshVersions = shallowRef<RefreshSnapshot>(refreshStore.snapshot());

const projectView = computed(() => ['closed','archived'].includes(String(route.query.view)) ? 'closed' : 'active');
const isArchivedView = computed(() => projectView.value !== 'active');
function changeProjectView(value: string | number) { router.push({name:'projects',query:{...route.query,view:String(value),riskFilter:undefined}}); }
async function openClosureReport(p:any) {
  try { const records=await closuresApi.list(); const report=records.find((r:any)=>Number(r.project_id)===Number(p.id)&&r.status==='approved'); if(!report){ElMessage.warning('未找到有效结项报告');return;} await router.push({name:'closures',query:{request:String(report.id)}}); } catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'无法打开报告');}
}
// 来自项目总览统计条的筛选（延期/临期/全部完成），仅非归档视图生效
const RISK_LABELS: Record<string, string> = { done: '已全部完成', atRisk: '临期项目', overdue: '延期项目' };
const riskFilterFromQuery = computed(() => (typeof route.query.riskFilter === 'string' ? route.query.riskFilter : ''));
const effectiveRiskFilter = computed(() => {
  if (isArchivedView.value) return '';
  return riskFilterFromQuery.value;
});
const riskLabel = computed(() => (effectiveRiskFilter.value ? RISK_LABELS[effectiveRiskFilter.value] || effectiveRiskFilter.value : ''));
function clearRiskFilter() {
  router.push({ name: 'projects' });
}
const filterDept = ref<number | null>(null);
const filterCategory = ref<string>(''); // 项目类别（categories.name 字符串）
const filterOwner = ref<number[]>([]); // 项目负责人（多选）
// 「只看我参与的」：普通成员默认开，admin/leader/dept_head 默认看全部
const showMine = ref(!(auth.has('admin') || auth.has('leader') || auth.has('dept_head')));
watch(showMine, load);
const canCreate = computed(() => auth.has('admin') || auth.has('leader') || auth.has('dept_head'));
// 可管理该项目（编辑/定稿）：admin/leader，或部门负责人且项目属于我可管理部门，或我是项目任一负责人
const isFrozen = (p: any) => p.status === 'archived' || ['pending', 'closed'].includes(p.closureState);
const canWriteProject = (p: any) => !isFrozen(p) && (
  auth.has('admin') ||
  auth.has('leader') ||
  (auth.has('dept_head') &&
    (String(p.deptId) === String(auth.user?.deptId) || auth.managedDeptIds.includes(Number(p.deptId)))) ||
  isOwnerOf(p, auth.user?.id));
// 已定稿且全部有效任务完成后，项目负责人或管理员可申请结项。
const canArchiveProject = (p: any) => canApplyProjectClosure(p, auth.user?.id, auth.has('admin'));
// 可管理（含项目负责人）：定稿用
const canManageProject = (p: any) => !isFrozen(p) && (canWriteProject(p) || isOwnerOf(p, auth.user?.id));
// 解除定稿：仅管理员（防止误解除，其它角色定稿后只能走计划变更）
const canUnlockPlan = (p: any) => !isFrozen(p) && auth.has('admin') && p.status === 'active';
// 可删除项目：仅未定稿可删。admin 可删任意未定稿；项目负责人可删自己负责的未定稿（与后端一致，前端隐藏按钮；已定稿先解除定稿）
const canDeleteProject = (p: any) =>
  !isFrozen(p) && !p.planLocked && (auth.has('admin') || isOwnerOf(p, auth.user?.id));
// 列表行的定稿/解除定稿按钮：未定稿可定稿（宽松权限），已定稿仅 admin 可解除
const canTogglePlan = (p: any) => (p.planLocked ? canUnlockPlan(p) : canManageProject(p));

// 仅为当前可见操作预留空间，避免少量按钮仍占用管理员的整列宽度。
const actionColumnWidth = computed(() => Math.max(96, ...list.value.map((p) => {
  const labels = ['详情'];
  if (canWriteProject(p)) labels.push('编辑');
  if (canTogglePlan(p)) labels.push(p.planLocked ? '解除定稿' : '定稿');
  if (p.status === 'active' && canArchiveProject(p)) labels.push('申请结项');
  else if (p.closureState === 'pending') labels.push('结项审批中');
  else if (p.closureState === 'closed') labels.push('查看结项报告');
  if (canDeleteProject(p)) labels.push('删除');
  return 36 + labels.reduce((width, label) => width + label.length * 14 + 26, 0) + (labels.length - 1) * 8;
})));

const activeCount = computed(() => list.value.filter((p) => p.status === 'active').length);
const archivedCount = computed(() => list.value.filter((p) => p.status === 'archived').length);
const lockedCount = computed(() => list.value.filter((p) => p.planLocked).length);

const deptName = (id: number | null) => depts.value.find((d) => String(d.id) === String(id))?.name || '—';
const userName = (id: number | null) =>
  id == null ? '—' : users.value.find((u) => String(u.id) === String(id))?.name || '—';
const userObj = (id: number | null) =>
  id == null ? null : users.value.find((u) => String(u.id) === String(id)) || null;

function projectStatus(p: any): string {
  if (p.closureState === 'closed') return '已结项';
  if (p.closureState === 'pending') return '结项审批中';
  if (p.status === 'archived') return '历史归档';
  if (!p.taskCount || p.startedCount === 0) return '未开始';
  if (p.doneCount === p.taskCount) return '已完成';
  return '进行中';
}

function statusType(p: any): string {
  if (p.status === 'archived') return 'info';
  const s = projectStatus(p);
  if (s === '未开始') return 'info';
  if (s === '已完成') return 'success';
  return 'primary';
}

function openProjectDetail(projectId: number | string) {
  router.push({
    name: 'project-detail',
    params: { id: projectId },
    query: { from: isArchivedView.value ? 'archived-projects' : 'projects' },
  });
}

function isProjectComplete(p: any) {
  return Number(p.taskCount || 0) === Number(p.doneCount || 0);
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function load() {
  loading.value = true;
  try {
    const status = isArchivedView.value ? 'archived' : 'active';
    const [projects, ds, us] = await Promise.all([
      projectsApi.list({
        status,
        deptId: filterDept.value || undefined,
        mine: showMine.value || undefined,
        riskFilter: effectiveRiskFilter.value || undefined,
        category: filterCategory.value || undefined,
        ownerIds: filterOwner.value.length ? filterOwner.value.join(',') : undefined,
      }),
      departmentsApi.list(),
      usersApi.list(),
    ]);
    list.value = projects.filter((p:any)=>projectView.value==='closed'?p.closureState==='closed':p.status==='active'&&p.closureState!=='closed');
    depts.value = ds;
    users.value = us;
    seenRefreshVersions.value = refreshStore.snapshot();
    hasLoaded.value = true;
    animateOv({ total: list.value.length, active: activeCount.value, locked: lockedCount.value, archived: archivedCount.value });
  } finally {
    loading.value = false;
  }
}

const dialogVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const isOwnerLocked = computed(() => editingId.value != null &&
  !!list.value.find((p) => String(p.id) === String(editingId.value))?.planLocked,
);
const form = ref({
  name: '',
  category: '',
  description: '',
  deptId: null as number | null,
  startAt: '',
  endAt: '',
  templateId: 0,
  ownerIds: [] as number[],
});
const selectedTemplate = computed(() =>
  templates.value.find((t) => String(t.id) === String(form.value.templateId)) || null,
);

async function loadTemplates() {
  if (templates.value.length) return;
  try {
    templates.value = await projectTemplatesApi.list();
  } catch {
    // 模板加载失败不阻塞新建项目
  }
}

function openCreate() {
  editingId.value = null;
  form.value = {
    name: '',
    category: '',
    description: '',
    deptId: toNullableNumericId(auth.user?.deptId),
    startAt: '',
    endAt: '',
    templateId: 0,
    ownerIds: [],
  };
  dialogVisible.value = true;
  loadTemplates();
  catsStore.load();
}

function openEdit(p: any) {
  editingId.value = p.id;
  form.value = {
    name: p.name,
    category: p.category || '未分类',
    description: p.description || '',
    deptId: toNullableNumericId(p.deptId),
    startAt: p.startAt || '',
    endAt: p.endAt || '',
    templateId: 0,
    ownerIds: projectOwnerIds(p),
  };
  dialogVisible.value = true;
}

function selectTemplate(templateId: number) {
  form.value.templateId = templateId;
  if (!templateId) return;
  const template = templates.value.find((t) => String(t.id) === String(templateId));
  if (template?.category) form.value.category = template.category;
}

async function save() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入项目名称');
    return;
  }
  if (!form.value.category.trim()) {
    ElMessage.warning('请选择项目类别');
    return;
  }

  saving.value = true;
  try {
    if (editingId.value) {
      const { ownerIds, ...projectFields } = form.value;
      await projectsApi.update(editingId.value, isOwnerLocked.value ? projectFields : form.value);
      refreshStore.markProjectChanged();
      ElMessage.success('项目已更新');
    } else {
      const res = await projectsApi.create(form.value);
      refreshStore.markProjectPlanChanged();
      if (res?.taskCount) {
        ElMessage.success(`项目创建成功，已生成 ${res.taskCount} 个任务`);
      } else {
        ElMessage.success('项目创建成功');
      }
    }
    dialogVisible.value = false;
    editingId.value = null;
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function archive(p: any) {
  router.push({ name: 'closures', query: { projectId: String(p.id) } });
}

async function unarchive(p: any) {
  try {
    await projectsApi.unarchive(p.id);
    refreshStore.markProjectChanged();
    ElMessage.success('项目已恢复');
    await load();
  } catch (e: any) {
    if (!e?.messageShown) ElMessage.error(e?.message || '恢复失败');
  }
}

async function remove(p: any) {
  await ElMessageBox.confirm(`确定删除项目「${p.name}」？其下所有任务将被删除，且不可恢复。`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });
  await projectsApi.remove(p.id);
  refreshStore.markProjectChanged();
  ElMessage.success('项目已删除');
  await load();
}

async function togglePlanLock(p: any) {
  const locking = !p.planLocked;
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
  await projectsApi.setPlanLocked(p.id, !p.planLocked);
  refreshStore.markProjectPlanChanged();
  ElMessage.success(p.planLocked ? '已解除定稿' : '计划已定稿');
  await load();
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

watch(
  () => projectView.value,
  () => {
    load();
  },
);
watch(effectiveRiskFilter, () => {
  if (hasLoaded.value) load();
});
</script>

<template>
  <div class="proj-wrap">
    <div v-if="!isArchivedView" class="overview-bar">
      <div class="overview-left">
        <div class="overview-title">项目台账</div>
        <div class="overview-subtitle">统一查看项目状态、负责人、计划定稿与任务规模。</div>
      </div>
      <div class="overview-metrics">
        <div class="ov-item">
          <span class="ov-num">{{ ovAnimated.total }}</span>
          <span class="ov-label">项目总数</span>
        </div>
        <div class="ov-divider"></div>
        <div class="ov-item">
          <span class="ov-num green">{{ ovAnimated.active }}</span>
          <span class="ov-label">进行中</span>
        </div>
        <div class="ov-divider"></div>
        <div class="ov-item">
          <span class="ov-num amber">{{ ovAnimated.locked }}</span>
          <span class="ov-label">已定稿</span>
        </div>
        <div class="ov-divider"></div>
        <div class="ov-item">
          <span class="ov-num muted">{{ ovAnimated.archived }}</span>
          <span class="ov-label">已结项</span>
        </div>
      </div>
      <el-button v-if="canCreate && !isArchivedView" type="primary" @click="openCreate">
        <el-icon style="margin-right:6px"><Plus /></el-icon>
        新建项目
      </el-button>
    </div>

    <el-card class="proj-card">
      <template #header>
        <div class="card-header">
          <div class="card-title">
            <el-icon><Folder /></el-icon>
            项目列表
          </div>
          <el-button :loading="loading" @click="load">
            <el-icon style="margin-right:6px"><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>

      <div class="project-view-switch">
        <span id="project-view-label" class="project-view-label">项目范围</span>
        <div class="project-view-buttons" role="group" aria-labelledby="project-view-label">
          <button type="button" :aria-pressed="projectView === 'active'" @click="changeProjectView('active')">在管项目</button>
          <button type="button" :aria-pressed="projectView === 'closed'" @click="changeProjectView('closed')">已结项</button>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-label">
          <el-icon><Search /></el-icon>
          筛选
        </div>

        <SmartSelect v-model="filterDept" :items="deptItems" placeholder="部门" clearable class="filter-dept" @change="load" />
        <SmartSelect v-model="filterCategory" :items="catItems" placeholder="类别" clearable class="filter-cat" @change="load" />
        <UserSelect v-model="filterOwner" :users="users" placeholder="负责人" clearable filterable multiple collapse-tags class="filter-owner" @change="load" />
        <label class="mine-switch">
          <span>仅显示我参与的</span>
          <el-switch v-model="showMine" />
        </label>
        <el-tag v-if="riskLabel" closable round class="filter-risk-tag" @close="clearRiskFilter">
          正在查看：{{ riskLabel }}
        </el-tag>
      </div>

      <el-table :data="list" v-loading="loading" border stripe class="proj-table">
        <el-table-column label="项目" min-width="260">
          <template #default="{ row }">
            <div class="proj-cell" @click="openProjectDetail(row.id)">
              <span class="proj-ico">
                <el-icon><Folder /></el-icon>
              </span>
              <div class="proj-meta">
                <span class="proj-name" :title="row.name">{{ row.name }}</span>
                <span class="proj-desc" :title="row.description || '暂无项目描述'">{{ row.description || '暂无项目描述' }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="项目类别" width="140">
          <template #default="{ row }">
            <el-tag
              size="small"
              round
              :style="{ background: catMeta(row.category || '未分类').color + '1f', color: catMeta(row.category || '未分类').color }"
            >
              {{ catMeta(row.category || '未分类').emoji }} {{ row.category || '未分类' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属部门" width="130">
          <template #default="{ row }">
            <span :title="deptName(row.deptId)">{{ deptName(row.deptId) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="负责人" width="150">
          <template #default="{ row }">
            <div
              v-if="projectOwnerIds(row).length"
              class="owner-stack"
              :title="projectOwnerIds(row).map((oid) => userObj(oid)?.name || '').join('、')"
            >
              <span class="owner-avs">
                <UserAvatar
                  v-for="oid in projectOwnerIds(row).slice(0, 3)"
                  :key="oid"
                  class="owner-stack-av"
                  :name="userObj(oid)?.name || '项目负责人'"
                  :avatar-url="userObj(oid)?.avatarUrl || null"
                  :size="22"
                />
                <span v-if="projectOwnerIds(row).length > 3" class="owner-more">
                  +{{ projectOwnerIds(row).length - 3 }}
                </span>
              </span>
              <span class="owner-names">
                {{ projectOwnerIds(row).map((oid) => userObj(oid)?.name || '').join('、') }}
              </span>
            </div>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="startAt" label="开始" width="124">
          <template #default="{ row }">{{ row.startAt || '—' }}</template>
        </el-table-column>
        <el-table-column prop="endAt" label="结束" width="124">
          <template #default="{ row }">{{ row.endAt || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="isArchivedView" label="结项时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.archivedAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="168">
          <template #default="{ row }">
            <el-tag :type="statusType(row)" size="small">{{ projectStatus(row) }}</el-tag>
            <el-tag v-if="row.planLocked" size="small" type="warning" class="lock-tag">已定稿</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="actionColumnWidth" align="right" fixed="right" class-name="project-actions-column">
          <template #default="{ row }">
            <div class="table-op">
            <el-button size="small" type="primary" plain @click="openProjectDetail(row.id)">详情</el-button>
            <el-button v-if="canWriteProject(row)" size="small" type="info" plain @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="canTogglePlan(row)"
              size="small"
              type="warning"
              plain
              @click="togglePlanLock(row)"
            >
              {{ row.planLocked ? '解除定稿' : '定稿' }}
            </el-button>
            <el-button v-if="row.status === 'active' && canArchiveProject(row)" class="closure-apply" size="small" type="primary" plain @click="archive(row)">申请结项</el-button>
            <el-tag v-else-if="row.closureState === 'pending'" type="warning">结项审批中</el-tag>
            <el-button v-else-if="row.closureState === 'closed'" size="small" type="primary" plain @click="openClosureReport(row)">查看结项报告</el-button>
            <el-button v-if="canDeleteProject(row)" size="small" type="danger" plain @click="remove(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑项目' : '新建项目'" width="660px" align-center :close-on-click-modal="false">
      <template v-if="!editingId">
        <div class="tpl-section">
          <div class="tpl-label">选择项目模板</div>
          <div class="tpl-hint">选择“空白项目”可手动维护任务；选择模板会自动生成标准任务链路。</div>
          <div class="tpl-grid">
            <div
              class="tpl-card"
              :class="{ active: String(form.templateId) === '0' }"
              @click="selectTemplate(0)"
            >
              <span class="tpl-emoji blank">📋</span>
              <div class="tpl-info">
                <div class="tpl-name" title="空白项目">空白项目</div>
                <div class="tpl-desc" title="从零开始，手动建立任务">从零开始，手动建立任务</div>
              </div>
              <el-icon v-if="String(form.templateId) === '0'" class="tpl-check"><Check /></el-icon>
            </div>
            <div
              v-for="t in templates"
              :key="t.id"
              class="tpl-card"
              :class="{ active: String(form.templateId) === String(t.id) }"
              :style="{ borderLeftColor: catMeta(t.category).color }"
              @click="selectTemplate(toNumericId(t.id))"
            >
              <span
                class="tpl-emoji"
                :style="{ background: catMeta(t.category).color + '1f', color: catMeta(t.category).color }"
              >{{ catMeta(t.category).emoji }}</span>
              <div class="tpl-info">
                <div class="tpl-name" :title="t.name">{{ t.name }}</div>
                <div class="tpl-desc" :title="t.description || '暂无模板描述'">{{ t.description }}</div>
                <div class="tpl-meta" :style="{ color: catMeta(t.category).color }">
                  {{ t.stageCount }} 阶段 · {{ t.taskCount }} 任务
                </div>
              </div>
              <el-icon
                v-if="String(form.templateId) === String(t.id)"
                class="tpl-check"
                :style="{ color: catMeta(t.category).color }"
              ><Check /></el-icon>
            </div>
          </div>
        </div>
      </template>

      <el-form label-width="92px" class="project-form">
        <el-form-item label="项目名称" required>
          <el-input v-model="form.name" placeholder="如：客户管理系统上线" />
        </el-form-item>
        <el-form-item label="项目类别" required>
          <SmartSelect v-model="form.category" :items="catItems" placeholder="请选择项目类别" style="width:100%" />
          <div v-if="!editingId && selectedTemplate?.category" class="form-tip">
            已根据模板带出类别：{{ selectedTemplate.category }}，可按实际业务调整。
          </div>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="项目目标、范围、关键约束等" />
        </el-form-item>
        <el-form-item label="归属部门">
          <DeptSelect v-model="form.deptId" :items="deptItems" placeholder="选择部门" style="width:100%" />
        </el-form-item>
        <el-form-item label="项目负责人">
          <UserSelect v-model="form.ownerIds" :users="users" :disabled="isOwnerLocked" placeholder="选择项目负责人（可多选，首位为主负责人）" style="width:100%" filterable clearable multiple collapse-tags :max-collapse-tags="3" :reserve-keyword="false" />
          <div v-if="isOwnerLocked" class="owner-lock-tip">项目计划已定稿，不允许修改项目负责人。</div>
        </el-form-item>
        <el-form-item label="开始日期">
          <DatePick v-model="form.startAt" placeholder="开始日期" :max="form.endAt || ''" style="width:100%" />
        </el-form-item>
        <el-form-item label="结束日期">
          <DatePick v-model="form.endAt" placeholder="结束日期" :min="form.startAt || ''" style="width:100%" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">
          {{ editingId ? '保存修改' : '创建项目' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.proj-wrap {
  min-width: 0;
}

.overview-bar {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 18px 22px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: #fff;
  box-shadow: var(--shadow-sm);
}

.overview-left {
  min-width: 220px;
}

.overview-title {
  color: var(--text-1);
  font-size: 18px;
  font-weight: 800;
}

.overview-subtitle {
  margin-top: 4px;
  color: var(--text-3);
  font-size: 13px;
}

.overview-metrics {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: 1;
}

.ov-item {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.ov-num {
  color: var(--brand);
  font-size: 26px;
  font-weight: 900;
}

.ov-num.green {
  color: var(--success);
}

.ov-num.amber {
  color: var(--warning);
}

.ov-num.muted {
  color: var(--text-3);
}

.ov-label {
  color: var(--text-2);
  font-size: 13px;
  font-weight: 700;
}

.ov-divider {
  width: 1px;
  height: 28px;
  background: var(--border);
}

.proj-card {
  border-radius: var(--radius-lg);
}

.proj-card :deep(.el-card__header) {
  padding-bottom: 12px;
}

.proj-card :deep(.el-card__body) {
  padding-top: 12px;
}

.project-view-switch {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
}

.project-view-label {
  color: var(--text-2);
  font-size: 14px;
  font-weight: 600;
}

.project-view-buttons {
  display: inline-flex;
}

.project-view-buttons button {
  min-width: 112px;
  min-height: 40px;
  padding: 8px 20px;
  border: 1px solid #b9c6c1;
  background: #fff;
  color: var(--text-1);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms, color 150ms;
}

.project-view-buttons button:first-child { border-radius: 8px 0 0 8px; }
.project-view-buttons button:last-child { border-radius: 0 8px 8px 0; margin-left: -1px; }
.project-view-buttons button:hover { background: #edf5f2; }
.project-view-buttons button[aria-pressed="true"] {
  position: relative;
  background: #227c70;
  border-color: #227c70;
  color: #fff;
}
.project-view-buttons button:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid #227c70;
  outline-offset: 3px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-1);
  font-size: 17px;
  font-weight: 800;
}

.card-title .el-icon {
  color: var(--brand);
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
  border: 1px solid #e6ecea;
  border-radius: var(--radius-md);
  background: #f8fbfa;
}

.mine-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  color: #4b5563;
  font-size: 13px;
  white-space: nowrap;
}

.owner-lock-tip { margin-top: 6px; color: #64748b; font-size: 12px; line-height: 1.5; }

/* 负责人：头像叠放（成员组样式）+ 姓名（可溢出省略） */
.owner-stack {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}
.owner-avs {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding-left: 1px;
}
.owner-stack-av {
  margin-left: -8px;
}
.owner-stack-av:first-child {
  margin-left: 0;
}
.owner-stack-av :deep(.ua-avatar) {
  border: 2px solid #fff;
}
.owner-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: -6px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: #eef2f0;
  color: #52615d;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.owner-names {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #33413d;
}

.filter-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 4px;
  color: #52615d;
  font-weight: 700;
}

.filter-status {
  width: 146px;
}

.filter-dept {
  width: 200px;
}

.filter-cat {
  width: 150px;
}

.filter-owner {
  width: 180px;
}

.filter-risk-tag {
  margin-left: auto;
}

.proj-table {
  width: 100%;
}

.proj-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.proj-cell:hover .proj-name {
  color: var(--brand);
}

.proj-ico {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 10px;
  color: var(--brand);
  background: var(--brand-light);
}

.proj-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.proj-name {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 800;
  transition: color var(--transition-fast);
}

.proj-desc {
  max-width: 300px;
  margin-top: 3px;
  overflow: hidden;
  color: var(--text-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lock-tag {
  margin-left: 6px;
}

.tpl-section {
  padding: 14px 14px 10px;
  margin-bottom: 16px;
  border: 1px solid #e6ecea;
  border-radius: var(--radius-md);
  background: #f8fbfa;
}

.tpl-label {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 800;
}

.tpl-hint {
  margin-top: 3px;
  margin-bottom: 12px;
  color: var(--text-3);
  font-size: 12px;
}

.tpl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 2px;
}

.tpl-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 82px;
  padding: 12px 12px 10px;
  border: 1px solid #e6ecea;
  border-left: 3px solid #cbd5d2;
  border-radius: var(--radius-md);
  background: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tpl-card:hover {
  border-color: var(--color-primary-200);
  box-shadow: 0 8px 18px rgba(40, 129, 116, 0.10);
  transform: translateY(-1px);
}

.tpl-card.active {
  border-color: var(--brand);
  background: var(--brand-light);
  box-shadow: 0 8px 20px rgba(40, 129, 116, 0.12);
}

.tpl-emoji {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 9px;
  font-size: 18px;
}

.tpl-emoji.blank {
  color: var(--text-2);
  background: var(--color-border-light);
}

.tpl-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.tpl-name {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 800;
}

.tpl-desc {
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.5;
}

.tpl-meta {
  font-size: 11px;
  font-weight: 800;
}

.tpl-check {
  flex-shrink: 0;
  margin-top: 6px;
  color: var(--brand);
  font-size: 18px;
}

.project-form {
  padding-top: 2px;
}

@media (max-width: 1080px) {
  .overview-bar,
  .overview-metrics {
    align-items: flex-start;
    flex-direction: column;
  }

  .ov-divider {
    display: none;
  }
}

.proj-card :deep(.el-card__header::before) { display: none; }

.table-op { display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
.table-op :deep(.el-button + .el-button) { margin-left: 0; }

:deep(.project-actions-column .cell) {
  overflow: visible;
  padding: 10px 18px;
}

.closure-apply {
  font-weight: 700;
  color: var(--color-primary-800, #1a534a);
  animation: closure-breathing-light 2s ease-in-out infinite;
}

@keyframes closure-breathing-light {
  0%, 100% {
    background-color: var(--color-primary-bg);
    border-color: var(--color-primary-200);
    box-shadow: inset 0 0 10px rgba(40, 129, 116, 0), 0 0 12px rgba(40, 129, 116, 0);
  }
  50% {
    background-color: #b8ddd2;
    border-color: var(--color-primary-400, #7eb3ac);
    box-shadow: inset 0 0 10px rgba(40, 129, 116, 0.1), 0 0 12px rgba(40, 129, 116, 0.48);
  }
}

@media (prefers-reduced-motion: reduce) {
  .closure-apply { animation: none; }
}
</style>
