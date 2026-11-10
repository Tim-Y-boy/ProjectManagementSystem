<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElInput, ElOption, ElSelect } from 'element-plus';
import { NO_MATERIAL_REASONS } from '@/utils/no-material-reason';

const props = withDefaults(defineProps<{ modelValue: string; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const choiceFor = (value: string) => !value ? '' : NO_MATERIAL_REASONS.includes(value) ? value : 'other';
const choice = ref(choiceFor(props.modelValue));
let lastEmitted: string | undefined;
function update(value: string) { lastEmitted = value; emit('update:modelValue', value); }
function select(value: string) {
  choice.value = value || '';
  update(value === 'other' ? '' : value || '');
}
watch(() => props.modelValue, value => {
  if (value !== lastEmitted) choice.value = choiceFor(value);
  lastEmitted = undefined;
});
</script>

<template>
  <div class="reason-select">
    <el-select :model-value="choice" :disabled="disabled" placeholder="请选择本次无资料的原因" aria-label="本次无资料原因" clearable @update:model-value="select">
      <el-option v-for="reason in NO_MATERIAL_REASONS" :key="reason" :label="reason" :value="reason" />
      <el-option label="其他原因（请说明）" value="other" />
    </el-select>
    <el-input v-if="choice === 'other'" :model-value="modelValue" :disabled="disabled" type="textarea" :rows="2" maxlength="500" show-word-limit aria-label="其他无资料原因" placeholder="请说明本次工作为何没有文件或链接资料" @update:model-value="update" />
  </div>
</template>

<style scoped>
.reason-select { display: grid; gap: 10px; width: 100%; min-width: 0; }
.reason-select .el-select { width: 100%; }
</style>
