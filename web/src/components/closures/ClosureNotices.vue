<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { closuresApi } from '@/api';
import { formatBeijingTime } from '@/utils/date-time';

const props = defineProps<{ kinds?: string[]; includeReady?: boolean }>();
const emit = defineEmits<{ acknowledged: [] }>();
const route = useRoute();
const router = useRouter();
const rows = ref<any[]>([]);
const ready = ref<any[]>([]);
const showRead = ref(false);
const busy = ref<number | null>(null);
const error = ref('');
const loading = ref(false);
const visible = computed(() => rows.value.filter((r) => (!props.kinds || props.kinds.includes(r.kind)) &&
  (showRead.value || !r.acknowledged_at || String(r.id) === String(route.query.notice))));
let loaded = false;
async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    const [notices, projects] = await Promise.all([closuresApi.notices(), props.includeReady ? closuresApi.ready() : Promise.resolve([])]);
    rows.value = notices; ready.value = projects; error.value = ''; loaded = true;
    await nextTick();
    if (route.query.notice) document.getElementById(`closure-notice-${route.query.notice}`)?.scrollIntoView({ block: 'center' });
  } catch (e: any) { error.value = e.message || '结项待办加载失败'; }
  finally { loading.value = false; }
}
async function acknowledge(row: any) {
  busy.value = Number(row.id);
  try { await closuresApi.acknowledge(Number(row.id)); ElMessage.success(row.kind === 'closure_hr' ? '已确认阅读报告' : '已记录知晓'); await load(); emit('acknowledged'); }
  catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '确认失败'); }
  finally { busy.value = null; }
}
onMounted(load);
watch(() => route.query.notice, load);
onActivated(() => { if (loaded) load(); });
defineExpose({ refresh: load });
</script>

<template>
  <section class="closure-inbox" :aria-busy="loading">
    <div class="inbox-head">
      <div class="inbox-heading"><h3>结项与知晓待办</h3><span v-if="ready.length + visible.length" class="inbox-count">{{ ready.length + visible.length }}</span></div>
      <div class="inbox-tools"><el-checkbox v-model="showRead">显示已处理</el-checkbox><el-button :loading="loading" @click="load">刷新</el-button></div>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <article v-for="p in ready" :key="`ready-${p.projectId}`" class="inbox-item">
      <div class="inbox-main">
        <div class="inbox-title-row"><h4>{{ p.name }}</h4><el-tag size="small" :type="p.state === 'pending' ? 'info' : 'warning'">{{ p.state === 'pending' ? '结项审批中' : '待申请结项' }}</el-tag></div>
        <div class="inbox-meta"><span>全部验收完成 <b>{{ p.completedDate }}</b></span><span>计划截止 <b>{{ p.plannedEnd || '未设置' }}</b></span></div>
        <p v-if="p.state !== 'pending'" class="inbox-waiting" :class="{ 'is-warning': p.waitingDays >= 3 }">完成后已等待 <strong>{{ p.waitingDays }}</strong> 天，请及时申请结项</p>
        <p v-else class="inbox-description">待 {{ p.approverName || '总经办负责人' }} 审核</p>
      </div>
      <div class="inbox-actions"><el-button type="primary" :plain="p.state === 'pending'" @click="router.push(p.state === 'pending' ? `/closures?request=${p.requestId}` : `/closures?projectId=${p.projectId}`)">{{ p.state === 'pending' ? '查看申请' : '申请结项' }}</el-button></div>
    </article>
    <article v-for="row in visible" :id="`closure-notice-${row.id}`" :key="row.id" class="inbox-item" :class="{ focused: String(row.id) === String(route.query.notice) }">
      <div class="inbox-main">
        <div class="inbox-title-row"><h4>{{ row.payload.title }}</h4><el-tag v-if="row.acknowledged_at" size="small" type="info">已处理</el-tag></div>
        <div class="inbox-meta"><span>{{ formatBeijingTime(row.created_at) }}</span><span v-if="row.acknowledged_at">处理于 {{ formatBeijingTime(row.acknowledged_at) }}</span></div>
        <p class="inbox-description">{{ row.payload.text }}</p>
        <el-alert v-if="row.payload.revokedAt" type="warning" :closable="false" :title="`此标记已由 ${row.payload.revokedBy} 于 ${formatBeijingTime(row.payload.revokedAt)} 撤销，原通知保留供追溯。`" />
      </div>
      <div class="inbox-actions">
        <el-button v-if="row.kind !== 'supplement_notice'" plain @click="router.push(row.payload.path)">{{ row.payload.label }}</el-button>
        <el-button v-else plain @click="router.push({ name: 'tasks', query: { focusProject: String(row.project_id), taskId: String(row.payload.taskId) } })">查看任务进展</el-button>
        <el-button v-if="!row.acknowledged_at && !['closure_review','closure_peer_review','reopen_review'].includes(row.kind)" type="primary" :loading="busy === Number(row.id)" @click="acknowledge(row)">{{ row.kind === 'closure_hr' ? '确认已阅' : '我已知晓' }}</el-button>
      </div>
    </article>
    <p v-if="!error && !visible.length && !ready.length" class="empty">{{ loading ? '正在加载待办…' : '暂无结项或知晓待办' }}</p>
  </section>
</template>

<style scoped>
.closure-inbox { background: #fff; border: 1px solid var(--border, #e6eeec); border-radius: var(--radius-lg, 20px); padding: 20px 24px; margin-bottom: 20px; color: var(--text-1, #243e38); }
.inbox-head, .inbox-heading, .inbox-tools, .inbox-title-row, .inbox-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.inbox-head { justify-content:space-between; gap:12px 24px; padding-bottom:16px; }
.inbox-heading h3 { margin:0; font-size:16px; font-weight:700; }
.inbox-count { padding:2px 8px; border-radius:12px; background:#e9f3f0; color:#246d61; font-size:12px; font-weight:600; }
.inbox-tools { margin-left:auto; }
.inbox-item { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:20px 0; border-top:1px solid var(--border, #edf2f0); }
.inbox-item:last-of-type { padding-bottom:4px; }
.inbox-item.focused { outline:2px solid #288174; outline-offset:6px; border-radius:8px; }
.inbox-main { flex:1; min-width:0; }
.inbox-title-row { gap:8px 12px; }
.inbox-title-row h4 { margin:0; font-size:15px; line-height:1.6; font-weight:700; overflow-wrap:anywhere; }
.inbox-meta { display:flex; flex-wrap:wrap; gap:6px 24px; margin-top:8px; color:#65766f; font-size:12px; line-height:1.6; }
.inbox-meta b { margin-left:6px; color:#43554e; font-weight:500; font-variant-numeric:tabular-nums; }
.inbox-description { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; margin:10px 0 0; font-size:13px; color:#43554e; }
.inbox-waiting { margin:10px 0 0; font-size:13px; color:#43554e; line-height:1.6; }
.inbox-waiting.is-warning { color:#996015; }
.inbox-waiting strong { padding:0 3px; font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; }
.inbox-actions { justify-content:flex-end; flex-shrink:0; gap:8px; max-width:40%; }
.inbox-actions :deep(.el-button + .el-button) { margin-left:0; }
.empty { color:#65766f; font-size:13px; text-align:center; margin:0; padding:24px 0 12px; border-top:1px solid var(--border, #edf2f0); }
@media(max-width:760px) {
  .closure-inbox { padding:16px; }
  .inbox-item { align-items:stretch; flex-direction:column; gap:14px; }
  .inbox-actions { justify-content:flex-start; max-width:none; }
  .inbox-meta { gap:4px 16px; }
}
</style>
