<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { formatBeijingTime } from '@/utils/date-time';

const props = defineProps<{ records: any[]; labels: Record<string, string> }>();
const emit = defineEmits<{ open: [id: number] }>();
const collapsed = ref(new Set<string>());
const groups = computed(() => {
  const byProject = new Map<string, { id: string; name: string; records: any[]; open: number; processing: number }>();
  for (const row of props.records) {
    const id = String(row.project_id);
    let group = byProject.get(id);
    if (!group) {
      group = { id, name: row.snapshot.projectName || '未命名项目', records: [], open: 0, processing: 0 };
      byProject.set(id, group);
    }
    group.records.push(row);
    if (row.handling_status === 'open') group.open++;
    if (row.handling_status === 'processing') group.processing++;
  }
  return [...byProject.values()];
});
function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  collapsed.value = next;
}
</script>

<template>
  <div class="delay-projects">
    <el-empty v-if="!groups.length" description="暂无符合筛选条件的记录" :image-size="80" />
    <div v-else class="ledger-scroll" role="region" aria-label="按项目分组的延期台账" tabindex="0">
      <table class="delay-table" aria-label="延期台账">
        <colgroup><col style="width:160px"><col><col style="width:130px"><col style="width:120px"><col style="width:175px"><col style="width:110px"><col style="width:100px"></colgroup>
        <thead><tr>
          <th scope="col">记录类型</th><th scope="col">任务／事项</th><th scope="col">当时截止日期</th><th scope="col">当次记录天数</th><th scope="col">留档时间</th><th scope="col">处理状态</th><th scope="col">操作</th>
        </tr></thead>
        <template v-for="group in groups" :key="group.id">
          <tbody class="project-label"><tr><td colspan="7">
            <button type="button" class="project-heading" :aria-expanded="!collapsed.has(group.id)" :aria-controls="'delay-project-' + group.id" @click="toggle(group.id)">
              <el-icon class="project-arrow"><component :is="collapsed.has(group.id) ? ArrowRight : ArrowDown" /></el-icon>
              <span class="project-title">{{ group.name }}</span>
              <span class="project-count">{{ group.records.length }} 条记录</span>
              <el-tag v-if="group.open" size="small" type="warning">待处理 {{ group.open }}</el-tag>
              <el-tag v-if="group.processing" size="small" type="primary">处理中 {{ group.processing }}</el-tag>
            </button>
          </td></tr></tbody>
          <tbody v-show="!collapsed.has(group.id)" :id="'delay-project-' + group.id" class="project-records">
            <tr v-for="row in group.records" :key="row.id" @click="emit('open', Number(row.id))">
              <td>{{ labels[row.kind] }}</td>
              <td class="record-title">{{ row.snapshot.title }}</td>
              <td>{{ row.snapshot.dueAt || '—' }}</td>
              <td><span class="delay-days">{{ row.snapshot.days }} 天</span></td>
              <td><span class="date-meta">{{ formatBeijingTime(row.observed_at) }}</span></td>
              <td><el-tag :type="row.handling_status === 'resolved' ? 'success' : row.handling_status === 'processing' ? 'warning' : 'info'" size="small">{{ row.handling_status === 'resolved' ? '已处理' : row.handling_status === 'processing' ? '处理中' : '待处理' }}</el-tag></td>
              <td><el-button link type="primary" @click.stop="emit('open', Number(row.id))">查看详情</el-button></td>
            </tr>
          </tbody>
        </template>
      </table>
    </div>
  </div>
</template>

<style scoped>
.delay-projects { min-width: 0; }
.ledger-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-md); }
.ledger-scroll:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.delay-table { width: 100%; min-width: 1040px; border-collapse: collapse; table-layout: fixed; color: var(--text-1); font-size: 14px; }
.delay-table thead th { padding: 14px 12px; background: var(--color-bg); color: var(--text-2); text-align: left; font-weight: 600; border-bottom: 1px solid var(--border); }
.project-label td { padding: 0; border-bottom: 1px solid var(--border); text-align: left; }
.project-heading { display: flex; align-items: center; gap: 10px; width: 100%; padding: 14px 16px; border: 0; background: var(--color-primary-bg); color: var(--text-1); font: inherit; text-align: left; cursor: pointer; }
.project-heading:hover { background: var(--color-primary-100); }
.project-heading:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
.project-arrow { color: var(--text-2); flex-shrink: 0; }
.project-title { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.project-count { margin-left: auto; color: var(--text-2); font-size: 12px; font-weight: 400; white-space: nowrap; }
.project-records td { padding: 14px 12px; border-bottom: 1px solid var(--border); line-height: 1.6; }
.project-records tr { cursor: pointer; }
.project-records tr:hover { background: var(--color-bg); }
.project-records:last-child tr:last-child td { border-bottom: 0; }
.record-title { overflow-wrap: anywhere; }
.delay-days { color: #996015; font-weight: 600; }
.date-meta { color: var(--text-2); font-size: 13px; font-variant-numeric: tabular-nums; }
</style>
