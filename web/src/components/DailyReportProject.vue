<script setup lang="ts">
import type { DailyReportItem } from '@/utils/daily-report';
import { reportExcerpt } from '@/utils/daily-report';
import { taskManagementLocation } from '@/utils/task-navigation';

defineProps<{ name: string; items: DailyReportItem[]; mobile: boolean; reportDate: string }>();
</script>

<template>
  <section class="report-project">
    <header><h2>{{ name }}</h2><span>{{ items.length }} 条进展</span></header>
    <article v-for="item in items" :key="item.id" class="report-row">
      <strong class="report-author">{{ item.userName || '未知人员' }}</strong>
      <div class="report-work">
        <span v-if="item.workDate !== reportDate" class="report-backfill" :title="`工作日期：${item.workDate}`">{{ item.workDate < reportDate ? '补填' : '工作' }} {{ item.workDate }}</span>
        <span class="report-excerpt">{{ reportExcerpt(item.content) || '未填写进展内容' }}</span>
        <span v-if="item.affectDueDate || item.risk" class="report-attention" :title="item.risk || '可能影响预计完成时间'">{{ item.affectDueDate ? '工期风险' : '需关注' }}</span>
      </div>
      <RouterLink class="report-detail" :aria-label="`查看${item.taskTitle}详情`" :to="mobile ? `/mobile/task/${item.taskId}` : taskManagementLocation(item.projectId, item.taskId)">详情</RouterLink>
    </article>
  </section>
</template>

<style scoped>
.report-project { border: 1px solid #dfe8e3; border-radius: 12px; background: #fff; overflow: hidden; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 12px 18px; background: #f5f9f7; border-bottom: 1px solid #e6eee9; }
h2 { font-size: 16px; font-weight: 700; color: #205e53; margin: 0; overflow-wrap: anywhere; }
header > span { font-size: 12px; color: #61776d; white-space: nowrap; }
.report-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; align-items: baseline; gap: 16px; padding: 12px 18px; }
.report-row + .report-row { border-top: 1px solid #edf1ee; }
.report-author { font-size: 14px; color: #334c42; overflow-wrap: anywhere; }
.report-work { font-size: 14px; line-height: 1.6; color: #223b31; overflow-wrap: anywhere; }
.report-backfill { color: #3569a6; font-size: 12px; margin-right: 8px; white-space: nowrap; }
.report-attention { display: inline-block; margin-left: 8px; padding: 0 6px; background: #fff4e4; color: #895315; font-size: 12px; border-radius: 4px; }
.report-detail { font-size: 13px; color: #237266; white-space: nowrap; text-decoration: none; }
.report-detail:hover { text-decoration: underline; }
.report-detail:focus-visible { outline: 2px solid #237266; outline-offset: 4px; }
@media (max-width: 768px) {
  header { padding: 10px 12px; }
  .report-row { grid-template-columns: 52px minmax(0, 1fr) auto; gap: 8px; padding: 10px 12px; }
}
</style>
