<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tasksApi } from '@/api';
import { assetDisplayTitle, assetFileName, assetLinkUrl } from '@/utils/task-assets';
import { checkWeeklyProgressBeforeAcceptance } from '@/utils/weekly-acceptance';

const props = defineProps<{ taskId: number; readonly?: boolean }>();
const emit = defineEmits<{ reviewed: [] }>();
const task = ref<any>();
const updates = ref<any[]>([]);
const assets = ref<any[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await Promise.all([tasksApi.one(props.taskId), tasksApi.dailyUpdates(props.taskId), tasksApi.assets(props.taskId)]);
    [task.value, updates.value, assets.value] = result;
  } catch (e: any) { error.value = e.message || '审批内容加载失败，请重试'; }
  finally { loading.value = false; }
}
watch(() => props.taskId, load, { immediate: true });
async function download(asset: any) {
  try {
    const blob = await tasksApi.downloadAsset(props.taskId, asset.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = assetFileName(asset); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '下载失败'); }
}
async function review(approve: boolean) {
  if (busy.value || props.readonly) return;
  busy.value = true;
  try {
    await load();
    if (error.value) return;
    if (task.value.status !== 'pending_accept') { ElMessage.info('任务状态已更新，请刷新待办'); emit('reviewed'); return; }
    let comment = '';
    if (approve) {
      if (!await checkWeeklyProgressBeforeAcceptance(props.taskId, () => {}, true)) return;
      const hasMaterials = assets.value.some(a => a.filePath || assetLinkUrl(a));
      if (!hasMaterials && !task.value.materialExemptionReason?.trim()) {
        ElMessage.warning('任务没有资料或资料不适用原因，请退回补充。'); return;
      }
      await ElMessageBox.confirm(hasMaterials ? '确认已核实任务进展与资料，通过验收？' : `资料不适用原因：${task.value.materialExemptionReason}\n确认原因合理并通过验收？`, '审批确认', { confirmButtonText: '通过验收', cancelButtonText: '取消' });
    } else {
      const result = await ElMessageBox.prompt('请说明需要补充或修改的内容', '退回任务', { inputType: 'textarea', inputValidator: value => !!value?.trim() || '请填写退回原因', confirmButtonText: '确认退回', cancelButtonText: '取消' });
      comment = result.value.trim();
    }
    await tasksApi.transition(props.taskId, approve ? 'done' : 'doing', comment || undefined);
    ElMessage.success(approve ? '已通过验收' : '已退回任务');
    emit('reviewed');
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '审批失败，请刷新后重试');
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="approval-panel" :aria-busy="loading">
    <el-skeleton v-if="loading" :rows="3" animated />
    <div v-else-if="error"><el-alert :title="error" type="error" :closable="false" /><el-button @click="load">重新加载</el-button></div>
    <template v-else-if="task">
      <h4>提交的关键进展</h4>
      <p v-if="!updates.length" class="muted">暂无关键进展</p>
      <article v-for="update in updates" :key="update.id" class="progress-entry">
        <strong>{{ update.workDate }}</strong>
        <p>{{ update.content }}</p>
        <p v-if="update.risk">风险：{{ update.risk }}</p>
        <p v-if="update.nextPlan">下一步：{{ update.nextPlan }}</p>
        <p v-if="update.noMaterialReason" class="muted">无资料原因：{{ update.noMaterialReason }}</p>
      </article>
      <h4>任务资料 · {{ assets.length }} 份</h4>
      <ul v-if="assets.length" class="materials"><li v-for="asset in assets" :key="asset.id">
        <a v-if="assetLinkUrl(asset)" :href="assetLinkUrl(asset)" target="_blank" rel="noopener noreferrer">{{ assetDisplayTitle(asset) }} ↗</a>
        <el-button v-else link type="primary" @click="download(asset)">{{ assetDisplayTitle(asset) }} · 下载</el-button>
      </li></ul>
      <p v-else class="muted">暂无资料</p>
      <el-alert v-if="task.materialExemptionReason" :title="`资料不适用原因：${task.materialExemptionReason}`" type="warning" :closable="false" />
      <div v-if="!readonly && task.status === 'pending_accept'" class="review-actions"><el-button type="primary" :disabled="busy" @click="review(true)">通过验收</el-button><el-button type="danger" plain :disabled="busy" @click="review(false)">退回</el-button></div>
      <el-alert v-else-if="!readonly" title="该任务已不处于待验收状态，请刷新待办查看最新结果。" type="info" :closable="false" />
    </template>
  </div>
</template>

<style scoped>
.approval-panel{grid-column:1 / -1;margin-top:16px;padding:20px;background:#f7faf8;border:1px solid #e1eae5;border-radius:12px;min-width:0}
h4{margin:0 0 12px;color:#243e34}.progress-entry{padding:12px 0;border-bottom:1px solid #e1eae5}.progress-entry p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;margin:8px 0}.progress-entry strong{font-size:13px;color:#246f61}.muted{color:#60736b;font-size:13px}.materials{padding-left:20px;overflow-wrap:anywhere}.materials li{margin:10px 0}.materials a{color:#246f61}.review-actions{display:flex;gap:8px;margin-top:20px}.progress-entry+h4{margin-top:20px}
</style>
