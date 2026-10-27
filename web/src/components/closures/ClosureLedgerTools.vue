<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage,ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { closuresApi } from '@/api';
import { formatBeijingTime } from '@/utils/date-time';
import { taskManagementLocation } from '@/utils/task-navigation';
const emit=defineEmits<{updated:[]}>(); const auth=useAuthStore(); const router=useRouter();
const detail=ref<any>(null); const detailVisible=ref(false); const auditVisible=ref(false); const audit=ref<any[]>([]);
const accessVisible=ref(false); const access=ref<any>(null); const userId=ref<number>(); const deptId=ref<number>(); const busy=ref(false);
const state=ref(''); const states:Record<string,string>={open:'待处理',processing:'处理中',resolved:'已处理'};
async function run(fn:()=>Promise<void>) { busy.value=true; try{await fn();}catch(e:any){if(e!=='cancel'&&e!=='close'&&!e.messageShown)ElMessage.error(e.message||'操作失败');}finally{busy.value=false;} }
async function openDelay(id:number){await run(async()=>{detail.value=await closuresApi.delay(id);detailVisible.value=true;});}
async function openAudit(){await run(async()=>{audit.value=await closuresApi.audit();auditVisible.value=true;});}
async function openAccess(){await run(async()=>{access.value=await closuresApi.hrAccess();accessVisible.value=true;});}
async function follow(kind:string,id:number,status:string){await run(async()=>{
  const {value}=await ElMessageBox.prompt('填写核查结论、原因或后续处理安排。保存说明不会删除延期事实，也不会自动撤销合理补填。',states[status],{inputType:'textarea',inputValidator:v=>!!v?.trim()&&v.trim().length<=4000||'请填写1～4000字'});
  await closuresApi.followup(kind,id,status,value);
  if(kind==='delay') detail.value=await closuresApi.delay(id);else audit.value=await closuresApi.audit();
  emit('updated');ElMessage.success('处理记录已留存');
});}
async function grant(){await run(async()=>{if(!userId.value)throw new Error('请选择人员');await closuresApi.grantHr(userId.value,deptId.value||null);access.value=await closuresApi.hrAccess();ElMessage.success('已授权');});}
async function revoke(id:number){await run(async()=>{await ElMessageBox.confirm('撤销此项阅览授权？其项目负责人等既有权限不受影响。','撤销授权');await closuresApi.revokeHr(id);access.value=await closuresApi.hrAccess();});}
function task(pid:any,id:any){router.push(taskManagementLocation(pid,id));}
defineExpose({openDelay});
</script>
<template>
  <div v-if="auth.user?.roles?.includes('admin')" class="tools ledger-tools">
    <el-button v-if="auth.user?.roles?.includes('admin')" @click="openAccess">HR 阅览授权</el-button>
  </div>
  <el-dialog v-model="detailVisible" class="ledger-dialog" title="延期记录详情" width="min(860px,96vw)" align-center>
    <template v-if="detail">
      <div class="ledger-heading">
        <div><h3>{{ detail.snapshot.projectName }}</h3><p>{{ detail.snapshot.title }}</p></div>
        <el-button v-if="detail.task_id" type="primary" plain @click="task(detail.project_id,detail.task_id)">定位任务</el-button>
      </div>
      <div class="ledger-meta"><span>当时截止：{{ detail.snapshot.dueAt||'—' }}</span><span class="timing-warning">当次记录 {{ detail.snapshot.days }} 天</span><span>留档于 {{ formatBeijingTime(detail.observed_at) }}</span></div>
      <section class="ledger-section">
        <div class="section-heading"><h4>处理记录</h4><el-tag :type="detail.history[0]?.status === 'resolved' ? 'success' : 'warning'" size="small">{{ states[detail.history[0]?.status||'open'] }}</el-tag></div>
        <div v-if="detail.canHandle" class="record-actions"><el-button v-for="(label,key) in states" :key="key" :loading="busy" @click="follow('delay',Number(detail.id),String(key))">{{ label }}</el-button></div>
        <p v-if="!detail.history.length" class="empty-copy">暂无处理说明</p>
        <article v-for="h in detail.history" :key="h.id" class="ledger-record"><strong>{{ states[h.status] }}</strong><p class="record-meta">{{ h.user_name }} · {{ formatBeijingTime(h.created_at) }}</p><p class="text">{{ h.comment }}</p></article>
      </section>
      <section class="ledger-section">
        <h4>关联结项申请与报告</h4>
        <article v-for="r in detail.reports" :key="r.id" class="ledger-record"><el-button link type="primary" @click="router.push({path:'/closure-reports',query:{request:r.id}})">查看结项记录 #{{ r.id }}</el-button><p class="record-meta">时间差异由系统自动记录，详见结项记录。</p><p v-if="r.delay_reason" class="text">历史延迟申请说明：{{ r.delay_reason }}</p><p v-if="r.overdue_reason" class="text">历史超期申请说明：{{ r.overdue_reason }}</p></article>
        <p v-if="!detail.reports.length" class="empty-copy">暂无结项记录</p>
      </section>
      <section class="ledger-section">
        <h4>关联计划变更</h4>
        <article v-for="c in detail.changes" :key="c.id" class="ledger-record"><div class="section-heading"><strong>变更 #{{ c.id }}</strong><el-tag :type="c.status==='approved' ? 'success' : c.status==='pending' ? 'warning' : 'info'" size="small">{{ c.status==='approved'?'已通过':c.status==='pending'?'待审批':'未通过或已撤销' }}</el-tag></div><p class="text">{{ c.reason }}</p><p v-for="i in c.items" :key="i.id" class="record-meta">任务 #{{ i.task_id }} · {{ i.before?.dueAt||'—' }} → {{ i.after?.dueAt||'—' }}</p></article>
        <p v-if="!detail.changes.length" class="empty-copy">暂无关联变更</p>
      </section>
      <section class="ledger-section">
        <h4>合理补填告知</h4>
        <article v-for="n in detail.notices" :key="n.id" class="ledger-record"><p class="text">{{ n.payload.text }}</p><p class="record-meta">{{ n.recipient_name }} · {{ n.acknowledged_at?'已知晓 '+formatBeijingTime(n.acknowledged_at):'待知晓' }}{{ n.payload.revokedAt?' · 标记已撤销':'' }}</p></article>
        <p v-if="!detail.notices.length" class="empty-copy">暂无关联告知</p>
      </section>
    </template>
    <template #footer><el-button @click="detailVisible=false">关闭</el-button></template>
  </el-dialog>
  <el-dialog v-model="auditVisible" class="ledger-dialog" title="历史合理补填核查" width="min(980px,96vw)" align-center>
    <el-alert title="仅列出工作日期晚于对比截止日期或截止依据缺失的合理补填。历史原始依据缺失时使用当前计划作线索，须人工核实；记录处理结论不会自动修改原始进展。" type="info" :closable="false" />
    <div class="audit-filter"><el-select v-model="state" placeholder="全部处理状态" aria-label="处理状态筛选" clearable><el-option v-for="(label,key) in states" :key="key" :value="key" :label="label" /></el-select></div>
    <el-empty v-if="!audit.length" description="未发现需核查记录" :image-size="72" />
    <article v-for="r in audit.filter(r=>!state||r.handling_status===state)" :key="r.id" class="audit-record">
      <div class="section-heading"><h4>{{ r.project_name }} · {{ r.title }}</h4><el-tag :type="r.handling_status==='resolved' ? 'success' : 'warning'" size="small">{{ states[r.handling_status] }}</el-tag></div>
      <p class="record-meta">{{ r.author_name }} · 工作日期 {{ r.work_date }} · 对比截止 {{ r.comparison_due||'缺失' }}</p>
      <p class="record-meta">{{ r.comparison_source }}</p><p class="text">{{ r.content }}</p><p class="text">原合理补填原因：{{ r.exempt_reason||'未填写' }}</p>
      <div class="record-actions"><el-button type="primary" plain @click="task(r.project_id,r.task_id)">定位任务核实</el-button><template v-if="r.canHandle"><el-button v-for="(label,key) in states" :key="key" :loading="busy" @click="follow('supplement_audit',Number(r.id),String(key))">{{ label }}</el-button></template></div>
      <p v-for="h in r.history" :key="h.id" class="history-note">{{ h.user_name }} · {{ formatBeijingTime(h.created_at) }} · {{ states[h.status] }}：{{ h.comment }}</p>
    </article>
    <template #footer><el-button @click="auditVisible=false">关闭</el-button></template>
  </el-dialog>
  <el-dialog v-model="accessVisible" class="ledger-dialog" title="HR 阅览授权" width="min(780px,96vw)" align-center>
    <template v-if="access">
      <el-alert title="授权人员可查看并导出指定部门的结项报告及台账。此处不更换 HR 通知接收人，也不授予审批或修改项目的权限。" type="info" :closable="false" />
      <div class="grant-form"><el-select v-model="userId" filterable placeholder="选择人员" aria-label="授权人员"><el-option v-for="u in access.users" :key="u.id" :value="Number(u.id)" :label="u.name+'（'+u.id+'）'" /></el-select><el-select v-model="deptId" clearable filterable placeholder="全部部门" aria-label="授权部门"><el-option v-for="d in access.departments" :key="d.id" :value="Number(d.id)" :label="d.name" /></el-select><el-button type="primary" :loading="busy" @click="grant">添加授权</el-button></div>
      <article v-for="g in access.grants" :key="g.id" class="grant-record"><div><div class="section-heading"><strong>{{ g.name }}</strong><el-tag :type="g.revoked_at ? 'info' : 'success'" size="small">{{ g.revoked_at?'已撤销':'有效' }}</el-tag></div><p class="record-meta">{{ g.dept_name||'全部部门' }} · {{ formatBeijingTime(g.created_at) }}</p></div><el-button v-if="!g.revoked_at" link type="danger" :loading="busy" @click="revoke(Number(g.id))">撤销</el-button></article>
    </template>
    <template #footer><el-button @click="accessVisible=false">关闭</el-button></template>
  </el-dialog>
</template>
<style scoped>
.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ledger-tools { justify-content: flex-end; margin: 0 0 16px; }
.tools .el-button, .record-actions .el-button { margin-left: 0; }
.ledger-dialog { color: var(--text-1); }
.ledger-dialog :deep(.el-dialog__header) { padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.ledger-dialog :deep(.el-dialog__body) { max-height: 68vh; overflow-y: auto; padding-top: 20px; }
.ledger-dialog :deep(.el-dialog__footer) { padding-top: 16px; border-top: 1px solid var(--border); }
.ledger-heading { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
.ledger-heading > div { flex: 1; min-width: 180px; }
.ledger-heading h3 { margin: 0; color: var(--text-1); font-size: 18px; font-weight: 650; line-height: 1.5; overflow-wrap: anywhere; }
.ledger-heading p { margin: 6px 0 0; color: var(--text-2); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.ledger-meta { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 16px 0 20px; color: var(--text-2); font-size: 13px; font-variant-numeric: tabular-nums; }
.timing-warning { color: #996015; font-weight: 600; }
.ledger-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
.ledger-section h4, .audit-record h4 { margin: 0; color: var(--text-1); font-size: 15px; font-weight: 600; line-height: 1.6; overflow-wrap: anywhere; }
.section-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.section-heading strong { color: var(--text-1); font-size: 14px; font-weight: 600; }
.ledger-record { padding: 14px 0; border-bottom: 1px solid var(--color-border-light); }
.ledger-record:last-child { border-bottom: 0; padding-bottom: 0; }
.record-meta { margin: 6px 0; color: var(--text-2); font-size: 13px; line-height: 1.7; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.text { margin: 8px 0; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; }
.empty-copy { margin: 12px 0 0; color: var(--text-2); font-size: 13px; }
.record-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.audit-filter { display: flex; margin: 16px 0 20px; }
.audit-filter .el-select { width: 220px; }
.audit-record { padding: 20px 0; border-top: 1px solid var(--border); }
.history-note { padding-top: 10px; margin: 12px 0 0; border-top: 1px solid var(--color-border-light); color: var(--text-2); font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.grant-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 12px; margin: 20px 0; }
.grant-form .el-select { width: 100%; min-width: 0; }
.grant-record { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 0; border-top: 1px solid var(--border); }
.grant-record > div { min-width: 0; }
@media (max-width: 640px) {
  .ledger-tools { justify-content: flex-start; }
  .grant-form { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .audit-filter .el-select { width: 100%; }
  .ledger-meta, .record-meta, .history-note, .empty-copy { font-size: 14px; }
  .record-actions .el-button, .grant-form .el-button { min-height: 40px; }
}
</style>
