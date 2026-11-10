<script setup lang="ts">
import { computed, ref, watch, onActivated } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { terminationsApi } from '@/api';
import { useRefreshStore } from '@/stores/refresh';
import { useAuthStore } from '@/stores/auth';
import { formatBeijingTime } from '@/utils/date-time';
defineProps<{ detailOnly?: boolean }>();
const route = useRoute();
const router = useRouter();
const refresh = useRefreshStore();
const auth = useAuthStore();
const rows = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const filter = ref('all');
const comment = ref('');
const labels: Record<string, string> = { pending: '待审批', approved: '已通过', rejected: '已退回', withdrawn: '已撤回' };
const actions: Record<string, string> = { requested: '提交申请', rejected: '退回申请', withdrawn: '撤回申请', department_approved: '部门审批通过', final_approved: '最终审批通过' };
const visible = computed(() => rows.value.filter(r => filter.value === 'all' || r.status === filter.value));
const selected = computed(() => rows.value.find(r => String(r.id) === String(route.query.terminationId)));
async function load() {
  loading.value = true; error.value = '';
  try { rows.value = await terminationsApi.list(route.query.projectId ? Number(route.query.projectId) : undefined); }
  catch(e: any) { error.value = e.message || '终止审批加载失败'; }
  finally { loading.value = false; }
}
function open(row: any) { comment.value = ''; router.replace({ query: { ...route.query, tab: 'termination', terminationId: String(row.id) } }); }
function close() { if (saving.value) return; const query = { ...route.query }; delete query.terminationId; router.replace({ query }); }
async function review(approve: boolean) {
  if (!selected.value || saving.value) return;
  if (!approve && !comment.value.trim()) { ElMessage.warning('请填写退回原因'); return; }
  saving.value = true;
  try {
    await ElMessageBox.confirm(approve ? (selected.value.stage === 'final' ? '最终审批通过后项目永久终止，不可恢复。确认通过？' : '确认通过部门审批并提交最终审批？') : '确认退回该终止申请？项目将解除本次终止冻结。', '审批确认', { type: 'warning', confirmButtonText: approve ? '确认通过' : '确认退回', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false });
    await terminationsApi.review(Number(selected.value.id), approve, comment.value.trim());
    refresh.markProjectChanged(); comment.value = ''; await load(); ElMessage.success('审批已处理');
  } catch(e: any) { if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '审批失败'); }
  finally { saving.value = false; }
}
async function withdraw() {
  if (!selected.value || saving.value) return;
  saving.value = true;
  try {
    await ElMessageBox.confirm('撤回后解除本次终止冻结，确认撤回？', '撤回终止申请', { type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false });
    await terminationsApi.withdraw(Number(selected.value.id));
    refresh.markProjectChanged(); await load(); ElMessage.success('申请已撤回');
  } catch(e: any) { if (e !== 'cancel' && e !== 'close' && !e.messageShown) ElMessage.error(e.message || '撤回失败'); }
  finally { saving.value = false; }
}
watch(() => route.query.projectId, load, { immediate: true });
watch(() => refresh.versions.project, load);
onActivated(load);
</script>
<template>
  <section v-loading="loading" class="termination-records">
    <div v-if="!detailOnly" class="tools"><el-radio-group v-model="filter"><el-radio-button value="all">全部记录</el-radio-button><el-radio-button v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</el-radio-button></el-radio-group><el-button @click="load">刷新</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="!detailOnly"><article v-for="row in visible" :key="row.id">
      <div><h3>{{ row.projectName }}</h3><p>{{ row.reason }}</p><p>{{ row.requesterName }} · {{ formatBeijingTime(row.createdAt) }}</p><el-tag :type="row.status === 'pending' ? 'warning' : 'info'">{{ labels[row.status] }}{{ row.status === 'pending' ? ' · ' + (row.stage === 'department' ? '部门审批' : '最终审批') : '' }}</el-tag></div>
      <el-button @click="open(row)">{{ row.canReview && !auth.readOnly ? '处理审批' : '查看详情' }}</el-button>
    </article>
    <el-empty v-if="!loading && !error && !visible.length" description="暂无终止审批记录" /></template>
    <el-dialog :model-value="!!route.query.terminationId" title="项目终止审批" width="min(680px, 94vw)" append-to-body :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @update:model-value="value => { if (!value) close(); }">
      <template v-if="selected">
        <h3>{{ selected.projectName }}</h3><el-tag>{{ labels[selected.status] }}</el-tag>
        <p>申请人：{{ selected.requesterName }} · {{ formatBeijingTime(selected.createdAt) }}</p>
        <p class="reason">终止原因：{{ selected.reason }}</p>
        <el-alert v-if="selected.status === 'pending'" :title="'项目已冻结，当前等待' + (selected.stage === 'department' ? '部门审批' : '最终审批') + '；通过后永久终止。'" type="warning" :closable="false" />
        <h4>审批记录</h4><el-timeline><el-timeline-item v-for="(item, index) in selected.history" :key="index" :timestamp="formatBeijingTime(item.at)"><strong>{{ item.actorName }} · {{ actions[item.action] || item.action }}</strong><p class="reason">{{ item.comment }}</p></el-timeline-item></el-timeline>
        <el-input v-if="selected.canReview && !auth.readOnly" v-model="comment" type="textarea" :rows="3" placeholder="审批意见（退回时必填）" aria-label="审批意见" />
      </template>
      <el-empty v-else-if="!loading" description="未找到可查看的终止申请" />
      <template #footer><el-button @click="close">关闭</el-button><el-button v-if="selected?.canWithdraw && !auth.readOnly" :loading="saving" @click="withdraw">撤回申请</el-button><template v-if="selected?.canReview && !auth.readOnly"><el-button type="danger" :loading="saving" @click="review(false)">退回</el-button><el-button type="primary" :loading="saving" @click="review(true)">通过</el-button></template></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.tools{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}.termination-records article{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px;background:var(--el-bg-color);border:1px solid var(--el-border-color-light);border-radius:12px;margin-bottom:12px}.termination-records article>div{min-width:0}.termination-records h3{margin:0 0 10px;font-size:16px}.termination-records p,.reason{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.termination-records p{font-size:13px;color:var(--el-text-color-secondary)}@media(max-width:600px){.termination-records article{align-items:flex-start;flex-direction:column}.tools :deep(.el-radio-group){display:flex;flex-wrap:wrap}}
</style>
