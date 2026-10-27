<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { closuresApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { formatBeijingTime } from '@/utils/date-time';
const props=defineProps<{request:any}>(); const emit=defineEmits<{updated:[]}>();
const auth=useAuthStore(); const busy=ref(false);
const labels:Record<string,string>={pending:'待审批',approved:'已通过',rejected:'已退回'};
async function action(kind:'withdraw'|'reopen'|'approve'|'reject',id:number) {
  try {
    const titles={withdraw:'撤回结项申请',reopen:'申请重开纠错',approve:'通过重开纠错',reject:'退回重开申请'};
    const {value}=await ElMessageBox.prompt(kind==='reopen'||kind==='approve'?'通过总经办审批后恢复编辑，原结项报告标记失效并保留，HR将收到纠正通知。请填写原因。':'请填写原因或审核意见。',titles[kind],{inputType:'textarea',inputValidator:v=>!!v?.trim()&&v.trim().length<=4000||'请填写1～4000字'});
    busy.value=true;
    if(kind==='withdraw') await closuresApi.withdraw(id,value);
    else if(kind==='reopen') await closuresApi.reopen(id,value);
    else await closuresApi.reviewReopen(id,kind==='approve',value);
    ElMessage.success('操作已保存'); emit('updated');
  } catch(e:any) {if(e!=='cancel'&&e!=='close'&&!e.messageShown) ElMessage.error(e.message||'操作失败');}
  finally {busy.value=false;}
}
</script>
<template>
  <section class="actions">
    <el-button v-if="request.status==='pending'&&String(request.requester_id)===String(auth.user?.id)" plain :loading="busy" @click="action('withdraw',Number(request.id))">撤回申请</el-button>
    <el-button v-if="request.status==='approved'&&request.isOwner&&!request.reopens?.some((r:any)=>r.status==='pending')" plain :loading="busy" @click="action('reopen',Number(request.id))">申请重开纠错</el-button>
    <article v-for="r in request.reopens||[]" :key="r.id" class="reopen-record">
      <div class="record-heading"><strong>重开纠错</strong><span class="record-status" :class="r.status">{{ labels[r.status] }}</span></div>
      <p class="record-meta">{{ r.requester_name }} · {{ formatBeijingTime(r.created_at) }}</p>
      <p class="text">申请原因：{{ r.reason }}</p>
      <p class="record-meta">审核人：{{ r.approver_name }} · {{ formatBeijingTime(r.reviewed_at) }}</p>
      <p v-if="r.comment" class="text">审核意见：{{ r.comment }}</p>
      <div v-if="r.status==='pending'&&String(r.approver_id)===String(auth.user?.id)" class="review-actions">
        <el-button type="danger" plain :loading="busy" @click="action('reject',Number(r.id))">退回重开</el-button>
        <el-button type="primary" :loading="busy" @click="action('approve',Number(r.id))">通过重开</el-button>
      </div>
    </article>
  </section>
</template>
<style scoped>
.actions { margin-top: 20px; color: var(--text-1); font-size: 14px; }
.actions:empty { display: none; }
.actions > .el-button { margin-bottom: 16px; }
.reopen-record { padding: 16px 0; border-top: 1px solid var(--border); }
.reopen-record:last-child { padding-bottom: 0; }
.record-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.record-heading strong { font-size: 15px; font-weight: 600; }
.record-status { display: inline-flex; padding: 2px 10px; border-radius: var(--radius-sm); background: var(--color-bg); color: var(--text-2); font-size: 12px; font-weight: 600; line-height: 22px; }
.record-status.pending { color: #996015; background: var(--color-warning-bg); }
.record-status.approved { color: var(--color-primary-700); background: var(--color-success-bg); }
.record-status.rejected { color: var(--color-danger); background: var(--color-danger-bg); }
.record-meta { margin: 8px 0; color: var(--text-2); font-size: 13px; line-height: 1.6; font-variant-numeric: tabular-nums; }
.text { margin: 8px 0 12px; color: var(--text-1); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
.review-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.review-actions .el-button { margin-left: 0; }
@media (max-width: 640px) {
  .record-meta { font-size: 14px; }
  .review-actions .el-button { min-height: 40px; }
}
</style>
