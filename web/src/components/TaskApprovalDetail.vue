<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { dashboardApi, tasksApi } from '@/api';
import { formatBeijingTime } from '@/utils/date-time';
import { useRefreshStore } from '@/stores/refresh';
import TaskApprovalPanel from './todo/TaskApprovalPanel.vue';

const props = defineProps<{ taskId?: number; logId?: number; kind?: string; at?: string }>();
const detail = shallowRef<any>();
const loading = shallowRef(false);
const error = shallowRef('');
const busy = shallowRef(false);
const refresh = useRefreshStore();
const router = useRouter();
const labels: Record<string, string> = { pending: '待审批', approved: '已通过', rejected: '已退回', cancelled: '已取消', unknown: '历史记录不完整' };
let version = 0;
async function load() {
  const current = ++version;
  loading.value = true; error.value = ''; detail.value = undefined;
  try {
    const result = await dashboardApi.taskApprovalDetail({ taskId: props.taskId, logId: props.logId, kind: props.kind, at: props.at });
    if (current === version) detail.value = result;
  } catch (e: any) { if (current === version) error.value = e.message || '审批详情加载失败'; }
  finally { if (current === version) loading.value = false; }
}
watch(() => [props.taskId, props.logId, props.kind, props.at], load, { immediate: true });
async function reviewed() { refresh.markTaskChanged(); await load(); }
async function confirm(approve: boolean) {
  if (busy.value || !detail.value?.canReview) return;
  busy.value = true;
  try {
    if (approve) { await ElMessageBox.confirm('确认通过这项任务的创建申请？', '任务确认'); await tasksApi.confirm(detail.value.taskId); }
    else { const { value } = await ElMessageBox.prompt('请填写退回原因', '退回申请', { inputType: 'textarea', inputValidator: v => !!v?.trim() || '请填写退回原因' }); await tasksApi.reject(detail.value.taskId, value.trim()); }
    ElMessage.success(approve ? '已确认' : '已退回'); await reviewed();
  } catch (e: any) { if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '操作失败'); }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="approval-detail" :aria-busy="loading">
    <el-skeleton v-if="loading" :rows="5" animated />
    <div v-else-if="error"><el-alert :title="error" type="error" :closable="false" /><el-button @click="load">重新加载</el-button></div>
    <template v-else-if="detail">
      <header class="detail-header"><div><p>{{ detail.projectName }} · {{ detail.kind === 'confirm' ? '任务确认' : '任务验收' }}</p><h3>{{ detail.title }}</h3></div><el-tag :type="detail.status === 'approved' ? 'success' : detail.status === 'rejected' ? 'danger' : 'info'">{{ labels[detail.status] || detail.status }}</el-tag></header>
      <p v-if="!detail.submitted" class="muted">该历史记录缺少提交日志，仅展示可核实的审批信息。</p>
      <ol class="approval-events">
        <li v-if="detail.submitted"><strong>发起申请 · {{ detail.submitted.operatorName || '未知用户' }}</strong><time>{{ formatBeijingTime(detail.submitted.createdAt) }}</time><p v-if="detail.submitted.payload?.comment">{{ detail.submitted.payload.comment }}</p><p v-if="detail.submitted.payload?.materialExemptionReason">提交时的资料不适用原因：{{ detail.submitted.payload.materialExemptionReason }}</p></li>
        <li v-if="detail.decision"><strong>{{ labels[detail.status] }} · {{ detail.decision.operatorName || '未知用户' }}</strong><time>{{ formatBeijingTime(detail.decision.createdAt) }}</time><p>审批意见：{{ detail.decision.payload?.comment || detail.decision.payload?.reason || '未填写意见' }}</p></li>
        <li v-else><strong>{{ detail.status === 'pending' ? '等待审批' : '本次申请未找到审批结果日志' }}</strong></li>
      </ol>
      <el-alert v-if="!detail.isCurrent" title="这是历史审批记录，结果对应本次申请，不代表任务当前状态。" type="info" :closable="false" />
      <div v-if="detail.kind === 'confirm' && detail.canReview" class="actions"><el-button type="primary" :disabled="busy" @click="confirm(true)">确认任务</el-button><el-button type="danger" plain :disabled="busy" @click="confirm(false)">退回</el-button></div>
      <div class="actions"><el-button @click="router.push({ path: '/tasks', query: { projectId: String(detail.projectId), taskId: String(detail.taskId) } })">打开关联任务</el-button></div>
      <p class="muted">以下为任务当前的进展与资料，可能包含审批后补充的内容。</p>
      <TaskApprovalPanel :task-id="Number(detail.taskId)" :readonly="detail.kind !== 'accept' || !detail.canReview" @reviewed="reviewed" />
    </template>
  </section>
</template>

<style scoped>
.approval-detail{padding:24px;background:#fff;border:1px solid #e1eae5;border-radius:16px;color:#243e34}.detail-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.detail-header p,.muted{font-size:13px;color:#60736b;line-height:1.7}.detail-header h3{margin:8px 0;font-size:18px}.approval-events{list-style:none;padding:0;margin:24px 0}.approval-events li{padding:16px 20px;margin:12px 0;background:#f1f6f3;border-left:3px solid #288174;border-radius:8px}.approval-events time{display:block;margin-top:8px;color:#60736b;font-size:13px}.approval-events p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.actions{display:flex;gap:8px;margin:20px 0}@media(max-width:768px){.approval-detail{padding:16px}.detail-header{align-items:flex-start}}
</style>
