<script setup lang="ts">
import { ref, watch, onMounted, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { dashboardApi } from '@/api';
import { useRefreshStore } from '@/stores/refresh';
import { formatBeijingTime } from '@/utils/date-time';
const props = defineProps<{ mobile?: boolean; reloadKey?: number }>();
const emit = defineEmits<{ count: [value: number] }>();
const router = useRouter();
const refresh = useRefreshStore();
const rows = ref<any[]>([]), loading = ref(false), error = ref('');
const now = ref(Date.now());
const pending = computed(() => rows.value.filter(r => ['pending', 'pending_accept', 'pending_confirm'].includes(r.status)).sort((a,b) => Date.parse(a.date)-Date.parse(b.date)));
let version = 0, loaded = false;
async function load() {
  const current = ++version; loading.value = true; error.value = '';
  try { const result = await dashboardApi.approvalRecords('mine'); if (current !== version) return; rows.value = result; now.value = Date.now(); emit('count', pending.value.length); loaded = true; }
  catch(e:any) { if(current === version) error.value = e.message || '申请加载失败'; }
  finally { if(current === version) loading.value = false; }
}
function waiting(date: string) { const time=Date.parse(date); if(!Number.isFinite(time))return '提交时间待核实'; const days=Math.floor(Math.max(0,now.value-time)/86400000); return days ? `已等待 ${days} 天` : '提交不足 1 天'; }
function open(row:any) { const url=new URL(row.path,window.location.origin); router.push({path:props.mobile?'/mobile/approve':'/approvals',query:{...Object.fromEntries(url.searchParams),view:'mine'}}); }
onMounted(load); onActivated(() => { if(loaded)void load(); });
watch(() => [props.reloadKey,refresh.versions.task,refresh.versions.project,refresh.versions.planChange],load);
</script>
<template>
  <section class="waiting-approvals" :aria-busy="loading">
    <p>我已提交，正在等待他人审批。共 {{ pending.length }} 项，按提交时间从早到晚排列。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-skeleton v-if="loading && !rows.length" :rows="4" animated />
    <article v-for="row in pending" :key="row.key">
      <div><p>{{ row.project }}</p><h3>{{ row.title }}</h3><p>提交时间：{{ formatBeijingTime(row.date) }}</p><p>当前审批人：{{ row.currentApproverName || '请在详情中查看审批流程' }}</p><strong class="waiting-time">{{ waiting(row.date) }}</strong></div>
      <el-button @click="open(row)">查看详情</el-button>
    </article>
    <el-empty v-if="!loading && !error && !pending.length" description="暂无等待他人审批的申请" />
  </section>
</template>
<style scoped>
.waiting-approvals>p{color:#60736b;font-size:13px}.waiting-approvals article{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px;background:white;border:1px solid #e1eae5;border-radius:14px;margin:12px 0}.waiting-approvals p{color:#60736b;line-height:1.7;margin:4px 0;font-size:13px}.waiting-approvals h3{margin:6px 0;font-size:16px}.waiting-time{display:inline-block;background:#fff2d9;color:#935000;padding:4px 9px;border-radius:6px;font-size:13px}
</style>
