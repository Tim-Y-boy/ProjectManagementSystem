<script setup lang="ts">
import { ref, computed, onMounted, shallowRef } from 'vue';
import { usersApi, departmentsApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { ElMessage } from 'element-plus';
import {
  Refresh,
  UserFilled,
  Search,
  OfficeBuilding,
  ArrowDown,
  ArrowRight,
} from '@element-plus/icons-vue';
import { toNullableNumericId, toNumericId } from '@/utils/ids';
import DeptSelect from '@/components/DeptSelect.vue';

const auth = useAuthStore();
const canManageUsers = computed(() => auth.has('admin'));

const allRoles = [
  { value: 'admin', label: '管理员', type: 'danger' as const },
  { value: 'leader', label: '领导', type: 'warning' as const },
  { value: 'dept_head', label: '部门负责人', type: 'primary' as const },
  { value: 'member', label: '普通成员', type: 'info' as const },
];
const roleLabel = (r: string) => allRoles.find((x) => x.value === r)?.label || r;
const roleType = (r: string) => allRoles.find((x) => x.value === r)?.type || 'info';

// 头像多彩配色：按名字 hash 选色，避免千篇一律的蓝
const AVATAR_COLORS = [
  { bg: '#edf4fb', fg: '#288174' },
  { bg: '#e9f3f0', fg: '#2e9b8b' },
  { bg: '#fff7e8', fg: '#bd8433' },
  { bg: '#fff0f1', fg: '#b9555b' },
  { bg: '#f4f2f9', fg: '#7b6ca1' },
  { bg: '#ecf4f2', fg: '#288174' },
];
const avatarStyle = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const c = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return { background: c.bg, color: c.fg };
};

const list = ref<any[]>([]);
const deptTree = ref<any[]>([]);
const loading = ref(false);
// 全部员工总数（"全部员工"节点固定显示，不随选中部门变化）
const totalAll = ref(0);

const selectedDeptId = ref<number | null>(null);
const expandedKeys = ref<Set<number>>(new Set());
const searchText = ref('');
const mockUsersCollapsed = shallowRef(true);

// 扁平化树行为带缩进的行
const flatRows = ref<any[]>([]);
const flattenTree = (nodes: any[], depth: number, expanded: Set<number>) => {
  const rows: any[] = [];
  for (const n of nodes) {
    rows.push({ ...n, depth, hasChildren: !!n.children?.length });
    if (n.children?.length && expanded.has(n.id)) {
      rows.push(...flattenTree(n.children, depth + 1, expanded));
    }
  }
  return rows;
};

const selectedDeptName = computed(() => {
  const hit = flatRows.value.find((r) => String(r.id) === String(selectedDeptId.value));
  return hit?.name || '全部员工';
});

const filteredList = computed(() => {
  const kw = searchText.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter(
    (u) =>
      (u.name || '').toLowerCase().includes(kw) ||
      (u.jobTitle || '').toLowerCase().includes(kw) ||
      (u.employeeId || '').toLowerCase().includes(kw),
  );
});

const mockUsers = computed(() => filteredList.value.filter((u) => u.isMock));
const regularUsers = computed(() => filteredList.value.filter((u) => !u.isMock));
const noRoleCount = computed(
  () => regularUsers.value.filter((u) => !(u.roles || []).length).length,
);

async function loadDepts() {
  deptTree.value = await departmentsApi.tree();
  // 展开到第二层
  const exp = new Set<number>();
  for (const d of deptTree.value) {
    exp.add(toNumericId(d.id));
  }
  expandedKeys.value = exp;
  flatRows.value = flattenTree(deptTree.value, 0, exp);
}

async function loadUsers(deptId?: number) {
  loading.value = true;
  try {
    list.value = await usersApi.list(deptId);
  } finally {
    loading.value = false;
  }
}

function selectDept(id: number | null) {
  if (selectedDeptId.value === id) return;
  selectedDeptId.value = id;
  loadUsers(id || undefined);
}

function toggleExpand(id: number) {
  const next = new Set(expandedKeys.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedKeys.value = next;
  flatRows.value = flattenTree(deptTree.value, 0, next);
}

// 角色编辑（单点）
const editing = ref<any>(null);
const editRoles = ref<string[]>([]);
const dialogVisible = ref(false);
function openEdit(row: any) {
  if (!canManageUsers.value) return;
  editing.value = row;
  editRoles.value = [...(row.roles || [])];
  dialogVisible.value = true;
}
async function saveRoles() {
  if (!canManageUsers.value) return;
  if (!editing.value) return;
  await usersApi.assignRoles(editing.value.id, editRoles.value);
  ElMessage.success('角色已更新');
  dialogVisible.value = false;
  loadUsers(selectedDeptId.value || undefined);
}
async function toggleActive(row: any) {
  if (!canManageUsers.value) return;
  await usersApi.setActive(row.id, !row.isActive);
  ElMessage.success(row.isActive ? '已停用' : '已启用');
  loadUsers(selectedDeptId.value || undefined);
}

// 按部门批量分配角色
const batchDialogVisible = ref(false);
const batchDeptId = ref<number | null>(null);
const batchRoles = ref<string[]>([]);
const batchLoading = ref(false);
const mockDeptSaving = ref<number | null>(null);
const deptOptions = computed(() => {
  const flat: any[] = [];
  const walk = (nodes: any[], prefix = '') => {
    for (const d of nodes) {
      flat.push({ value: toNumericId(d.id), label: prefix + d.name });
      if (d.children?.length) walk(d.children, prefix + d.name + ' / ');
    }
  };
  walk(deptTree.value);
  return flat;
});
function openBatch() {
  if (!canManageUsers.value) return;
  batchDeptId.value = selectedDeptId.value;
  batchRoles.value = [];
  batchDialogVisible.value = true;
}

async function updateMockDept(row: any, deptId: number | null) {
  if (!canManageUsers.value) return;
  mockDeptSaving.value = row.id;
  try {
    await usersApi.setMockDept(row.id, deptId);
    ElMessage.success('Mock 用户部门已更新');
    await loadUsers(selectedDeptId.value || undefined);
  } catch (e: any) {
    ElMessage.error(e.message || '更新 Mock 用户部门失败');
    await loadUsers(selectedDeptId.value || undefined);
  } finally {
    mockDeptSaving.value = null;
  }
}
async function saveBatch() {
  if (!canManageUsers.value) return;
  if (!batchDeptId.value) {
    ElMessage.warning('请选择部门');
    return;
  }
  if (!batchRoles.value.length) {
    ElMessage.warning('请至少选择一个角色');
    return;
  }
  batchLoading.value = true;
  try {
    const res = await usersApi.assignRolesByDept(batchDeptId.value, batchRoles.value);
    ElMessage.success(`已为 ${res.affected} 名成员分配角色`);
    batchDialogVisible.value = false;
    loadUsers(selectedDeptId.value || undefined);
  } catch (e: any) {
    ElMessage.error(e.message || '批量分配失败');
  } finally {
    batchLoading.value = false;
  }
}

async function refresh() {
  // 每次刷新都重新拉一次全部员工总数，保证"全部员工"badge 准确
  const all = await usersApi.list();
  totalAll.value = all.length;
  await Promise.all([loadDepts(), loadUsers(selectedDeptId.value || undefined)]);
}

onMounted(refresh);
</script>

<template>
  <div class="users-wrap">
    <!-- 顶部概览 -->
    <div class="overview-bar">
      <div class="ov-item">
        <span class="ov-num">{{ regularUsers.length }}</span>
        <span class="ov-label">当前成员</span>
      </div>
      <div class="ov-divider"></div>
      <div class="ov-item">
        <span class="ov-num">{{ regularUsers.filter(u => u.isActive).length }}</span>
        <span class="ov-label">在职</span>
      </div>
      <div class="ov-divider"></div>
      <div class="ov-item">
        <span class="ov-num warn">{{ noRoleCount }}</span>
        <span class="ov-label">待分配角色</span>
      </div>
    </div>

    <div class="users-main">
      <!-- 左侧：组织树 -->
      <aside class="tree-panel">
        <div class="panel-header">
          <span class="panel-title">组织架构</span>
          <el-button size="small" text :loading="loading" @click="refresh">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>

        <div class="tree-body">
          <div class="all-row" :class="{ active: selectedDeptId === null }" @click="selectDept(null)">
            <el-icon class="all-ico"><UserFilled /></el-icon>
            <span class="all-name">全部员工</span>
            <span class="tn-badge">{{ totalAll }}</span>
          </div>

          <div
            v-for="row in flatRows"
            :key="row.id"
            class="tn-row"
            :class="{ active: selectedDeptId === row.id }"
            :style="{ paddingLeft: 9 + row.depth * 14 + 'px' }"
            @click="selectDept(row.id)"
          >
            <span
              class="tn-twist"
              @click.stop="toggleExpand(row.id)"
            >
              <el-icon v-if="row.hasChildren">
                <ArrowDown v-if="expandedKeys.has(row.id)" />
                <ArrowRight v-else />
              </el-icon>
            </span>
            <el-icon class="tn-ico"><OfficeBuilding /></el-icon>
            <span class="tn-name" :title="row.name">{{ row.name }}</span>
            <span class="tn-badge">{{ row.totalCount ?? row.userCount ?? 0 }}</span>
          </div>
        </div>
      </aside>

      <!-- 右侧：成员卡片 -->
      <section class="member-panel">
        <div class="member-toolbar">
          <div class="member-title">
            <h3>{{ selectedDeptName }}</h3>
            <span class="member-sub">{{ regularUsers.length }} 名成员，{{ mockUsers.length }} 个 Mock 调试账号</span>
          </div>
          <div class="toolbar-actions">
            <el-input
              v-model="searchText"
              placeholder="搜索姓名 / 职务 / 工号"
              clearable
              class="search-box"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button v-if="canManageUsers" type="primary" @click="openBatch">
              <el-icon style="margin-right:6px"><UserFilled /></el-icon>
              批量分配角色
            </el-button>
          </div>
        </div>

        <div class="member-body">
          <el-empty
            v-if="!loading && !regularUsers.length && !mockUsers.length"
            description="该部门暂无成员"
          />
          <div v-else v-loading="loading" class="member-sections">
            <section v-if="mockUsers.length" class="mock-users-section" :class="{ collapsed: mockUsersCollapsed }">
              <div class="section-head mock-section-head">
                <div>
                  <h4>Mock 调试账号</h4>
                  <p>用于绑定指定部门后复现权限、项目、任务流转问题；角色固定，组织架构同步不会覆盖。</p>
                </div>
                <div class="mock-head-actions">
                  <el-tag type="warning" effect="light" round>{{ mockUsers.length }} 个</el-tag>
                  <el-button size="small" text class="mock-toggle" @click="mockUsersCollapsed = !mockUsersCollapsed">
                    <el-icon>
                      <ArrowRight v-if="mockUsersCollapsed" />
                      <ArrowDown v-else />
                    </el-icon>
                    {{ mockUsersCollapsed ? '展开' : '收起' }}
                  </el-button>
                </div>
              </div>
              <div v-if="mockUsersCollapsed" class="mock-collapsed-tip">
                Mock 调试账号已收起，需要复现权限、部门、任务流转问题时再展开查看。
              </div>
              <div v-show="!mockUsersCollapsed" class="member-grid mock-grid">
                <div v-for="m in mockUsers" :key="m.id" class="member-card mock-member-card">
                  <div class="card-top">
                    <el-avatar
                      :size="44"
                      :src="m.avatarUrl"
                      :style="!m.avatarUrl ? avatarStyle(m.name) : {}"
                      class="m-avatar"
                    >
                      {{ (m.name || '?').slice(0, 1) }}
                    </el-avatar>
                    <div class="m-meta">
                      <span class="m-name">{{ m.name }}</span>
                      <span class="m-title">Mock 调试账号</span>
                    </div>
                    <el-tag type="warning" effect="light" round>Mock</el-tag>
                  </div>

                  <div class="m-rows">
                    <div class="m-row">
                      <span class="m-label">角色</span>
                      <span class="m-val roles">
                        <el-tag
                          v-for="r in m.roles"
                          :key="r"
                          size="small"
                          :type="roleType(r)"
                          effect="light"
                          round
                          class="m-role"
                        >
                          {{ roleLabel(r) }}
                        </el-tag>
                      </span>
                    </div>
                    <div class="m-row mock-dept-row">
                      <span class="m-label">部门</span>
                      <DeptSelect
                        :model-value="toNullableNumericId(m.deptId)"
                        placeholder="选择 Mock 所属部门"
                        clearable
                        size="small"
                        class="mock-dept-select"
                        :disabled="!canManageUsers || mockDeptSaving === m.id"
                        :loading="mockDeptSaving === m.id"
                        :items="deptOptions"
                        @update:model-value="(value) => updateMockDept(m, value == null ? null : Number(value))"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="regular-users-section">
              <div v-if="mockUsers.length" class="section-head compact">
                <div>
                  <h4>组织成员</h4>
                  <p>来自飞书组织架构同步的真实成员。</p>
                </div>
              </div>
              <div class="member-grid">
                <div v-for="m in regularUsers" :key="m.id" class="member-card">
              <div class="card-top">
                <el-avatar
                  :size="44"
                  :src="m.avatarUrl"
                  :style="!m.avatarUrl ? avatarStyle(m.name) : {}"
                  class="m-avatar"
                >
                  {{ (m.name || '?').slice(0, 1) }}
                </el-avatar>
                <div class="m-meta">
                  <span class="m-name">{{ m.name }}</span>
                  <span class="m-title">{{ m.jobTitle || '—' }}</span>
                </div>
                <div class="m-status" :class="m.isActive ? 'on' : 'off'">
                  <span class="status-dot"></span>{{ m.isActive ? '在职' : '停用' }}
                </div>
              </div>

              <div class="m-rows">
                <div class="m-row">
                  <span class="m-label">工号</span>
                  <span class="m-val">{{ m.employeeId || '—' }}</span>
                </div>
                <div class="m-row">
                  <span class="m-label">角色</span>
                  <span class="m-val roles">
                    <el-tag
                      v-for="r in m.roles"
                      :key="r"
                      size="small"
                      :type="roleType(r)"
                      effect="light"
                      round
                      class="m-role"
                    >
                      {{ roleLabel(r) }}
                    </el-tag>
                    <span v-if="!(m.roles || []).length" class="no-role">未分配</span>
                  </span>
                </div>
                <div class="m-row">
                  <span class="m-label">负责部门</span>
                  <span class="m-val roles">
                    <el-tag
                      v-for="d in m.headDepts"
                      :key="d.id"
                      size="small"
                      type="success"
                      effect="light"
                      round
                      class="m-role"
                    >{{ d.name }}</el-tag>
                    <span v-if="!(m.headDepts || []).length" class="no-role">—</span>
                  </span>
                </div>
              </div>

              <div v-if="canManageUsers" class="card-actions">
                <el-button size="small" type="primary" text @click="openEdit(m)">分配角色</el-button>
                <el-divider direction="vertical" />
                <el-button size="small" text @click="toggleActive(m)">
                  {{ m.isActive ? '停用' : '启用' }}
                </el-button>
              </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>

    <!-- 单点分配角色 -->
    <el-dialog v-if="canManageUsers" v-model="dialogVisible" title="分配角色" width="420px" align-center>
      <p class="dialog-tip">为 <b>{{ editing?.name }}</b> 分配系统角色（仅本系统权限）</p>
      <el-checkbox-group v-model="editRoles" class="role-options">
        <el-checkbox v-for="r in allRoles" :key="r.value" :value="r.value">{{ r.label }}</el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRoles">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量分配角色 -->
    <el-dialog v-if="canManageUsers" v-model="batchDialogVisible" title="按部门批量分配角色" width="460px" align-center>
      <p class="dialog-tip">为该部门<b>所有在职成员</b>统一设置角色（覆盖原角色）</p>
      <el-form label-width="70px">
        <el-form-item label="部门">
          <DeptSelect v-model="batchDeptId" :items="deptOptions" placeholder="选择部门" style="width:100%" />
        </el-form-item>
        <el-form-item label="角色">
          <el-checkbox-group v-model="batchRoles" class="role-options">
            <el-checkbox v-for="r in allRoles" :key="r.value" :value="r.value">{{ r.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchLoading" @click="saveBatch">批量分配</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.users-wrap {
  --brand: var(--color-primary);
  --brand-light: #eaf1ff;
  --ink: #1f2733;
  --ink-2: #4b5563;
  --ink-3: #8a94a6;
  --line: #eef1f5;
  --surface: #fff;
}

.overview-bar {
  display: flex; align-items: center; gap: 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 22px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(16,24,40,.03);
}
.ov-item { display: flex; align-items: baseline; gap: 8px; }
.ov-num { font-size: 24px; font-weight: 700; color: var(--brand); }
.ov-num.warn { color: var(--color-warning); }
.ov-label { font-size: 13px; color: var(--ink-3); }
.ov-divider { width: 1px; height: 22px; background: var(--line); }

.users-main {
  display: grid;
  grid-template-columns: 270px 1fr;
  gap: 14px;
  align-items: start;
}

/* 左侧树 */
.tree-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  position: sticky; top: 0;
  overflow: hidden;
}
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
}
.panel-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.tree-body { max-height: calc(100vh - 210px); overflow: auto; padding: 0 8px 10px; }

.all-row {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer;
  font-size: 13px; color: var(--ink-2);
  margin: 2px 0 4px;
}
.all-row:hover { background: #f3f6fb; }
.all-row.active { background: var(--brand-light); color: var(--brand); font-weight: 500; }
.all-ico { color: var(--brand); font-size: 15px; }
.all-name { flex: 1; }

.tn-row {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 9px; border-radius: 8px; cursor: pointer;
  font-size: 13px; color: var(--ink-2);
  transition: background .14s ease;
}
.tn-row:hover { background: #f3f6fb; }
.tn-row.active { background: var(--brand-light); color: var(--brand); font-weight: 500; }
.tn-twist { width: 16px; display: inline-flex; justify-content: center; color: var(--ink-3); flex-shrink: 0; }
.tn-ico { color: var(--brand); font-size: 15px; flex-shrink: 0; }
.tn-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tn-badge {
  font-size: 11px; color: var(--ink-3);
  background: #f1f4f9; border-radius: 9px;
  padding: 0 7px; line-height: 18px; min-width: 20px; text-align: center; flex-shrink: 0;
}
.tn-row.active .tn-badge, .all-row.active .tn-badge { background: rgba(51,112,255,.12); color: var(--brand); }

/* 右侧成员卡片 */
.member-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  min-width: 0;
}
.member-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}
.member-title { display: flex; align-items: baseline; gap: 10px; }
.member-title h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink); }
.member-sub { font-size: 13px; color: var(--ink-3); }
.toolbar-actions { display: flex; align-items: center; gap: 10px; }
.search-box { width: 230px; }

.member-body { padding: 16px 18px; min-height: 300px; }
.member-sections { display: flex; flex-direction: column; gap: 18px; }
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.section-head.compact { margin-top: 2px; }
.section-head h4 {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}
.section-head p {
  margin: 4px 0 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.45;
}
.member-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 12px;
}
.mock-users-section {
  border: 1px dashed #f4c36a;
  border-radius: 14px;
  background: #fffaf0;
  padding: 14px;
}
.mock-users-section.collapsed {
  background: #fffaf0;
}
.mock-section-head {
  align-items: center;
}
.mock-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.mock-toggle {
  color: var(--color-warning);
  font-weight: 700;
}
.mock-toggle .el-icon {
  margin-right: 4px;
}
.mock-collapsed-tip {
  padding: 9px 12px;
  border: 1px solid #f3dfbc;
  border-radius: 10px;
  color: #8a6128;
  background: rgba(255, 255, 255, .62);
  font-size: 12px;
  line-height: 1.6;
}
.mock-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.member-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
  display: flex; flex-direction: column;
}
.mock-member-card {
  background: rgba(255, 255, 255, .86);
  border-color: rgba(244, 195, 106, .55);
}
.member-card:hover {
  border-color: rgba(40, 129, 116, .28);
  box-shadow: 0 4px 14px rgba(40, 129, 116, .10);
  transform: translateY(-1px);
}

.card-top { display: flex; align-items: center; gap: 11px; }
.m-avatar { flex-shrink: 0; font-weight: 600; font-size: 16px; }
.m-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.m-name { font-size: 15px; font-weight: 600; color: var(--ink); }
.m-title { font-size: 12.5px; color: var(--ink-3); margin-top: 1px; }
.m-status {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; flex-shrink: 0;
}
.m-status.on { color: #15803d; }
.m-status.off { color: var(--ink-3); }
.status-dot { width: 7px; height: 7px; border-radius: 50%; }
.m-status.on .status-dot { background: var(--color-success); }
.m-status.off .status-dot { background: #c3cad4; }

.m-rows { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.m-row { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; }
.mock-dept-row { align-items: center; }
.m-label { color: var(--ink-3); width: 34px; flex-shrink: 0; }
.m-val { color: var(--ink-2); min-width: 0; overflow-wrap: anywhere; }
.m-val.roles { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.m-role { font-size: 11px; padding: 0 6px; }
.no-role { color: var(--ink-3); }
.mock-dept-select { flex: 1; min-width: 0; }

.card-actions {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line);
  display: flex; align-items: center; gap: 4px;
}

.dialog-tip { color: var(--ink-2); font-size: 13px; margin: 0 0 14px; }
.role-options { display: flex; flex-wrap: wrap; gap: 12px; }
</style>
