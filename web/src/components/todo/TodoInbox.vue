<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { closuresApi } from '@/api';
import { useTodoInbox } from '@/composables/useTodoInbox';
import { inboxFilter, groupInboxProjects, type InboxFilter, type InboxItem } from '@/utils/todo-inbox';
import CountPill from '@/components/CountPill.vue';
import WaitingApprovals from './WaitingApprovals.vue';
import TodoInboxItem from './TodoInboxItem.vue';

const props = defineProps<{ mobile?: boolean; approvalOnly?: boolean; approvalType?: string }>();
const route = useRoute();
const router = useRouter();
const { rows, counts, errors, loading, reload } = useTodoInbox();
const busyId = ref<number>();
const waitingCount = ref(0);
const waitingReload = ref(0);
function reloadAll() { waitingReload.value++; void reload(); }
const filter = computed(() => props.approvalOnly ? 'approve' : route.query.tab === 'waiting' ? 'waiting' : inboxFilter(route.query.tab));
const sections = [{ key: 'approve', label: '待我审批' }, { key: 'todo', label: '待我执行' }, { key: 'inform', label: '知晓通知' }] as const;
const filters = [{ key: 'all', label: '全部待处理' }, ...sections] as const;
const focusedKey = computed(() => route.query.changeId ? `change-${route.query.changeId}` : route.query.confirmId ? `confirm-${route.query.confirmId}` : route.query.taskId ? `accept-${route.query.taskId}` : route.query.notice ? `notice-${route.query.notice}` : '');
const informState = computed(() => route.query.read === 'done' ? 'done' : 'pending');
const informCounts = computed(() => ({ pending: rows.value.filter(r => r.category === 'inform' && !r.done).length, done: rows.value.filter(r => r.category === 'inform' && r.done).length }));
const visible = computed(() => rows.value.filter(r => {
  if (props.approvalOnly && r.category !== 'approve') return false;
  if (filter.value === 'inform') return r.category === 'inform' && !!r.done === (informState.value === 'done');
  return (filter.value === 'all' || r.category === filter.value || r.key === focusedKey.value)
    && (!r.done || r.key === focusedKey.value)
    && (!props.approvalType || r.approvalType === props.approvalType || r.key === focusedKey.value);
}));
const groups = computed(() => sections.map(s => {
  const items = visible.value.filter(r => r.category === s.key);
  return { ...s, rows: items, projects: groupInboxProjects(items) };
}).filter(s => s.rows.length));
const collapsed = ref(new Set<string>());
const groupKey = (category: string, project: string) => `${category}-${project}`;
function toggleProject(key: string) {
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  collapsed.value = next;
}
function collapseAll() {
  collapsed.value = new Set([...collapsed.value, ...groups.value.flatMap(g => g.projects.map(p => groupKey(g.key, p.key)))]);
}
function select(tab: InboxFilter | 'waiting') { router.replace({ query: { ...route.query, tab, notice: undefined, taskId: undefined, changeId: undefined, confirmId: undefined, read: undefined } }); }
function selectInform(read: string) { router.replace({ query: { ...route.query, read, notice: undefined } }); }
function open(item: InboxItem) {
  router.push(props.mobile && item.mobilePath ? item.mobilePath : item.path);
}
async function acknowledge(item: InboxItem) {
  if (!item.noticeId) return;
  busyId.value = item.noticeId;
  try { await closuresApi.acknowledge(item.noticeId); ElMessage.success('已记录知晓'); if (route.query.notice) await router.replace({ query: { ...route.query, notice: undefined } }); await reload(); }
  catch (e: any) { if (!e.messageShown) ElMessage.error(e.message || '确认失败，请重试'); }
  finally { busyId.value = undefined; }
}
watch([focusedKey, rows], async () => {
  if (!focusedKey.value) return;
  const target = rows.value.find(r => r.key === focusedKey.value);
  if (filter.value === 'inform' && target?.category === 'inform' && !!target.done !== (informState.value === 'done')) {
    await router.replace({ query: { ...route.query, read: target.done ? 'done' : 'pending' } });
  }
  for (const group of groups.value) for (const project of group.projects) {
    if (project.rows.some(r => r.key === focusedKey.value)) collapsed.value.delete(groupKey(group.key, project.key));
  }
  await nextTick();
  document.getElementById(focusedKey.value)?.scrollIntoView({ block: 'center' });
});
</script>

<template>
  <div class="todo-inbox" :aria-busy="loading">
    <header v-if="!approvalOnly" class="toolbar">
      <div><h2>需要我处理</h2><p>审批、验收、执行和知晓，集中在这里处理</p></div>
      <div class="tools"><el-button :loading="loading" @click="reloadAll">刷新</el-button></div>
    </header>
    <nav v-if="!approvalOnly" class="filters" aria-label="待办分类">
      <button v-for="s in filters" :key="s.key" :aria-pressed="filter === s.key" :class="{ active: filter === s.key }" @click="select(s.key)">{{ s.label }} <CountPill :count="counts[s.key]" /></button>
      <button :aria-pressed="filter === 'waiting'" :class="{ active: filter === 'waiting' }" @click="select('waiting')">待他人审批 <CountPill :count="waitingCount" /></button>
    </nav>
    <WaitingApprovals v-if="!approvalOnly" v-show="filter === 'waiting'" :mobile="mobile" :reload-key="waitingReload" @count="waitingCount = $event" />
    <nav v-if="filter === 'inform'" class="filters" aria-label="知晓状态">
      <button :class="{ active: informState === 'pending' }" @click="selectInform('pending')">待知晓 {{ informCounts.pending }}</button>
      <button :class="{ active: informState === 'done' }" @click="selectInform('done')">已知晓 {{ informCounts.done }}</button>
    </nav>
    <el-alert v-for="error in errors" :key="error" :title="error" type="error" :closable="false" show-icon />
    <div v-show="filter !== 'waiting'" class="inbox-content">
      <div class="list-tools"><span class="hint">{{ loading ? '正在更新…' : `当前显示 ${visible.length} 项` }}</span><div class="tools"><el-button link @click="collapsed = new Set()">全部展开</el-button><el-button link @click="collapseAll">全部收起</el-button></div></div>
      <el-alert v-if="focusedKey && !loading && !rows.some(r => r.key === focusedKey)" title="该事项当前不在您的待办中，可能已处理、已撤回或审批人已变更。请刷新确认；若仍有疑问，请联系提交人。" type="info" :closable="false" />
      <section v-for="group in groups" :key="group.key" class="inbox-section" :aria-label="group.label">
        <h2>{{ group.label }} <span>{{ group.rows.length }}</span></h2>
        <div v-for="project in group.projects" :key="project.key" class="project-group">
          <button type="button" class="project-toggle" :aria-expanded="!collapsed.has(groupKey(group.key, project.key))" :aria-controls="`items-${groupKey(group.key, project.key)}`" @click="toggleProject(groupKey(group.key, project.key))">
            <span class="chevron" aria-hidden="true">{{ collapsed.has(groupKey(group.key, project.key)) ? '▸' : '▾' }}</span>
            <span class="project-name">{{ project.name }}</span><span class="project-total">{{ project.rows.length }} 项</span>
            <span v-if="project.overdue" class="project-risk">延期 {{ project.overdue }}</span><span v-if="project.weekly" class="project-risk">待补填 {{ project.weekly }}</span>
            <span class="toggle-label">{{ collapsed.has(groupKey(group.key, project.key)) ? '展开' : '收起' }}</span>
          </button>
          <div v-show="!collapsed.has(groupKey(group.key, project.key))" class="project-items" :id="`items-${groupKey(group.key, project.key)}`">
            <TodoInboxItem v-for="item in project.rows" :key="item.key" :item="item" hide-project :mobile="mobile" :focused="item.key === focusedKey" :busy="busyId === item.noticeId" @open="open" @acknowledge="acknowledge" @reviewed="reload" />
          </div>
        </div>
      </section>
      <el-skeleton v-if="loading && !rows.length" :rows="5" animated />
      <el-empty v-else-if="!loading && !errors.length && !visible.length" :description="filter === 'inform' ? (informState === 'done' ? '暂无已知晓通知' : '暂无待知晓通知') : '当前没有需要处理的事项'"><el-button v-if="!approvalOnly && filter !== 'all'" @click="select('all')">查看全部待处理（{{ counts.all }}）</el-button></el-empty>
    </div>
  </div>
</template>

<style scoped>
.todo-inbox { color:#243e34; min-width:0; }
.toolbar,.tools,.list-tools,.project-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.toolbar { margin-bottom:22px; }
.toolbar h2 { font-size:22px; margin:0 0 7px; }
.toolbar p,.hint { font-size:13px; color:#60736b; margin:0; line-height:1.6; }
.tools { flex-wrap:wrap; }
.tools :deep(.el-button) { margin-left:0; }
.filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
.filters button { display:inline-flex;align-items:center;justify-content:center;line-height:20px; background:#fff; border:1px solid #dce7e1; border-radius:8px; color:#43594f; font-size:14px; font-weight:600; padding:12px 16px; cursor:pointer; }
.filters button.active { background:#246f61; color:#fff; border-color:#246f61; --count-color:#fff; }
.filters button:focus-visible { outline:2px solid #246f61; outline-offset:3px; }
.list-tools { margin-bottom:20px; flex-wrap:wrap; }
.inbox-section { margin-bottom:32px; }
.inbox-section>h2 { margin:0 0 14px; padding:0 4px; font-size:17px; }
.inbox-section>h2 span { margin-left:8px; font-size:13px; font-weight:500; color:#60736b; }
.project-group { margin:0 0 16px 16px; padding:8px; border:1px solid #e1eae5; border-radius:18px; background:#fff; }
.project-toggle { display:flex; align-items:center; gap:10px; flex-wrap:wrap; width:100%; border:0; border-radius:12px; padding:14px 16px; text-align:left; background:#f1f6f3; color:#243e34; cursor:pointer; font:inherit; }
.project-toggle:hover { background:#e8f1ec; }
.project-toggle:focus-visible { outline:2px solid #246f61; outline-offset:-2px; }
.project-name { font-weight:650; overflow-wrap:anywhere; min-width:0; }
.project-total,.toggle-label { font-size:13px; color:#52695f; }
.toggle-label { margin-left:auto; }
.project-risk { font-size:12px; color:#955310; background:#fff1df; padding:2px 8px; border-radius:8px; }
.chevron { width:14px; color:#52695f; }
.project-items { margin:4px 12px 2px 40px; }
.project-items :deep(.inbox-row) { padding:18px 8px; border-top:1px solid #edf1ee; }
.project-items :deep(.inbox-row:first-child) { border-top:0; }
.project-items :deep(.weekly-details) { border-top:0; background:#fcfaf5; padding:10px 14px; border-radius:10px; margin-top:12px; }
.project-items :deep(.weekly-details p) { color:#627168; }
.project-list { background:white; border:1px solid #dce7e1; border-radius:12px; padding:24px; }
.project-list h3 { margin-top:0; }
.project-row { padding:20px 0; border-bottom:1px solid #e6eeeb; }
.project-row .hint { margin-top:6px; }
.todo-inbox>:deep(.el-alert) { margin-bottom:12px; }
@media(max-width:768px) {
  .toolbar { align-items:flex-start; flex-direction:column; margin-bottom:16px; }
  .toolbar h2 { font-size:20px; }
  .filters { gap:6px; }
  .filters button { padding:10px; font-size:13px; }
  .project-group { margin-left:4px; padding:6px; border-radius:14px; }
  .project-toggle { padding:12px; gap:8px; }
  .project-name { flex:1; min-width:150px; }
  .toggle-label { display:none; }
  .project-items { margin:2px 6px 0 20px; }
  .project-items :deep(.inbox-row) { padding:16px 4px; }
  .project-list { padding:16px; }
}
</style>
