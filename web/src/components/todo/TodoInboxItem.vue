<script setup lang="ts">
import { ref, watch } from 'vue';
import TaskApprovalPanel from './TaskApprovalPanel.vue';
import type { InboxItem } from '@/utils/todo-inbox';
import type { WeeklyNotice } from '@/utils/todo-weekly';
import { useRouter } from 'vue-router';
import { formatBeijingTime } from '@/utils/date-time';
import WeeklyProgressNotices from '@/components/WeeklyProgressNotices.vue';
const props = defineProps<{ item: InboxItem; mobile?: boolean; focused?: boolean; busy?: boolean; hideProject?: boolean }>();
const emit = defineEmits<{ open: [item: InboxItem]; acknowledge: [item: InboxItem]; reviewed: [] }>();
const expanded = ref(false);
watch(() => props.focused, value => { if (value) expanded.value = true; }, { immediate: true });
function open() { if (props.item.taskId) expanded.value = !expanded.value; else emit('open', props.item); }
const router = useRouter();
function openWeekly(notice: WeeklyNotice) {
  router.push(props.mobile ? notice.mobilePath : notice.desktopPath);
}
</script>

<template>
  <article :id="item.key" class="inbox-row" :class="{ focused }">
    <div class="row-content">
      <p v-if="item.project && !hideProject" class="project">{{ item.project }}</p>
      <h3><button type="button" class="title-link" :aria-expanded="item.taskId ? expanded : undefined" :aria-controls="item.taskId ? `review-${item.taskId}` : undefined" @click="open"><span v-if="item.taskId" aria-hidden="true">{{ expanded ? '▾' : '▸' }} </span>{{ item.title }}</button> <span v-if="item.done" class="state">已处理</span><span v-else-if="item.risk" class="risk">{{ item.risk === 2 ? '已延期' : '即将到期' }}</span><span v-else-if="item.status === 'doing'" class="state">进行中</span></h3>
      <p v-if="item.description" class="description">{{ item.description }}</p>
      <el-alert v-if="item.warning" :title="item.warning" type="warning" :closable="false" />
      <p v-if="item.date || item.dueAt" class="meta">{{ item.date ? `收到于 ${formatBeijingTime(item.date)}` : `截止 ${item.dueAt}` }}</p>
    </div>
    <div class="actions">
      <el-button v-if="item.weeklyNotices?.length === 1" type="primary" @click="openWeekly(item.weeklyNotices[0])">去补填</el-button>
      <el-dropdown v-else-if="item.weeklyNotices?.length" trigger="click" @command="openWeekly">
        <el-button type="primary" aria-label="选择缺填周次">去补填 ▾</el-button>
        <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="notice in item.weeklyNotices" :key="notice.id" :command="notice">{{ notice.weekStart }} 至 {{ notice.weekEnd }}</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
      <el-button v-else :type="item.acknowledge || item.done ? 'default' : 'primary'" :plain="!!item.acknowledge || item.done" :aria-expanded="item.taskId ? expanded : undefined" @click="open">{{ item.taskId && expanded ? '收起详情' : item.done ? '查看记录' : item.action }}</el-button>
      <el-button v-if="item.acknowledge" type="primary" :loading="busy" @click="$emit('acknowledge', item)">{{ item.acknowledge }}</el-button>
    </div>
    <TaskApprovalPanel v-if="item.taskId && expanded" :id="`review-${item.taskId}`" :task-id="item.taskId" @reviewed="emit('reviewed')" />
    <WeeklyProgressNotices v-if="item.weeklyNotices?.length" class="row-weekly" :notices="item.weeklyNotices" :mobile="mobile" hide-actions />
  </article>
</template>

<style scoped>
.inbox-row :deep(.el-button){min-width:96px;height:36px;padding:0 16px;border-radius:10px;font-size:14px;font-weight:600}
.title-link{font:inherit;color:inherit;text-align:left;border:0;background:none;padding:0;cursor:pointer;overflow-wrap:anywhere}.title-link:hover{color:#246f61;text-decoration:underline;text-underline-offset:3px}.title-link:focus-visible{outline:2px solid #246f61;outline-offset:4px;border-radius:4px}
.inbox-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:0 24px;padding:22px 24px;border-top:1px solid #e6eeeb;scroll-margin-top:90px;background:#fff}
.row-weekly{grid-column:1 / -1}
.inbox-row.focused{background:#eef7f4;outline:2px solid #288174;outline-offset:-2px}
.row-content{flex:1;min-width:0}.project{margin:0 0 6px;color:#536a62;font-size:13px}h3{margin:0;font-size:16px;line-height:1.6;color:#203b32;overflow-wrap:anywhere}.description{white-space:pre-wrap;overflow-wrap:anywhere;color:#43594f;font-size:13px;line-height:1.75;margin:8px 0}.meta{font-size:12px;color:#60736b;margin:8px 0 0}.state,.risk{display:inline-block;font-size:12px;font-weight:500;padding:1px 7px;margin-left:8px;border-radius:4px;background:#eef3f1;color:#536a62}.risk{background:#fff1df;color:#955310}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions :deep(.el-button){margin-left:0}
@media(max-width:768px){.inbox-row{gap:0 12px;padding:16px}.actions{justify-content:flex-end;max-width:120px}h3{font-size:15px}}
</style>
