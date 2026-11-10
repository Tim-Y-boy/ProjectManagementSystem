<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { tasksApi } from '@/api';
import type { WeeklyEvidence, WeeklyEvidenceItem } from '@/api/project-weekly-reports';
import { formatBeijingTime } from '@/utils/date-time';
const props = defineProps<{ evidence: WeeklyEvidence; projectId?: number; weekStart?: string; weekEnd?: string }>();

const groups = computed(() => {
  const map = new Map<string, WeeklyEvidenceItem[]>();
  for (const item of props.evidence.updates || []) {
    const key = item.taskId != null ? `task:${item.taskId}` : `record:${item.id}`;
    map.set(key, [...(map.get(key) || []), item]);
  }
  const order = (a: WeeklyEvidenceItem, b: WeeklyEvidenceItem) => (b.workDate || b.createdAt || '').localeCompare(a.workDate || a.createdAt || '') || b.id - a.id;
  const current = [...map].map(([key, items]) => ({ key, task: items[0], items: [...items].sort(order) })).sort((a,b) => order(a.items[0],b.items[0]));
  const missing = (props.evidence.activeTasks || []).filter(task => !map.has(`task:${task.taskId}`))
    .map(task => ({ key: `task:${task.taskId}`, task, items: [] as WeeklyEvidenceItem[] }));
  return [...current, ...missing];
});


const when = (item: WeeklyEvidenceItem) => item.workDate || (item.createdAt ? formatBeijingTime(item.createdAt) : item.dueAt || '—');
const source = (item: WeeklyEvidenceItem) => item.sourcePath?.startsWith('/') && !item.sourcePath.startsWith('//');
const history = reactive<Record<string, { loading: boolean; error: string; items: WeeklyEvidenceItem[]; loaded: boolean }>>({});
let generation = 0;
// Autosave replaces evidence without changing the report. Keep expanded history intact.
watch(() => [props.projectId, props.weekStart, props.weekEnd], () => { generation++; for (const key of Object.keys(history)) delete history[key]; });
async function loadHistory(group: { key: string; task: WeeklyEvidenceItem; items: WeeklyEvidenceItem[] }) {
  if (history[group.key]?.loaded || history[group.key]?.loading) return;
  const item = group.task;
  if (!item.taskId) return;
  const token = generation;
  history[group.key] = { loading: true, error: '', items: [], loaded: false };
  const state = history[group.key];
  try {
    const rows = await tasksApi.dailyUpdates(item.taskId);
    if (token !== generation) return;
    const currentIds = new Set(group.items.map(row => row.id));
    state.items = rows.filter(row => {
      const day = String(row.workDate || '').slice(0,10);
      return !currentIds.has(row.id) && !!day && (!props.weekStart || !props.weekEnd || day < props.weekStart || day > props.weekEnd);
    }).map(row => ({ ...row, sourcePath: item.sourcePath }));
    state.loaded = true;
  } catch { state.error = '加载失败，请重试'; }
  finally { state.loading = false; }
}
</script>
<template>
  <section class="evidence">
    <h3 class="evidence-title">任务进展</h3>
    <div class="table-surface">
    <table class="progress-table" aria-label="任务进展">
      <colgroup><col class="name-col" /><col /></colgroup>
      <thead><tr><th scope="col">任务名称</th><th scope="col">本周进展</th></tr></thead>
      <tbody>
        <tr v-if="!groups.length"><td colspan="2" class="empty-progress">本周暂无关键进展</td></tr>
        <tr v-for="group in groups" :key="group.key">
          <th scope="row">{{ group.task.taskTitle || group.task.title || '未命名任务' }}</th>
          <td>
            <p v-if="!group.items.length" class="meta">本周未填写进展</p>
            <div v-for="item in group.items" :key="item.id" class="record">
              <div class="meta">{{ when(item) }}<template v-if="item.userName"> · {{ item.userName }}</template></div>
              <router-link v-if="source(item)" class="progress-text" :to="item.sourcePath!">{{ item.content || item.risk || item.nextPlan || '查看进展' }}</router-link>
              <p v-else>{{ item.content }}</p>
              <p v-if="item.risk && item.content" class="risk">风险：{{ item.risk }}</p>
              <p v-if="item.nextPlan && item.content">下一步：{{ item.nextPlan }}</p>
            </div>
            <details v-if="group.task.taskId && (group.items.length || group.task.hasHistory)" @toggle="($event.target as HTMLDetailsElement).open && loadHistory(group)">
              <summary>其他周进展</summary>
              <p v-if="history[group.key]?.loading" class="meta">加载中…</p>
              <button v-else-if="history[group.key]?.error" class="retry" @click="loadHistory(group)">{{ history[group.key].error }}</button>
              <template v-else-if="history[group.key]?.loaded">
                <p v-if="!history[group.key].items.length" class="meta">暂无其他周进展</p>
                <div v-for="item in history[group.key].items" :key="item.id" class="record history-record">
                  <div class="meta">{{ when(item) }}</div>
                  <router-link v-if="source(item)" class="progress-text" :to="item.sourcePath!">{{ item.content || item.risk || item.nextPlan || '查看进展' }}</router-link>
                  <p v-else>{{ item.content }}</p>
                  <p v-if="item.risk && item.content" class="risk">风险：{{ item.risk }}</p>
                  <p v-if="item.nextPlan && item.content">下一步：{{ item.nextPlan }}</p>
                </div>
              </template>
            </details>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <template v-for="group in [{key:'tasks',title:'临期及延期任务'}, {key:'assets',title:'交付资料'}] as const" :key="group.key">
      <section v-if="evidence[group.key]?.length" class="supporting">
        <h3 class="evidence-title">{{ group.title }}</h3>
        <div class="table-surface">
        <table class="progress-table" :aria-label="group.title">
          <colgroup><col /><col style="width:36%" /></colgroup>
          <thead><tr><th scope="col">{{ group.key === 'tasks' ? '任务名称' : '资料名称' }}</th><th scope="col">{{ group.key === 'tasks' ? '计划截止' : '上传时间' }}</th></tr></thead>
          <tbody><tr v-for="item in evidence[group.key]" :key="item.id">
            <td><router-link v-if="source(item)" :to="item.sourcePath!">{{ item.taskTitle || item.title }}</router-link><span v-else>{{ item.taskTitle || item.title }}</span><p v-if="item.content">{{ item.content }}</p></td>
            <td class="meta">{{ when(item) }}</td>
          </tr></tbody>
        </table>
        </div>
      </section>
    </template>
  </section>
</template>
<style scoped>
.evidence { min-width:0; align-self:start; }
.evidence-title { margin:0 0 14px; font-size:17px; font-weight:600; line-height:26px; color:var(--el-color-primary-dark-2); }
.table-surface { border:1px solid #dfe7e2; border-radius:12px; overflow:hidden; background:white; box-shadow:0 3px 12px rgba(32,72,59,.06); }
.progress-table { width:100%; table-layout:fixed; border-collapse:separate; border-spacing:0; background:white; font-size:16px; }
.name-col { width:26%; }
.empty-progress { color:#65736e; text-align:center; padding:24px 12px; }
th,td { border:0; border-right:1px solid #e6ece8; border-bottom:1px solid #e6ece8; padding:12px; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
tr > :last-child { border-right:0; }
tbody tr:last-child > * { border-bottom:0; }
thead th { background:#edf4f1; font-weight:600; }
tbody th { font-weight:500; line-height:1.7; }
.meta { color:#65736e; font-size:14px; line-height:1.6; margin-bottom:4px; }
.record + .record { margin-top:16px; }
p,.progress-text { display:block; white-space:pre-wrap; overflow-wrap:anywhere; font-size:16px; line-height:1.8; margin:0; }
a { color:var(--el-color-primary); text-decoration:none; }
a:hover { text-decoration:underline; text-underline-offset:3px; }
.risk { color:#a34732; }
details { margin-top:14px; } summary { cursor:pointer; color:#52645d; font-size:14px; }
.history-record { margin-top:12px; padding-top:10px; border-top:1px solid #edf0ee; }
.retry { background:none; border:0; padding:8px 0; color:var(--el-color-primary); cursor:pointer; }
.supporting { margin-top:24px; }
a:focus-visible,summary:focus-visible,.retry:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:3px; }
@media(max-width:600px) { th,td { padding:10px 8px; } .name-col { width:25%; } }
</style>
