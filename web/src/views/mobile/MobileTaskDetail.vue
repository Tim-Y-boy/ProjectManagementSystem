<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tasksApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useRefreshStore } from '@/stores/refresh';
import { statusLabel, statusType } from '@/utils/task-meta';
import { leafRisk } from '@/utils/task-risk';
import TaskCompletionTag from '@/components/TaskCompletionTag.vue';
import TaskMaterialLink from '@/components/TaskMaterialLink.vue';
import ExistingTaskAssetsSelect from '@/components/ExistingTaskAssetsSelect.vue';
import { assetLinksProgress } from '@/utils/task-assets';
import NoMaterialReasonSelect from '@/components/NoMaterialReasonSelect.vue';
import { progressMaterialReason } from '@/utils/no-material-reason';
import { materialConfirmationMessage } from '@/utils/material-confirmation';
import { checkWeeklyProgressBeforeAcceptance } from '@/utils/weekly-acceptance';
import TaskProgressWeek from '@/components/TaskProgressWeek.vue';

const route = useRoute();
const auth = useAuthStore();
const refresh = useRefreshStore();
const taskId = computed(() => Number(route.params.id));
const requestedWeek = computed(() => typeof route.query.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.weekStart)
  && !Number.isNaN(Date.parse(route.query.weekStart)) ? route.query.weekStart : '');

const task = ref<any>(null);
const updates = ref<any[]>([]);
const assets = ref<any[]>([]);
const detailTab = ref<'summary' | 'updates'>(requestedWeek.value ? 'updates' : 'summary');
const loading = ref(false);

const isParent = computed(() => !!task.value?.children?.length);
const isProjectLocked = computed(() => !!task.value?.planLocked);
const isFrozen = computed(() => task.value?.projectStatus === 'archived' || ['pending', 'closed'].includes(task.value?.projectClosureState));
const isTaskAssignee = computed(() => !!auth.user &&
  [...(task.value?.assigneeIds || []), task.value?.assigneeId]
    .filter((id) => id != null).some((id) => String(id) === String(auth.user.id)),
);

const canWork = computed(() => {
  if (isFrozen.value) return false;
  if (!auth.user || isParent.value) return false;
  const t = task.value;
  if (!t) return false;
  return canReview.value || isProjectOwner.value || String(t.creatorId) === String(auth.user.id) || isTaskAssignee.value;
});
const canReview = computed(() => {
  if (isFrozen.value) return false;
  if (!auth.user || isParent.value) return false;
  const t = task.value;
  if (!t) return false;
  const cIds = [(t.acceptorIds || []), t.acceptorId].flat().filter(Boolean).map(Number);
  return auth.has('admin') || auth.has('leader') || cIds.includes(Number(auth.user.id));
});
// 项目负责人（多选）可开始、录入、提交验收和恢复已退回任务。
const isProjectOwner = computed(() => {
  if (!auth.user || !task.value) return false;
  const ownerIds = task.value?.projectOwnerIds?.length
    ? task.value.projectOwnerIds
    : task.value?.projectOwnerId != null
      ? [task.value.projectOwnerId]
      : [];
  return ownerIds.some((id: number) => String(id) === String(auth.user.id));
});
const canUndoStart = computed(() => !isFrozen.value && !!task.value && task.value.status === 'doing' && (canWork.value || isProjectOwner.value) && updates.value.length === 0);
const canConfirm = computed(() => !isFrozen.value && !isParent.value && !!task.value && (task.value.canConfirm ?? (
  auth.has('admin') || auth.has('leader') || (auth.has('dept_head') && task.value.projectDeptId != null &&
    [auth.user?.deptId, ...(auth.user?.managedDeptIds || [])].some(id => id != null && String(id) === String(task.value.projectDeptId)))
)));
const canRestore = computed(() => !isFrozen.value && (canReview.value || isProjectOwner.value || isTaskAssignee.value));
const canWriteProcess = computed(() => {
  if (!task.value || !auth.user || isParent.value || isFrozen.value || !isProjectLocked.value) return false;
  if (!['doing', 'done'].includes(task.value.status)) return false;
  const deptIds = [auth.user.deptId, ...(auth.user.managedDeptIds || [])].filter(id => id != null);
  const managesDept = auth.has('dept_head') && task.value.projectDeptId != null
    && deptIds.some(id => String(id) === String(task.value.projectDeptId));
  return canWork.value || managesDept;
});
const updatesWithAssets = computed(() => updates.value.map(update => ({ ...update,
  materials: assets.value.filter(asset => assetLinksProgress(asset, update.id)),
})));
const unlinkedAssets = computed(() => assets.value.filter(asset => !updates.value.some(update => assetLinksProgress(asset, update.id))));
function validLink(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
const hasMaterials = computed(() => assets.value.some(asset => asset.filePath?.trim() || validLink(asset.url || '')));

let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  const id = taskId.value;
  loading.value = true;
  try {
    const [one, ups, ass] = await Promise.all([
      tasksApi.one(id),
      tasksApi.dailyUpdates(id),
      tasksApi.assets(id),
    ]);
    if (version !== loadVersion || id !== taskId.value) return;
    task.value = one;
    updates.value = ups || [];
    assets.value = ass || [];
  } catch (e: any) {
    if (version === loadVersion && id === taskId.value) ElMessage.error(e.message || '加载失败');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function transition(to: string) {
  const id = taskId.value;
  if (savingUpdate.value || pendingFiles.value.length || selectedExistingAssetIds.value.length || linkDraft.value.trim() || upForm.value.content.trim() || upForm.value.noMaterialReason.trim()) {
    ElMessage.warning('请先保存当前进展与资料，再操作任务状态');
    detailTab.value = 'updates';
    return;
  }
  if (to === 'pending_accept' || to === 'done') {
    try {
      const complete = await checkWeeklyProgressBeforeAcceptance(id, async weekStart => {
        if (id !== taskId.value || !await guardNavigation()) return;
        await chooseProgress(null);
        if (id !== taskId.value) return;
        detailTab.value = 'updates';
        upForm.value.workDate = weekStart;
      }, to === 'done');
      if (!complete || id !== taskId.value) return;
    } catch (e: any) {
      if (!e.messageShown) ElMessage.error(e.message || '检查每周关键进展失败，请重试');
      return;
    }
  }
  const isRestore = task.value?.status === 'rejected' && to === 'todo';
  const isReopen = task.value?.status === 'done' && to === 'doing';
  let comment: string | undefined;
  let materialExemptionReason: string | undefined;
  if (to === 'pending_accept' && !hasMaterials.value) {
    try {
      const reason = progressMaterialReason(await tasksApi.dailyUpdates(id));
      if (!reason) {
        ElMessage.warning('请先在“进展与资料”中补充资料或选择无资料原因，再提交验收。');
        detailTab.value = 'updates';
        return;
      }
      await ElMessageBox.confirm(materialConfirmationMessage(reason), '提交验收', {
        confirmButtonText: '确认提交验收', cancelButtonText: '取消', customClass: 'material-reason-confirm',
      });
      materialExemptionReason = reason;
    } catch (e: any) {
      if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '读取无资料原因失败，请重试');
      return;
    }
  }
  if (to === 'done' && task.value?.materialExemptionReason) {
    try {
      await ElMessageBox.confirm(`本次无资料，资料不适用原因：${task.value.materialExemptionReason}。请确认原因合理后通过验收。`, '确认无资料验收', {
        type: 'warning', confirmButtonText: '确认并通过', cancelButtonText: '取消',
      });
    } catch { return; }
  }
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
  }
  // 开始前二次确认，防误触
  if (task.value?.status === 'todo' && to === 'doing') {
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
    if (id !== taskId.value) return;
    await tasksApi.transition(id, to, isRestore ? '恢复待办，由执行人、任务负责人或项目负责人继续录入' : comment, materialExemptionReason);
    refresh.markTaskChanged();
    ElMessage.success(isRestore ? '已恢复待办，可开始录入' : '操作成功');
    await load();
  } catch (e: any) {
    if (!e.messageShown) ElMessage.error(e.message || '操作失败');
  }
}
// 撤销开始（doing→todo）：仅尚未填报关键进展时可撤（误点开始的逃生口）
async function revertStart() {
  const id = taskId.value;
  try {
    await ElMessageBox.confirm('撤销开始后任务将回到「待办（未开始）」，操作会记入日志。确认撤销？', '撤销开始', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    if (id !== taskId.value) return;
    await tasksApi.transition(id, 'todo');
    refresh.markTaskChanged();
    ElMessage.success('已撤销开始，任务回到待办');
    await load();
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败');
  }
}
async function confirmNow() {
  try {
    await tasksApi.confirm(taskId.value);
    refresh.markTaskChanged();
    ElMessage.success('已确认');
    await load();
  } catch (e: any) { ElMessage.error(e.message || '失败'); }
}
async function rejectNow() {
  const id = taskId.value;
  try {
    const { value } = await ElMessageBox.prompt('请输入退回原因', '退回任务', {
      confirmButtonText: '退回', cancelButtonText: '取消',
    });
    if (id !== taskId.value) return;
    await tasksApi.reject(id, value || '');
    refresh.markTaskChanged();
    ElMessage.success('已退回');
    await load();
  } catch { /* 取消 */ }
}

// 文字与本条资料由同一个事务保存，失败时保留完整草稿。
const upForm = ref({ workDate: requestedWeek.value, content: '', noMaterialReason: '' });
const targetUpdateId = shallowRef<number | null>(null);
const savingUpdate = shallowRef(false);
const pendingFiles = ref<File[]>([]);
const selectedExistingAssetIds = ref<number[]>([]);
const materialChoice = shallowRef<'' | 'yes' | 'no'>('');
const materialSource = shallowRef<'file' | 'link' | 'feishu' | 'existing'>('file');
const linkDraft = shallowRef('');
const draftLinks = computed(() => linkDraft.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean));
const hasDraftMaterials = computed(() => pendingFiles.value.length > 0 || draftLinks.value.some(validLink) || selectedExistingAssetIds.value.some(id => assets.value.some(a => Number(a.id) === id && (a.filePath || validLink(a.url || '')))));
const showNoMaterialReason = computed(() => !targetUpdateId.value && materialChoice.value === 'no');
const selectedUpdate = computed(() => updates.value.find(update => String(update.id) === String(targetUpdateId.value)));
async function chooseProgress(updateId: number | null) {
  if (!canWriteProcess.value || !await guardNavigation()) return;
  targetUpdateId.value = updateId;
  materialChoice.value = updateId ? 'yes' : '';
  materialSource.value = 'file';
  pendingFiles.value = [];
  selectedExistingAssetIds.value = [];
  linkDraft.value = '';
  upForm.value = { workDate: requestedWeek.value, content: '', noMaterialReason: '' };
}
function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  if (!savingUpdate.value && canWriteProcess.value) {
    if (pendingFiles.value.length + files.length > 30) ElMessage.warning('每次最多上传 30 个文件');
    else if (files.some(file => file.size > 50 * 1024 * 1024)) ElMessage.warning('单个文件不能超过 50MB，请重新选择');
    else if ([...pendingFiles.value, ...files].reduce((total, file) => total + file.size, 0) > 200 * 1024 * 1024) ElMessage.warning('单次文件合计不能超过 200MB');
    else pendingFiles.value.push(...files);
  }
  input.value = '';
}
async function addUpdate() {
  if (savingUpdate.value || !canWriteProcess.value) return;
  const id = taskId.value;
  if (!materialChoice.value) { ElMessage.warning('请先选择本次是否有资料'); return; }
  const withMaterials = !!targetUpdateId.value || materialChoice.value === 'yes';
  const urls = withMaterials ? draftLinks.value : [];
  const files = withMaterials ? pendingFiles.value : [];
  if (urls.some(url => !validLink(url))) {
    ElMessage.warning('请检查资料链接，每行填写一个有效的 HTTP/HTTPS 链接'); return;
  }
  if (files.length > 30) { ElMessage.warning('每次最多上传 30 个文件'); return; }
  if (files.some(file => file.size > 50 * 1024 * 1024)) {
    ElMessage.warning('单个文件不能超过 50MB，请重新选择'); return;
  }
  if (files.reduce((total, file) => total + file.size, 0) > 200 * 1024 * 1024) {
    ElMessage.warning('单次文件合计不能超过 200MB'); return;
  }
  if (!targetUpdateId.value && (!upForm.value.workDate || !upForm.value.content.trim())) {
    ElMessage.warning('请填写工作日期与关键进展'); return;
  }
  if (targetUpdateId.value && !selectedUpdate.value) { ElMessage.warning('请选择已有进展'); return; }
  if (withMaterials && !hasDraftMaterials.value) {
    ElMessage.warning('请选择要补充的文件或粘贴有效链接'); return;
  }
  const noMaterialReason = upForm.value.noMaterialReason.trim();
  if (!withMaterials && (!noMaterialReason || noMaterialReason.length > 500)) {
    ElMessage.warning(!noMaterialReason ? '本条进展没有资料，请填写无资料原因' : '无资料原因最多 500 字'); return;
  }
  const links = urls.map(url => ({ title: new URL(url).hostname, url }));
  const payload = targetUpdateId.value
    ? { updateId: targetUpdateId.value, materialsOnly: true, links }
    : { workDate: upForm.value.workDate, content: upForm.value.content.trim(), noMaterialReason: withMaterials ? '' : noMaterialReason, links };
  const data = new FormData();
  data.append('payload', JSON.stringify({ ...payload, existingAssetIds: withMaterials ? selectedExistingAssetIds.value : [] }));
  for (const file of files) data.append('files', file);
  savingUpdate.value = true;
  try {
    await tasksApi.saveProgress(id, data);
    refresh.markTaskChanged();
    targetUpdateId.value = null;
    materialChoice.value = '';
    materialSource.value = 'file';
    pendingFiles.value = [];
    selectedExistingAssetIds.value = [];
    linkDraft.value = '';
    upForm.value = { workDate: requestedWeek.value, content: '', noMaterialReason: '' };
    ElMessage.success('进展与资料已保存');
    await load();
  } catch (e: any) {
    if (!e?.messageShown) ElMessage.error('保存失败，完整填写内容与资料已保留：' + (e.message || '请重试'));
  } finally { savingUpdate.value = false; }
}
async function unlinkProgressAsset(update: any, asset: any) {
  if (!canWriteProcess.value || savingUpdate.value) return;
  const id = taskId.value;
  let ownsSaving = false;
  try {
    await ElMessageBox.confirm('仅解除本条进展的关联，原资料和其他进展的关联会保留。', '解除资料关联', {
      confirmButtonText: '解除关联', cancelButtonText: '取消',
    });
    if (id !== taskId.value || savingUpdate.value) return;
    savingUpdate.value = true;
    ownsSaving = true;
    await tasksApi.unlinkAsset(id, Number(update.id), Number(asset.id));
    refresh.markTaskChanged();
    await load();
    ElMessage.success('已解除关联，原资料已保留');
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.warning(e.message || '解除关联失败');
  } finally { if (ownsSaving) savingUpdate.value = false; }
}
async function openAsset(asset: any) {
  if (!asset.filePath) {
    if (validLink(asset.url || '')) window.open(asset.url, '_blank', 'noopener,noreferrer');
    else ElMessage.warning('资料链接无效');
    return;
  }
  try {
    const blob = await tasksApi.downloadAsset(taskId.value, asset.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = asset.originalName || asset.title || '资料';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e: any) { ElMessage.error(e.message || '下载失败'); }
}

function owner(id: number | null) {
  return id != null ? `用户#${id}` : '—';
}

async function guardNavigation() {
  if (savingUpdate.value) {
    ElMessage.warning('进展与资料正在保存，请完成后再离开');
    return false;
  }
  const hasDraft = selectedExistingAssetIds.value.length || pendingFiles.value.length || upForm.value.content.trim() || upForm.value.noMaterialReason.trim() || linkDraft.value.trim()
    || (upForm.value.workDate && upForm.value.workDate !== requestedWeek.value);
  if (!hasDraft) return true;
  try {
    await ElMessageBox.confirm('离开后会清空未保存的进展和资料，已保存的记录会保留。确认离开？', '尚有未保存内容', {
      type: 'warning', confirmButtonText: '离开', cancelButtonText: '继续填写',
    });
    return !savingUpdate.value;
  } catch { return false; }
}
onBeforeRouteLeave(guardNavigation);
onBeforeRouteUpdate(guardNavigation);
watch(() => [route.params.id, route.query.weekStart], () => {
  task.value = null;
  updates.value = [];
  assets.value = [];
  targetUpdateId.value = null;
  materialChoice.value = '';
  materialSource.value = 'file';
  pendingFiles.value = [];
  selectedExistingAssetIds.value = [];
  linkDraft.value = '';
  upForm.value = { workDate: requestedWeek.value, content: '', noMaterialReason: '' };
  detailTab.value = requestedWeek.value ? 'updates' : 'summary';
  void load();
}, { immediate: true });
</script>

<template>
  <div class="mtd" v-loading="loading">
    <!-- 基本信息 -->
    <template v-if="task">
      <div class="mtd-head">
        <div class="mtd-title-wrap">
          <h2 class="mtd-title">{{ task.title }}</h2>
          <span class="mtd-badge" :class="statusType(task.status)">{{ statusLabel(task.status) }}</span>
          <TaskCompletionTag :task="task" />
        </div>
        <div class="mtd-meta">
          <div><span>项目</span><span class="v">{{ task.projectName || ('项目#' + task.projectId) }}</span></div>
          <div><span>执行人</span><span class="v">{{ owner(task.assigneeId) }}</span></div>
          <div><span>截止</span><span class="v">{{ task.dueAt || '未设置' }}</span></div>
          <template v-if="leafRisk(task) === 2"><span class="mtd-risk red">已延期</span></template>
          <template v-else-if="leafRisk(task) === 1"><span class="mtd-risk orange">临期</span></template>
        </div>
      </div>

      <!-- 状态流转按钮 -->
      <el-alert v-if="isFrozen" title="项目结项审批中或已结项，仅可查看" type="info" :closable="false" />
      <div v-if="!isParent && !isFrozen" class="mtd-actions">
        <el-button v-if="task.status==='pending_confirm' && canConfirm" type="success" size="large" @click="confirmNow">确认</el-button>
        <el-button v-if="task.status==='pending_confirm' && canConfirm" type="danger" size="large" plain @click="rejectNow">退回</el-button>
        <el-button v-if="task.status==='todo' && isProjectLocked && canWork" type="primary" size="large" @click="transition('doing')">开始</el-button>
        <el-button v-if="task.status==='rejected' && canRestore" type="primary" size="large" plain @click="transition('todo')">恢复待办</el-button>
        <el-button v-if="task.status==='doing' && canWork" type="warning" size="large" @click="transition('pending_accept')">提交验收</el-button>
        <el-button v-if="canUndoStart" type="info" size="large" plain @click="revertStart">撤销开始</el-button>
        <el-button v-if="task.status==='pending_accept' && canReview" type="success" size="large" @click="transition('done')">通过</el-button>
        <el-button v-if="task.status==='pending_accept' && canReview" type="danger" size="large" plain @click="transition('doing')">退回验收</el-button>
        <el-button v-if="task.status==='done' && task.canReopenCompleted" type="danger" size="large" plain @click="transition('doing')">退回</el-button>
      </div>

      <p v-if="task.description" class="mtd-desc">{{ task.description }}</p>
      <el-alert v-if="task.materialExemptionReason" title="无资料提交验收" :description="'资料不适用原因：' + task.materialExemptionReason" type="warning" :closable="false" />

      <!-- 分段 -->
      <div class="mtd-seg">
        <button v-for="s in [['summary','概况'],['updates','进展与资料']] as const"
                :key="s[0]" class="mtd-seg-btn" :class="{active: detailTab===s[0]}" @click="detailTab=s[0]">{{ s[1] }}</button>
      </div>

      <!-- 概况 -->
      <div v-if="detailTab==='summary'" class="mtd-sec">
        <div v-if="task.children?.length" class="mtd-tip">父任务由子任务自动汇总，无需手动操作。</div>
      </div>

      <!-- 进展与资料 -->
      <div v-else-if="detailTab==='updates'" class="mtd-sec">
        <el-form v-if="canWriteProcess" class="mtd-upform" label-position="top" @submit.prevent="addUpdate">
          <template v-if="!targetUpdateId">
            <label class="mtd-field">工作日期（必填）<input v-model="upForm.workDate" type="date" class="mtd-input" :disabled="savingUpdate" required /></label>
            <TaskProgressWeek :planned-start="task?.startAt" :planned-due="task?.dueAt" :work-date="upForm.workDate" class="mobile-progress-week" />
            <label class="mtd-field">关键进展（必填）<textarea v-model="upForm.content" class="mtd-area" placeholder="本次完成的工作" rows="3" :disabled="savingUpdate" required></textarea></label>
          </template>
          <div v-else class="mtd-tip">
            为这条进展补资料：{{ selectedUpdate?.workDate }} · {{ selectedUpdate?.content }}
            <el-button link :disabled="savingUpdate" @click="chooseProgress(null)">返回新增进展</el-button>
          </div>
          <ProgressMaterialsChoice v-model="materialChoice" v-model:source="materialSource" :disabled="savingUpdate" :supplement-only="!!targetUpdateId">
          <template #existing><ExistingTaskAssetsSelect v-model="selectedExistingAssetIds" :assets="assets" :update-id="targetUpdateId" :disabled="savingUpdate" /></template>
          <template #file>
          <p class="mtd-tip">最多 30 个文件，单个不超过 50MB，单次合计不超过 200MB。</p>
          <label class="mtd-field">文件（选填，可多选）<input type="file" multiple class="mtd-input" :disabled="savingUpdate" @change="selectFiles" /></label>
          </template>
          <template #selected>
          <p v-if="selectedExistingAssetIds.length || linkDraft.trim()" class="mtd-tip">已选已有资料 {{ selectedExistingAssetIds.length }} 份 · 待保存链接 {{ draftLinks.length }} 条</p>
          <div v-for="(file, index) in pendingFiles" :key="index" class="mtd-queued">
            <span>{{ file.name }}</span><el-button link type="danger" :disabled="savingUpdate" @click="pendingFiles.splice(index, 1)">移除</el-button>
          </div>
          </template>
          <template #link>
          <label class="mtd-field">链接（选填）<textarea v-model="linkDraft" class="mtd-area" rows="2" placeholder="粘贴链接，每行一个" :disabled="savingUpdate"></textarea></label>
          </template>
          <template #reason>
          <div v-if="showNoMaterialReason" class="mtd-field">无资料原因（必填）<NoMaterialReasonSelect v-model="upForm.noMaterialReason" :disabled="savingUpdate" /></div>
          </template>
          </ProgressMaterialsChoice>
          <el-button type="primary" class="mtd-add" :loading="savingUpdate" @click="addUpdate">保存</el-button>
        </el-form>
        <div v-else class="mtd-tip">当前仅可查看进展与资料。</div>
        <div v-if="!updates.length" class="mtd-empty">暂无关键进展</div>
        <div v-for="u in updatesWithAssets" :key="u.id" class="mtd-item">
          <div class="mtd-item-head"><span class="mtd-item-date">{{ (u.workDate||'').slice(0,10) }}</span><span class="mtd-item-status">{{ u.status }}</span></div>
          <div class="mtd-section-label">关键进展</div>
          <div class="mtd-item-content">{{ u.content }}</div>
          <div v-if="u.noMaterialReason" class="mtd-tip">无资料原因：{{ u.noMaterialReason }}</div>
          <el-button v-if="canWriteProcess" link type="primary" :disabled="savingUpdate" @click="chooseProgress(Number(u.id))">补资料</el-button>
          <div v-if="u.risk" class="mtd-tip">风险：{{ u.risk }}</div>
          <div v-if="u.nextPlan" class="mtd-tip">下一步：{{ u.nextPlan }}</div>
          <div v-if="u.materials.length" class="mtd-materials">
            <div class="mtd-section-label">相关资料 · {{ u.materials.length }} 份</div>
            <div v-for="a in u.materials" :key="a.id">
              <TaskMaterialLink :asset="a" @open="openAsset" />
              <el-button v-if="canWriteProcess" link :disabled="savingUpdate" @click="unlinkProgressAsset(u, a)">解除关联</el-button>
            </div>
          </div>
          <div v-if="!u.materials.length" class="mtd-tip">暂无关联资料</div>
        </div>
        <div v-if="unlinkedAssets.length" class="mtd-item">
          <div class="mtd-item-title">其他任务资料</div>
          <TaskMaterialLink v-for="a in unlinkedAssets" :key="a.id" :asset="a" @open="openAsset" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mtd { display: flex; flex-direction: column; gap: 12px; }
.mtd-head { background: #fff; border: 1px solid #e9efeb; border-radius: 12px; padding: 14px; }
.mtd-title-wrap { display: flex; align-items: center; gap: 8px; }
.mtd-title { margin: 0; font-size: 17px; font-weight: 800; color: #111827; }
.mtd-badge { flex-shrink: 0; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; }
.mtd-badge.success { background:#e9f3f0;color:#288174; }
.mtd-badge.info { background:#ecf0ee;color:#6d7b75; }
.mtd-badge.primary { background:#e0f0ff;color:#1e6fd9; }
.mtd-badge.warning { background:#fff7e6;color:#d88a06; }
.mtd-badge.danger { background:#fff1f2;color:#e5484d; }
.mtd-meta { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 13px; color: #75817b; }
.mtd-meta > div { display: flex; gap: 8px; }
.mtd-meta .v { color: #4a5650; font-weight: 600; }
.mtd-risk { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; align-self: flex-start; }
.mtd-risk.red { background:#fff1f2;color:#e5484d; }
.mtd-risk.orange { background:#fff8e8;color:#d88a06; }
.mtd-actions { display: flex; flex-direction: column; gap: 10px; }
.mtd-actions .el-button { width: 100%; }
.mtd-actions .el-button + .el-button { margin-left: 0; }
.mtd-desc { font-size: 13px; color: #4a5650; line-height: 1.6; margin: 0; }
.mtd-seg { display: flex; gap: 6px; }
.mtd-seg-btn { flex:1; padding: 8px 0; border:none; border-radius:10px; background:#fff; color:#75817b; font-size:13px; font-weight:600; cursor:pointer; }
.mtd-seg-btn.active { background:#288174; color:#fff; }
.mtd-sec { background:#fff; border:1px solid #e9efeb; border-radius:12px; padding:12px; }
.mtd-tip { font-size:13px; color:#75817b; }
.mtd-upform { display:flex; flex-direction:column; gap:10px; margin-bottom:12px; }
.mtd-field { display:flex; flex-direction:column; gap:6px; color:#4a5650; font-size:13px; }
.mtd-queued { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; overflow-wrap:anywhere; }
.mtd-queued span { min-width:0; }
.mtd-section-label { color:#64748b; font-size:12px; font-weight:600; margin:8px 0 4px; }
.mtd-materials { display:flex; flex-direction:column; gap:8px; border-top:1px solid #e8eef2; margin-top:12px; padding-top:8px; }
.mtd-input { border:1px solid #e9efeb; border-radius:8px; padding:9px 10px; font-size:14px; color:#1f2733; width:100%; box-sizing:border-box; }
.mtd-area { border:1px solid #e9efeb; border-radius:8px; padding:9px 10px; font-size:14px; color:#1f2733; width:100%; box-sizing:border-box; resize:none; }
.mtd-add { width:100%; margin-top:2px; }
.mtd-item { border-top:1px solid #f3f6f4; padding:10px 0; }
.mtd-item:first-of-type { border-top:none; }
.mtd-item-head { display:flex; gap:8px; align-items:center; margin-bottom:4px; }
.mtd-item-date { font-size:12px; color:#75817b; }
.mtd-item-status { font-size:11px; color:#75817b; }
.mtd-item-content { font-size:14px; color:#4a5650; line-height:1.5; }
.mtd-item-title { font-size:14px; color:#1f2733; font-weight:600; }
.mtd-empty { font-size:13px; color:#7d8a84; text-align:center; padding:14px 0; }
</style>
