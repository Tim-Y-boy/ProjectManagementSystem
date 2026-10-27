<script setup lang="ts">
import { computed, onActivated, onMounted, ref, shallowRef } from 'vue';
import { operationLogsApi, usersApi } from '@/api';
import { Document, Refresh, Search } from '@element-plus/icons-vue';
import { toNumericId } from '@/utils/ids';
import { useRefreshStore, type RefreshSnapshot } from '@/stores/refresh';
import SmartSelect from '@/components/SmartSelect.vue';
import { LOG_ACTION_META as ACTION_META, logActionMeta, logNote } from '@/utils/task-log';

const refreshStore = useRefreshStore();
const loading = ref(false);
const logs = ref<any[]>([]);
const projects = ref<any[]>([]);
const users = ref<any[]>([]);
const projectItems = computed(() => projects.value.map((p: any) => ({ value: toNumericId(p.id), label: `${p.name}${p.deleted ? '（已删除）' : ''}` })));
const selectedLog = shallowRef<any | null>(null);
const detailVisible = shallowRef(false);
const hasLoaded = shallowRef(false);
const referenceLoaded = shallowRef(false);
const seenRefreshVersions = shallowRef<RefreshSnapshot>(refreshStore.snapshot());
const LOG_TABLE_MAX_HEIGHT = 460;
const LOG_QUERY_LIMIT = 300;
const DEFAULT_PAGE_SIZE = 30;
const defaultLogRangeTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 0, 0, 0),
];

const filterProject = ref<number | null>(null);
const filterAction = ref('');
const filterDateRange = shallowRef<[string, string] | null>(null);
const currentPage = ref(1);
const pageSize = ref(DEFAULT_PAGE_SIZE);
const logTotal = ref(0);

// 统计数字滚动（纯展示，不影响 logTotal 本身）
const logAnimated = ref<{ total: number; critical: number; shown: number }>({ total: 0, critical: 0, shown: 0 });
let logRAF = 0;
function animateLogs(to: { total: number; critical: number; shown: number }, duration = 700) {
  cancelAnimationFrame(logRAF);
  const from = { ...logAnimated.value };
  const start = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const p = Math.min((now - start) / duration, 1);
    const e = ease(p);
    logAnimated.value = {
      total: Math.round(from.total + (to.total - from.total) * e),
      critical: Math.round(from.critical + (to.critical - from.critical) * e),
      shown: Math.round(from.shown + (to.shown - from.shown) * e),
    };
    if (p < 1) logRAF = requestAnimationFrame(step);
  };
  logRAF = requestAnimationFrame(step);
}

const STATUS_META: Record<string, string> = {
  pending_confirm: '待确认',
  todo: '待办',
  doing: '进行中',
  pending_accept: '待验收',
  done: '已完成',
  rejected: '已退回',
  cancelled: '已取消',
};

const actionOptions = computed(() =>
  Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.label })),
);

const criticalCount = computed(() =>
  logs.value.filter((row) => ['delete', 'reject', 'plan_change'].includes(row.action)).length,
);

const selectedProjectName = computed(() =>
  projects.value.find((project) => String(project.id) === String(filterProject.value))?.name || '',
);
const operationLogQuery = computed(() => ({
  projectId: filterProject.value || undefined,
  action: filterAction.value || undefined,
  startDate: filterDateRange.value?.[0] || undefined,
  endDate: filterDateRange.value?.[1] || undefined,
  limit: LOG_QUERY_LIMIT,
  page: currentPage.value,
  pageSize: pageSize.value,
}));

const statusLabel = (status: string | null) => (status ? STATUS_META[status] || status : '');
const operatorName = (row: any) =>
  row.operatorName || users.value.find((u) => String(u.id) === String(row.operatorId))?.name || `用户 #${row.operatorId}`;

function formatTime(value: string) {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function rowIndex(index: number) {
  return (currentPage.value - 1) * pageSize.value + index + 1;
}

const hiddenLegacyFields = new Set(['deliverable', 'priority']);

function visibleLogChanges(payload: Record<string, any> | null) {
  return Array.isArray(payload?.changes)
    ? payload.changes.filter((change: any) => !hiddenLegacyFields.has(change.field))
    : [];
}

function formatChangeValue(change: { field: string; value: any }) {
  const value = change.value;
  if (value == null || value === '') return '未设置';
  if (change.field === 'assigneeIds' || change.field === 'acceptorIds') {
    const ids = Array.isArray(value) ? value : [];
    if (!ids.length) return '未分配';
    return ids
      .map((id: number) => users.value.find((user) => String(user.id) === String(id))?.name || `用户 #${id}`)
      .join('、');
  }
  return String(value);
}

function payloadText(payload: Record<string, any> | null) {
  if (!payload) return '—';
  const changes = visibleLogChanges(payload);
  if (changes.length) {
    return changes
      .map((change: any) => `${change.label}：${formatChangeValue({ field: change.field, value: change.after })}`)
      .join('；');
  }
  if (payload.changeType === 'delete') return `删除${payload.changeId ? `，变更单 #${payload.changeId}` : ''}`;
  if (payload.changeType === 'add') return '新增任务';
  if (payload.changeType === 'date') return '调整日期';
  if (payload.changeType === 'assignee') return '调整执行人';
  if (payload.changeType === 'acceptor') return '调整负责人';
  if (payload.reason) return payload.reason;
  if (payload.title) return payload.title;
  return '—';
}

function payloadDetail(payload: Record<string, any> | null) {
  const changes = visibleLogChanges(payload);
  if (!payload || !changes.length) return '';
  return changes
    .map((change: any) => `${change.label}：${formatChangeValue({ field: change.field, value: change.before })} → ${formatChangeValue({ field: change.field, value: change.after })}`)
    .join('；');
}

const logSummary = (row: any) => logNote(row) || payloadDetail(row.payload) || payloadText(row.payload);

function openLogDetail(row: any) {
  selectedLog.value = row;
  detailVisible.value = true;
}

async function ensureReferenceData() {
  const [projectRows, userRows] = await Promise.all([
    operationLogsApi.projects(),
    referenceLoaded.value ? Promise.resolve(users.value) : usersApi.list(),
  ]);
  projects.value = projectRows;
  users.value = userRows;
  referenceLoaded.value = true;
}

function applyLogPayload(payload: any) {
  if (Array.isArray(payload)) {
    logs.value = payload;
    logTotal.value = payload.length;
    return;
  }
  if (Array.isArray(payload?.groups)) {
    const mergedLogs = payload.groups.flatMap((group: any) => group.logs ?? group.items ?? []);
    logs.value = mergedLogs;
    logTotal.value = Number(payload.total ?? mergedLogs.length);
    return;
  }
  logs.value = payload?.items ?? [];
  logTotal.value = Number(payload?.total ?? logs.value.length);
}

async function load() {
  loading.value = true;
  try {
    await ensureReferenceData();
    if (!filterProject.value) {
      logs.value = [];
      logTotal.value = 0;
      seenRefreshVersions.value = refreshStore.snapshot();
      hasLoaded.value = true;
      animateLogs({ total: 0, critical: criticalCount.value, shown: 0 });
      return;
    }
    const [logPayload] = await Promise.all([
      operationLogsApi.list(operationLogQuery.value),
    ]);
    applyLogPayload(logPayload);
    seenRefreshVersions.value = refreshStore.snapshot();
    hasLoaded.value = true;
    animateLogs({ total: logTotal.value, critical: criticalCount.value, shown: logs.value.length });
  } finally {
    loading.value = false;
  }
}

function reloadFromFirstPage() {
  currentPage.value = 1;
  load();
}

function handlePageChange(page: number) {
  currentPage.value = page;
  load();
}

function handlePageSizeChange(size: number) {
  pageSize.value = size;
  currentPage.value = 1;
  load();
}

onMounted(load);

onActivated(() => {
  if (!hasLoaded.value) return;
  if (refreshStore.isStale(seenRefreshVersions.value, ['project', 'task', 'planChange'])) load();
});
</script>

<template>
  <div class="logs-page">
    <el-card class="logs-card">
      <template #header>
        <div class="card-header">
          <div class="title-block">
            <span class="title-icon">
              <el-icon><Document /></el-icon>
            </span>
            <div>
              <div class="card-title">操作日志</div>
              <div class="card-subtitle">请选择具体项目后查看最近 300 条操作记录，可追溯任务开始、验收、退回及计划变更。</div>
            </div>
          </div>
          <el-button :loading="loading" @click="reloadFromFirstPage">
            <el-icon style="margin-right: 4px"><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>

      <div class="query-panel">
        <div class="query-title">
          <el-icon><Search /></el-icon>
          查询条件
        </div>
        <div class="logs-filters">
          <SmartSelect v-model="filterProject" :items="projectItems" placeholder="选择项目" clearable class="filter-project" @change="reloadFromFirstPage" />
          <el-select v-model="filterAction" placeholder="动作类型" clearable class="filter-action" @change="reloadFromFirstPage">
            <el-option v-for="a in actionOptions" :key="a.value" :label="a.label" :value="a.value" />
          </el-select>
          <el-date-picker
            v-model="filterDateRange"
            type="datetimerange"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm"
            :default-time="defaultLogRangeTime"
            unlink-panels
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            class="filter-date-range"
            style="width: 400px; max-width: 400px; flex: 0 0 400px"
            @change="reloadFromFirstPage"
          />
        </div>
      </div>

      <div v-if="filterProject" class="summary-strip">
        <div class="summary-item">
          <span class="summary-num">{{ logAnimated.total }}</span>
          <span class="summary-label">匹配记录</span>
        </div>
        <div class="summary-item warn">
          <span class="summary-num">{{ logAnimated.critical }}</span>
          <span class="summary-label">本页关键</span>
        </div>
        <div class="summary-item compact">
          <span class="summary-num">{{ logAnimated.shown }}</span>
          <span class="summary-label">当前页</span>
        </div>
        <div class="summary-hint" :title="selectedProjectName">当前项目：{{ selectedProjectName || '已选择项目' }}</div>
      </div>

      <div v-if="!filterProject" class="logs-empty-guide">
        <el-empty description="请选择具体项目后查看操作日志" :image-size="110">
          <template #description>
            <div class="empty-guide-text">
              <strong>默认不展示项目日志</strong>
              <span>请先在上方选择一个项目，再按动作类型或时间段进一步查询。</span>
            </div>
          </template>
        </el-empty>
      </div>

      <div v-else v-loading="loading" class="logs-table-wrap">
        <el-table :data="logs" border stripe class="logs-table" :max-height="LOG_TABLE_MAX_HEIGHT">
          <el-table-column label="序号" type="index" :index="rowIndex" width="76" align="center" />
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-tag :type="logActionMeta(row).type" size="small">{{ logActionMeta(row).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="任务" min-width="210" show-overflow-tooltip>
            <template #default="{ row }">{{ row.taskTitle || `任务 #${row.taskId}` }}</template>
          </el-table-column>
          <el-table-column label="操作人" width="130">
            <template #default="{ row }">{{ operatorName(row) }}</template>
          </el-table-column>
          <el-table-column label="状态变化" width="168">
            <template #default="{ row }">
              <span v-if="row.fromStatus" class="status-flow">
                {{ statusLabel(row.fromStatus) }}
                <span class="arrow">→</span>
                {{ statusLabel(row.toStatus) }}
              </span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作说明" min-width="300" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ logSummary(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="详情" width="110" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" plain @click="openLogDetail(row)">查看详情</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="logTotal > pageSize" class="log-pagination">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[20, 30, 50, 100]"
            :total="logTotal"
            :disabled="loading"
            layout="total, sizes, prev, pager, next, jumper"
            background
            @current-change="handlePageChange"
            @size-change="handlePageSizeChange"
          />
        </div>
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="操作详情" width="680px" align-center>
      <div v-if="selectedLog" class="log-detail">
        <div class="detail-meta">
          <div><span>项目</span><strong :title="selectedLog.projectName || '未关联项目'">{{ selectedLog.projectName || '未关联项目' }}</strong></div>
          <div><span>任务</span><strong :title="selectedLog.taskTitle || `任务 #${selectedLog.taskId}`">{{ selectedLog.taskTitle || `任务 #${selectedLog.taskId}` }}</strong></div>
          <div><span>操作人</span><strong :title="operatorName(selectedLog)">{{ operatorName(selectedLog) }}</strong></div>
          <div><span>时间</span><strong>{{ formatTime(selectedLog.createdAt) }}</strong></div>
        </div>

        <div class="detail-action">
          <span>操作</span>
          <el-tag :type="logActionMeta(selectedLog).type" size="small">{{ logActionMeta(selectedLog).label }}</el-tag>
        </div>

        <div v-if="selectedLog.fromStatus" class="detail-action">
          <span>状态变化</span>
          <strong class="status-flow">{{ statusLabel(selectedLog.fromStatus) }} → {{ statusLabel(selectedLog.toStatus) }}</strong>
        </div>

        <div v-if="visibleLogChanges(selectedLog.payload).length" class="change-list">
          <div v-for="change in visibleLogChanges(selectedLog.payload)" :key="change.field" class="change-row">
            <span class="change-label">{{ change.label }}</span>
            <span class="change-value" :title="formatChangeValue({ field: change.field, value: change.before })">{{ formatChangeValue({ field: change.field, value: change.before }) }}</span>
            <span class="arrow">→</span>
            <span class="change-value change-value-after" :title="formatChangeValue({ field: change.field, value: change.after })">{{ formatChangeValue({ field: change.field, value: change.after }) }}</span>
          </div>
        </div>
        <div v-else class="legacy-detail">{{ logSummary(selectedLog) }}</div>
        <div v-if="selectedLog.payload?.requestedAt" class="detail-meta">
          <div><span>申请人</span><strong>{{ operatorName({ operatorId: selectedLog.payload.requesterId }) }}</strong></div>
          <div><span>申请时间</span><strong>{{ formatTime(selectedLog.payload.requestedAt) }}</strong></div>
          <template v-if="selectedLog.payload.reviewedAt">
            <div><span>审批人</span><strong>{{ operatorName({ operatorId: selectedLog.payload.approverId }) }}</strong></div>
            <div><span>审批时间</span><strong>{{ formatTime(selectedLog.payload.reviewedAt) }}</strong></div>
          </template>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.logs-card :deep(.el-card__header::before) { display: none; }

.logs-page {
  min-width: 0;
}

.logs-card {
  border-radius: var(--radius-lg);
}

.logs-card :deep(.el-card__body) {
  overflow-x: auto;
}

.card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}

.title-block {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.title-icon {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--brand);
  background: var(--brand-light);
}

.card-title {
  color: var(--text-1);
  font-size: 18px;
  font-weight: 800;
}

.card-subtitle {
  margin-top: 3px;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.5;
  text-wrap: pretty;
}

.query-panel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  margin-bottom: 14px;
  border: 1px solid #e6ecea;
  border-radius: var(--radius-md);
  background: #f8fbfa;
}

.query-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #52615d;
  font-weight: 700;
}

.logs-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-start;
  min-width: 0;
}

.filter-project {
  width: 240px;
}

.filter-action {
  width: 150px;
}

.filter-date-range {
  flex: 0 0 400px !important;
  width: 400px !important;
  max-width: 400px;
}

.filter-date-range :deep(.el-range-input) {
  width: 148px;
}

.filter-date-range :deep(.el-range-separator) {
  flex: 0 0 20px;
  padding: 0;
}

@media (max-width: 920px) {
  .filter-date-range {
    flex-basis: 100% !important;
    width: 100% !important;
    max-width: 100%;
  }
}

.summary-strip {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 14px;
  border-radius: var(--radius-md);
  background: var(--brand-light);
}

.summary-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.summary-num {
  color: var(--brand);
  font-size: 22px;
  font-weight: 900;
}

.summary-label {
  color: var(--text-2);
  font-size: 13px;
  font-weight: 700;
}

.summary-item.warn .summary-num {
  color: var(--warning);
}

.summary-item.compact .summary-num {
  color: #0f9f8f;
  font-size: 18px;
}

.summary-hint {
  flex: 1 1 360px;
  min-width: 260px;
  margin-left: auto;
  color: var(--text-3);
  font-size: 13px;
}

.logs-empty-guide {
  display: grid;
  place-items: center;
  min-height: 300px;
  border: 1px dashed #cfe4de;
  border-radius: var(--radius-md);
  background: #f8fbfa;
}

.empty-guide-text {
  display: grid;
  gap: 6px;
  color: var(--text-3);
  line-height: 1.6;
  text-align: center;
}

.empty-guide-text strong {
  color: var(--text-1);
  font-size: 15px;
}

.logs-table-wrap {
  overflow: hidden;
  border: 1px solid #e3ebe8;
  border-radius: var(--radius-md);
  background: #fff;
}

.logs-table-wrap :deep(.el-table) {
  border: 0;
}

.logs-table-wrap :deep(.el-table__body-wrapper) {
  overscroll-behavior: contain;
}

.log-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 12px 14px;
  border-top: 1px solid #eef3f1;
  background: #fbfdfc;
}

.summary-link {
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-detail {
  display: grid;
  gap: 18px;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #f7fbfa;
}

.detail-meta div,
.detail-action {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.detail-meta span,
.detail-action > span {
  flex: none;
  color: var(--text-3);
  font-size: 13px;
}

.detail-meta strong,
.detail-action strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-list {
  display: grid;
  gap: 10px;
}

.change-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #e5ecea;
  border-radius: 9px;
  background: #fff;
}

.change-label {
  color: var(--text-2);
  font-size: 13px;
  font-weight: 700;
}

.change-value {
  min-width: 0;
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.change-value-after {
  color: var(--brand);
  font-weight: 700;
}

.legacy-detail {
  white-space: pre-wrap;
  padding: 14px 16px;
  border-radius: 9px;
  color: var(--text-2);
  background: #f7fbfa;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.logs-table {
  width: 100%;
}

.status-flow {
  color: var(--text-2);
  font-weight: 600;
}

.arrow {
  margin: 0 6px;
  color: var(--brand);
}

.muted {
  color: var(--text-3);
}

@media (max-width: 760px) {
  .card-header,
  .query-panel {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }

  .summary-strip {
    align-items: flex-start;
  }

  .summary-hint {
    margin-left: 0;
  }

  .detail-meta {
    grid-template-columns: 1fr;
  }

  .change-row {
    grid-template-columns: 1fr;
    gap: 5px;
  }

  .change-row .arrow {
    display: none;
  }
}
</style>
