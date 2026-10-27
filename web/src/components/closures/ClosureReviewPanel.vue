<script setup lang="ts">
import { computed, shallowRef, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { closuresApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { formatBeijingTime } from '@/utils/date-time';
import ClosureChecklist from './ClosureChecklist.vue';
const props=defineProps<{request:any}>();const emit=defineEmits<{updated:[]}>();const auth=useAuthStore();
const w=computed(()=>props.request.snapshot.workflow);
const myReviews=computed(()=>w.value?.reviews.filter((r:any)=>Number(r.userId)===Number(auth.user?.id)&&r.status==='pending')||[]);
const checklists=ref<any[]>([]);
watch(()=>props.request,()=>{checklists.value=[];},{immediate:true});
const mine=computed(()=>props.request.status==='pending'&&w.value?.stage==='reviewers'&&w.value.reviews.some((r:any)=>Number(r.userId)===Number(auth.user?.id)&&r.status==='pending'));
const target=shallowRef<number>();const reason=shallowRef('');const comment=shallowRef('');const saving=shallowRef(false);const showTransfer=shallowRef(false);
const candidates=computed(()=>props.request.reviewerCandidates?.filter((p:any)=>Number(p.id)!==Number(props.request.approver_id)&&Number(p.id)!==Number(props.request.requester_id)&&!w.value.reviews.some((r:any)=>Number(r.userId)===Number(p.id)))||[]);
const labels:Record<string,string>={pending:'待审核',approved:'已通过',rejected:'已退回'};
async function decide(approve:boolean){
  if(!comment.value.trim()){ElMessage.warning('请填写审核意见');return;}
  saving.value=true;
  try{await (approve?closuresApi.approve:closuresApi.reject)(Number(props.request.id),comment.value,checklists.value);ElMessage.success(approve?'审核已通过':'已退回项目负责人');comment.value='';emit('updated');}
  catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'操作失败');}finally{saving.value=false;}
}
async function transfer(){
  if(!target.value||!reason.value.trim()){ElMessage.warning('请选择接收人并填写转交原因');return;}
  saving.value=true;
  try{await closuresApi.transfer(Number(props.request.id),target.value,reason.value);showTransfer.value=false;emit('updated');ElMessage.success('已转交审核');}
  catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'转交失败');}finally{saving.value=false;}
}
</script>
<template>
  <section v-if="w" class="review-panel">
    <h3>结项审核 · 第 {{ w.round }} 轮</h3>
    <p class="final-hint">最后一级审核人：<strong>总经理 · {{ request.snapshot.approver?.name }}</strong>。所有前置审核通过后进入终审。</p>
    <el-table :data="w.reviews" size="small">
      <el-table-column v-if="w.version===3" prop="departmentName" label="审核部门" min-width="100" />
      <el-table-column prop="name" label="审核人" min-width="90" />
      <el-table-column label="结果" min-width="105"><template #default="{row}"><el-tag :type="row.status==='approved'?'success':row.status==='rejected'?'danger':'warning'">{{ labels[row.status] }}</el-tag><small v-if="row.sourceRequestId">沿用上次审核</small></template></el-table-column>
      <el-table-column prop="comment" label="审核意见" min-width="180" />
      <el-table-column label="审核时间" min-width="160"><template #default="{row}">{{ row.reviewedAt?formatBeijingTime(row.reviewedAt):'—' }}</template></el-table-column>
    </el-table>
    <div v-if="mine" class="review-editor">
      <ClosureChecklist v-if="w.version===3" v-model="checklists" :reviews="myReviews" />
      <el-input v-model="comment" type="textarea" :autosize="{minRows:3,maxRows:8}" maxlength="4000" show-word-limit placeholder="请填写核验结果与审核意见" />
      <div class="review-buttons"><el-button v-if="w.version!==3" :disabled="saving" @click="showTransfer=true">转交审核</el-button><el-button type="danger" plain :loading="saving" @click="decide(false)">退回</el-button><el-button type="primary" :loading="saving" @click="decide(true)">通过审核</el-button></div>
    </div>
    <details v-if="request.reviewHistory?.length"><summary>审核与转交历史</summary><div v-for="h in request.reviewHistory" :key="h.id" class="history-entry"><strong>申请 #{{ h.id }}</strong><div v-for="(event,i) in h.workflow?.events||[]" :key="i">{{ formatBeijingTime(event.at) }} · {{ event.type==='transfer'||event.type==='reviewer_replaced'?`${event.fromName} ${event.type==='transfer'?'转交给':'替换为'} ${event.toName}：${event.reason}`:`${event.name||'总经理'} · ${event.type.includes('rejected')?'退回':'通过'}：${event.comment}` }}</div></div></details>
    <el-dialog v-model="showTransfer" title="转交审核" width="min(520px,94vw)" append-to-body>
      <el-form label-position="top"><el-form-item label="接收人" required><el-select v-model="target" filterable placeholder="选择实际负责审核的人员" style="width:100%"><el-option v-for="p in candidates" :key="p.id" :value="Number(p.id)" :label="p.name" /></el-select></el-form-item><el-form-item label="转交原因" required><el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" show-word-limit /></el-form-item></el-form>
      <template #footer><el-button @click="showTransfer=false">取消</el-button><el-button type="primary" :loading="saving" @click="transfer">确认转交</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.review-panel{padding:20px 28px;border:1px solid var(--border);border-radius:10px;margin:16px 20px;background:var(--bg-card)}.review-panel h3{margin:0 0 10px;color:var(--text-1)}.final-hint{font-size:13px;color:var(--text-2)}.review-panel small{display:block;color:var(--text-2);margin-top:5px}.review-editor{margin-top:16px}.review-buttons{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.review-panel details{margin-top:16px;font-size:13px}.review-panel summary{cursor:pointer;font-weight:600}.history-entry{padding:10px 0;border-bottom:1px solid var(--border);line-height:1.8}@media(max-width:650px){.review-panel{margin:12px 4px;padding:14px}}
</style>
