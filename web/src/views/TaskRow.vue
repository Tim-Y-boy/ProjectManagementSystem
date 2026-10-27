<script setup lang="ts">
// 递归任务行组件：自己 + 子任务容器（带动画），任意层级
import { computed } from 'vue';
import { ElMessageBox } from 'element-plus';
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { deriveTaskRange } from '@/utils/task-dates';
import { completionDays } from '@/utils/task-risk';
import TaskCompletionTag from '@/components/TaskCompletionTag.vue';
// 自引用以支持递归
import TaskRow from './TaskRow.vue';

const props = defineProps<{
  task: any;
  depth: number;
  siblingIndex?: number;
  collapsedTasks: Set<number>;
  projectLocked: boolean;
  projectFrozen?: boolean;
  isProjectOwner: boolean;
  userName: (id: number | null) => string;
  statusLabel: (s: string) => string;
  statusType: (s: string) => any;
  pct: (v: unknown) => number;
  openDetail: (t: any, tab?: string) => void;
  openCreate: (t: any) => void;
  openEdit: (t: any) => void;
  confirm: (t: any) => void;
  reject: (t: any) => void;
  act: (t: any, to: string, comment?: string) => void;
  removeTask: (t: any) => void;
  isAdminLeader: boolean;
  editableProjectIds: Set<number>;
  creatableProjectIds: Set<number>;
  draggingTaskId?: number | null;
  dragTask?: (task: any | null) => void;
  dropTask?: (task: any) => void;
}>();

const emit = defineEmits<{
  (e: 'toggle', id: number): void;
  (e: 'refresh'): void;
}>();

// 折叠动画钩子：动画结束后清理内联 height，避免残留固定高度导致下方不上移
function onEnter(el: Element) {
  const e = el as HTMLElement;
  e.style.height = '0px';
  e.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    e.style.height = e.scrollHeight + 'px';
    e.addEventListener('transitionend', () => {
      // 临时关闭过渡把高度设为 auto，避免残留固定高度，且不触发二次过渡闪烁
      e.style.transition = 'none';
      e.style.height = 'auto';
      void e.offsetHeight; // 强制回流
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
    // 离开动画后元素会 display:none，无需清理 height，避免重排闪烁
  });
}

// 结构层级只用一个青色相，靠深浅区分深度（不再混蓝/紫/橙等色）
const DEPTH_COLORS = ['#1e6258', '#237266', '#288174', '#2e8b7e', '#38a090', '#3fb1a1', '#52c1b1'];
const depthColor = (d: number) => DEPTH_COLORS[d % DEPTH_COLORS.length];
const isCollapsed = (id: number) => props.collapsedTasks.has(id);
const isParentTask = () => !!props.task.children?.length;
// 退回验收：弹窗输入退回原因，确认后带原因退回（原因会进验收退回通知）
async function rejectAcceptance(task: any) {
  try {
    const { value } = await ElMessageBox.prompt('请输入退回原因（验收不通过的原因），接收人将在通知里看到', '退回验收', {
      confirmButtonText: '退回',
      cancelButtonText: '取消',
      inputPlaceholder: '如：测试数据不完整，请补充后再提交',
      inputValidator: (v: string) => (v?.trim() ? true : '请填写退回原因'),
    });
    props.act(task, 'doing', value?.trim() || '');
  } catch {
    /* 取消则不操作 */
  }
}
// 日期范围：父任务取子任务最早开始~最晚结束（叶子=自身）
const dateRange = computed(() => deriveTaskRange(props.task));
const rowStyle = computed(() => ({
  '--task-indent': `${Math.min(props.depth * 24, 120)}px`,
  '--mobile-indent': `${Math.min(props.depth * 16, 48)}px`,
  '--task-actions-width': props.projectLocked ? '224px' : '360px',
  '--depth-color': depthColor(props.depth),
}));
const riskLabel = computed(() => {
  if (props.task._risk === 2) {
    const days = Number(props.task._maxOverdueDays || 0);
    if (isParentTask()) return `含 ${props.task._overdue} 项延期${days ? ` · 最长 ${days} 天` : ''}`;
    return days ? `延期 ${days} 天` : '已延期';
  }
  if (props.task._risk === 1) {
    if (isParentTask()) return `含 ${props.task._atRisk} 项临期`;
    const days = Number(props.task._nearestDueDays);
    return days === 0 ? '今日到期' : `${days} 天后到期`;
  }
  return '';
});
// 完成是否标"延期"（口径与项目总览 nodeState 一致）：
//  叶子 → done 且完成时刻晚于自身截止日（合理补填则降级为"延期合理补填"，不加⚠️）；
//  父节点 → 不读父级自己存的日期（可能与子任务脱节而误标），一律按子任务递归聚合——
//            子任务都按期 → 不标；有未补填的迟到子任务 → 延期完成；迟到子任务全部合理补填 → 延期合理补填。
function lateDoneState(node: any): { late: boolean; supplemented: boolean } {
  if (node.status !== 'done') return { late: false, supplemented: false };
  const children = (node.children ?? []).filter(
    (c: any) => c.status !== 'cancelled',
  );
  if (!children.length) {
    const days = completionDays(node);
    const late = days != null && days < 0;
    return late
      ? { late: true, supplemented: !!node.reasonableSupplement }
      : { late: false, supplemented: false };
  }
  // 父节点：只有直接子任务都完成才算父完成；延期状态递归自子任务
  if (!children.every((c: any) => c.status === 'done')) return { late: false, supplemented: false };
  let plain = false;
  let supplemented = false;
  for (const c of children) {
    const st = lateDoneState(c);
    if (!st.late) continue;
    if (st.supplemented) supplemented = true;
    else plain = true;
  }
  return { late: plain || supplemented, supplemented: plain ? false : supplemented };
}
const lateDone = computed(() => lateDoneState(props.task));
const lateDoneLabel = computed(() => (lateDone.value.supplemented ? '延期合理补填' : '延期完成'));
const taskAssigneeIds = computed(() => {
  const ids = new Set<number>();
  if (Array.isArray(props.task.assigneeIds)) {
    for (const id of props.task.assigneeIds) ids.add(Number(id));
  }
  if (props.task.assigneeId != null) ids.add(Number(props.task.assigneeId));
  return ids;
});
const taskAcceptorIds = computed(() => {
  const ids = new Set<number>();
  if (Array.isArray(props.task.acceptorIds)) {
    for (const id of props.task.acceptorIds) ids.add(Number(id));
  }
  if (props.task.acceptorId != null) ids.add(Number(props.task.acceptorId));
  return ids;
});
const taskAssigneeNames = computed(() => namesOf([...taskAssigneeIds.value]));
const taskAcceptorNames = computed(() => namesOf([...taskAcceptorIds.value]));
const dateRangeText = computed(() => `${dateRange.value.startAt || '未设'} → ${dateRange.value.dueAt || '未设'}`);

// 可编辑判定：admin/leader 或本任务的执行人/负责人/创建者（与后端 updateTask/transition 口径一致）
const auth = useAuthStore();
const uid = computed(() => auth.user?.id);
const isParticipant = computed(() => {
  const t = props.task;
  return (
    taskAssigneeIds.value.has(Number(uid.value)) ||
    taskAcceptorIds.value.has(Number(uid.value)) ||
    String(t.creatorId) === String(uid.value)
  );
});
// 可编辑（编辑/加子任务）：admin/leader，或本部门可管理的项目（dept_head），或本任务的执行人/负责人/创建者
const canEditTask = computed(
  () => auth.has('admin') || auth.has('leader') || props.isProjectOwner || props.editableProjectIds.has(Number(props.task.projectId)) || isParticipant.value,
);
// 项目负责人和本任务负责人均可执行和录入；验收仍由任务验收负责人处理。
const canWorkTask = computed(() =>
  auth.has('admin') ||
  auth.has('leader') ||
  props.isProjectOwner ||
  String(props.task.creatorId) === String(uid.value) ||
  taskAssigneeIds.value.has(Number(uid.value)) ||
  taskAcceptorIds.value.has(Number(uid.value)),
);
const canReviewTask = computed(() =>
  auth.has('admin') ||
  auth.has('leader') ||
  taskAcceptorIds.value.has(Number(uid.value)),
);
const canRestoreTask = computed(() => canReviewTask.value || props.isProjectOwner || taskAssigneeIds.value.has(Number(uid.value)));
// 可删除：admin/leader，或本部门可管理的项目（dept_head）
const canDeleteTask = computed(
  () => auth.has('admin') || auth.has('leader') || props.editableProjectIds.has(Number(props.task.projectId)),
);
const canCreateChildTask = computed(() => props.creatableProjectIds.has(Number(props.task.projectId)));
const canDragTask = computed(() => !props.projectFrozen && !props.projectLocked && props.creatableProjectIds.has(Number(props.task.projectId)));

const canFillProcess = () => !isParentTask() && props.projectLocked && ['doing', 'done'].includes(props.task.status) && canEditTask.value;

// 多个 id 转名字
function namesOf(ids: number[]) {
  if (!ids?.length) return '—';
  return ids.map((id) => props.userName(id)).filter((n) => n && n !== '—').join('、') || '—';
}
</script>

<template>
  <div class="tr-block">
    <div
      class="task-row"
      :data-task-id="String(task.id)"
      :class="[
        task.children?.length || depth === 0 ? 'parent-row' : 'child-row',
        { 'nested-row': depth > 0, 'is-dragging': draggingTaskId === task.id, 'is-drop-ready': canDragTask },
      ]"
      :style="rowStyle"
      @dragover.prevent
      @drop.stop="canDragTask && dropTask?.(task)"
    >
      <div class="row-primary">
        <button
          v-if="canDragTask"
          class="drag-handle"
          type="button"
          draggable="true"
          title="拖动调整同级任务顺序"
          aria-label="拖动调整同级任务顺序"
          @dragstart.stop="dragTask?.(task)"
          @dragend.stop="dragTask?.(null)"
        >
          ⋮⋮
        </button>
        <button
          v-if="task.children?.length"
          class="fold-button"
          type="button"
          :aria-label="isCollapsed(task.id) ? '展开子任务' : '收起子任务'"
          @click.stop="emit('toggle', task.id)"
        >
          <el-icon><ArrowDown v-if="!isCollapsed(task.id)" /><ArrowRight v-else /></el-icon>
        </button>
        <span v-else class="fold-spacer" aria-hidden="true"></span>
        <span v-if="depth > 0" class="child-number" aria-hidden="true">{{ (siblingIndex ?? 0) + 1 }}</span>
        <span v-else class="type-dot" aria-hidden="true"></span>
        <span class="row-title" :title="task.title">{{ task.title }}</span>
        <span v-if="task.children?.length" class="child-count" :title="`${task.children.length} 个子任务`">{{ task.children.length }} 项</span>
      </div>
      <div class="row-status">
        <el-tag :type="statusType(task.status)" size="small" round>{{ statusLabel(task.status) }}</el-tag>
      </div>
      <div class="row-meta">
        <span class="meta-item owner-meta">
          <span class="meta-label">负责人</span>
          <strong class="meta-value" :title="taskAcceptorNames">{{ taskAcceptorNames }}</strong>
        </span>
        <span class="meta-item assignee-meta">
          <span class="meta-label">执行人</span>
          <span class="meta-value" :title="taskAssigneeNames">{{ taskAssigneeNames }}</span>
        </span>
        <span class="meta-item schedule-meta" :class="{ overdue: !isParentTask() && task._risk === 2 }">
          <span class="meta-label">计划</span>
          <span class="meta-value" :title="dateRangeText">{{ dateRangeText }}</span>
        </span>
      </div>
      <div class="row-indicators">
        <TaskCompletionTag :task="task" />
        <el-tag v-if="task._risk === 2" class="risk-tag" :title="riskLabel" type="danger" size="small" round effect="dark">{{ riskLabel }}</el-tag>
        <el-tag v-else-if="task._risk === 1" class="risk-tag" :title="riskLabel" type="warning" size="small" round effect="dark">{{ riskLabel }}</el-tag>
        <el-tag v-if="lateDone.late" class="risk-tag" :type="lateDone.supplemented ? 'info' : 'danger'" size="small" round effect="dark">
          {{ lateDoneLabel }}<template v-if="!lateDone.supplemented"> ⚠️</template>
        </el-tag>
      </div>
      <div class="row-right">
        <div v-if="task.children?.length" class="row-prog">
          <el-progress
            :percentage="pct(task.progress)"
            :stroke-width="6"
            :show-text="false"
            :color="task.progress >= 1 ? '#288174' : depthColor(depth)"
          />
          <span class="prog-pct">{{ pct(task.progress) }}%</span>
        </div>
        <div class="row-actions">
          <el-button size="small" type="primary" plain @click.stop="openDetail(task)">详情</el-button>
          <template v-if="!projectFrozen">
          <el-button v-if="canFillProcess()" size="small" type="warning" plain @click.stop="openDetail(task, 'updates')">{{ task.status === 'done' ? '补进展' : '填进展' }}</el-button>
          <el-button v-if="!projectLocked && canEditTask" size="small" type="info" plain @click.stop="openEdit(task)">编辑</el-button>
          <el-button v-if="!projectLocked && canCreateChildTask" size="small" type="primary" @click.stop="openCreate(task)">+ 子任务</el-button>
          <el-button v-if="!isParentTask() && task.status === 'pending_confirm' && isAdminLeader" size="small" type="success" @click.stop="confirm(task)">确认</el-button>
          <el-button v-if="!isParentTask() && task.status === 'pending_confirm' && isAdminLeader" size="small" type="danger" plain @click.stop="reject(task)">退回</el-button>
          <el-button v-if="canWorkTask && !isParentTask() && task.status === 'todo' && projectLocked" size="small" type="primary" @click.stop="act(task, 'doing')">开始</el-button>
          <el-button v-if="canRestoreTask && !isParentTask() && task.status === 'rejected'" size="small" type="primary" plain @click.stop="act(task, 'todo')">恢复待办</el-button>
          <el-button v-if="canWorkTask && !isParentTask() && task.status === 'doing'" size="small" type="warning" @click.stop="act(task, 'pending_accept')">提交验收</el-button>
          <el-button v-if="canReviewTask && !isParentTask() && task.status === 'pending_accept'" size="small" type="success" @click.stop="act(task, 'done')">通过</el-button>
          <el-button v-if="canReviewTask && !isParentTask() && task.status === 'pending_accept'" size="small" type="danger" plain @click.stop="rejectAcceptance(task)">退回</el-button>
          <el-button v-if="task.canReopenCompleted && task.status === 'done' && !isParentTask() && projectLocked" size="small" type="danger" plain @click.stop="act(task, 'doing')">退回</el-button>
          <el-button v-if="canDeleteTask && !projectLocked" size="small" type="danger" plain @click.stop="removeTask(task)">删除</el-button>
          </template>
        </div>
      </div>
    </div>

    <!-- 子任务容器：带动画折叠 -->
    <Transition name="fold" @enter="onEnter" @leave="onLeave">
      <div v-show="task.children?.length && !isCollapsed(task.id)" class="tr-children">
        <TaskRow
          v-for="(c, index) in task.children"
          :key="c.id"
          :task="c"
          :depth="depth + 1"
          :sibling-index="index"
          :collapsed-tasks="collapsedTasks"
          :project-locked="projectLocked"
          :project-frozen="projectFrozen"
          :is-project-owner="isProjectOwner"
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
          :dragging-task-id="draggingTaskId"
          :drag-task="dragTask"
          :drop-task="dropTask"
          @toggle="emit('toggle', $event)"
          @refresh="emit('refresh')"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.task-row {
  position: relative;
  display: grid;
  grid-template-columns: calc(320px - var(--task-indent)) 68px minmax(412px, 1fr) 128px var(--task-actions-width);
  align-items: center;
  gap: 12px;
  margin-left: var(--task-indent);
  min-height: 56px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 10px;
  margin-bottom: 8px;
  font-size: 14px;
  transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.task-row:hover { box-shadow: 0 1px 6px rgba(16,24,40,.08); }
.task-row.is-dragging {
  opacity: .55;
  box-shadow: 0 8px 24px rgba(40, 129, 116, .16);
}
.task-row.is-drop-ready:hover {
  border-color: #9fc8b0;
}
/* 同宽边框保证各层级的状态列对齐；分组用底色与字重区分。 */
.parent-row {
  position: relative;
  background: #f8fbfa;
  border: 1px solid #cfd8d2;
}
.child-row {
  background: #ffffff;
  border: 1px solid #e7ece8;
}
.parent-row:hover {
  border-color: #b7c5bd;
}
.child-row:hover { border-color: #cdd6d0; }
.nested-row::before {
  position: absolute;
  top: -9px;
  bottom: -9px;
  left: -17px;
  width: 1px;
  background: #cbd8d2;
  content: '';
}
.nested-row::after {
  position: absolute;
  top: 23px;
  left: -17px;
  width: 16px;
  height: 1px;
  background: #cbd8d2;
  content: '';
}
.parent-row .row-title { font-weight: 700; color: var(--text-1); }
.row-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.row-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14.5px; font-weight: 500; color: #1f2733;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fold-button,
.fold-spacer {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}
.fold-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: #6d7b75;
  background: transparent;
  cursor: pointer;
}
.child-row .child-number {
  transform: translateX(-16px);
}
.fold-button::before {
  position: absolute;
  inset: -8px;
  content: '';
}
.fold-button:hover { color: #0f766e; background: #e8f7f4; }
.fold-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.drag-handle {
  width: 22px;
  height: 28px;
  flex: 0 0 22px;
  border: 0;
  border-radius: 7px;
  color: #99a7a1;
  background: transparent;
  cursor: grab;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -3px;
  line-height: 1;
}
.drag-handle:hover {
  color: #288174;
  background: #e8f7f4;
}
.drag-handle:active {
  cursor: grabbing;
}
.child-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: 6px;
  background: #edf5f2;
  color: #36776a;
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.type-dot {
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  background: var(--depth-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--depth-color) 14%, white);
}
.child-count { font-size: 12px; color: var(--color-accent); background: var(--color-accent-bg); border-radius: 8px; padding: 0 7px; line-height: 18px; flex-shrink: 0; }
.risk-tag { flex-shrink: 0; font-weight: 700; }
.row-status { display: flex; align-items: center; }
.row-indicators { display: flex; align-items: center; gap: 4px; min-width: 0; flex-wrap: wrap; }
.row-indicators :deep(.el-tag) { max-width: 100%; }
.row-indicators :deep(.el-tag__content) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-right { display: flex; justify-content: flex-end; align-items: center; gap: 12px; min-width: 0; }
.row-prog { display: flex; align-items: center; gap: 8px; width: 130px; }
.row-prog .el-progress { flex: 1; min-width: 80px; }
.prog-pct { font-size: 12px; font-weight: 700; color: #1f2733; width: 36px; text-align: right; flex-shrink: 0; }
.row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.row-actions .el-button + .el-button { margin-left: 0; }
.row-actions .el-button { font-size: 13px; }
.row-meta {
  display: grid;
  grid-template-columns: minmax(88px, 1fr) minmax(88px, 1fr) 212px;
  align-items: center;
  gap: 12px;
  min-width: 0;
  font-size: 13px; color: #6d7b75;
}
.meta-item { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.meta-label {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 5px;
  color: #6d7b75;
  background: #edf1ef;
  font-size: 11px;
  font-weight: 700;
}
.owner-meta .meta-label { color: #0f766e; background: #e8f7f4; }
.meta-value { color: #5a6660; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.owner-meta .meta-value { color: #1e293b; font-weight: 700; }
.schedule-meta { font-variant-numeric: tabular-nums; white-space: nowrap; }
.schedule-meta.overdue .meta-label { color: #b91c1c; background: #fee2e2; }
.schedule-meta.overdue .meta-value { color: var(--color-danger); font-weight: 700; }
.overdue { color: var(--color-danger); font-weight: 500; }

/* 折叠动画 */
.fold-enter-active,
.fold-leave-active {
  transition: height .3s cubic-bezier(.25,.8,.25,1), opacity .25s ease;
  overflow: hidden;
}
.fold-enter-from,
.fold-leave-to { opacity: 0; }

/* 折叠容器不贡献额外空间 */
.tr-children { margin: 0; padding: 0; }

@media (max-width: 760px) {
  .task-row {
    margin-left: var(--mobile-indent);
    grid-template-columns: minmax(0, 1fr) 68px;
    gap: 10px 8px;
    padding: 12px;
  }
  .row-meta { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .schedule-meta { grid-column: 1 / -1; }
  .row-indicators { grid-column: 1 / -1; }
  .row-indicators:empty { display: none; }
  .row-right { grid-column: 1 / -1; justify-content: space-between; flex-wrap: wrap; }
  .row-actions { margin-left: auto; }
}


@media (prefers-reduced-motion: reduce) {
  .task-row,
  .fold-button,
  .fold-enter-active,
  .fold-leave-active { transition: none; }
}
</style>
