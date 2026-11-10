<script setup lang="ts">
import { computed } from 'vue';
import type { WeeklyContent } from '@/api/project-weekly-reports';
const props = defineProps<{ original: Partial<WeeklyContent>; proposed: Partial<Omit<WeeklyContent,'overallStatus'>> & {overallStatus?: string} }>();
const fields = [
  {key:'overallStatus',label:'项目整体状态'}, {key:'achievements',label:'本周成果与目标达成情况'},
  {key:'risks',label:'问题、风险及处理措施'}, {key:'coordination',label:'需要协调的事项'},
  {key:'nextWeek',label:'下周重点安排 / 收尾与交接'},
] as const;
const changes = computed(() => fields.filter(field => (props.original[field.key] || '').trim() !== (props.proposed[field.key] || '').trim()));
function text(key: string, value?: string) {
  return key === 'overallStatus' ? ({normal:'正常推进',risk:'存在风险',blocked:'已受阻'}[value || ''] || '未选择') : value?.trim() || '未填写';
}
</script>
<template>
  <div class="change-comparison">
    <section v-for="field in changes" :key="field.key" class="changed-field">
      <h4>{{ field.label }}</h4>
      <div class="comparison-values">
        <div><span class="caption">修改前</span><p :class="field.key === 'overallStatus' ? `status-${original[field.key]}` : ''">{{ text(field.key, original[field.key]) }}</p></div>
        <div class="proposed"><span class="caption">修改后</span><p :class="field.key === 'overallStatus' ? `status-${proposed[field.key]}` : ''">{{ text(field.key, proposed[field.key]) }}</p></div>
      </div>
    </section>
    <p v-if="!changes.length" class="caption">尚未修改内容</p>
  </div>
</template>
<style scoped>
.changed-field { margin-bottom:16px; }
h4 { margin:0 0 8px; font-size:14px; color:var(--el-text-color-regular); }
.comparison-values { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); border:1px solid var(--el-border-color); border-radius:8px; overflow:hidden; background:white; }
.comparison-values>div { padding:12px; min-width:0; }
.proposed { border-left:1px solid var(--el-border-color); background:var(--el-color-primary-light-9); }
.caption { font-size:12px; color:var(--el-text-color-secondary); }
p { margin:6px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; }
.status-normal { color:var(--el-color-success); font-weight:600; }
.status-risk { color:var(--el-color-warning); font-weight:600; }
.status-blocked { color:var(--el-color-danger); font-weight:600; }
@media(max-width:600px) { .comparison-values { grid-template-columns:minmax(0,1fr); } .proposed { border-left:0; border-top:1px solid var(--el-border-color); } }
</style>
