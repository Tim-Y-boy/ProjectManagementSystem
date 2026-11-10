<script setup lang="ts">
import SmartSelect from '@/components/SmartSelect.vue';
import type { SelectOption } from '@/utils/recent-items';

// 部门下拉 = SmartSelect + 默认部门命名空间的"最近使用"。见 SmartSelect 的模糊匹配说明。
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** 部门选项：{ value: 数字部门id, label: 名称（可带层级前缀） } */
  items: SelectOption[];
  /** 单选值：number | null */
  modelValue?: number | string | null;
  /** 最近使用记录命名空间（默认 depts） */
  recentKey?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', v: any): void }>();
</script>

<template>
  <SmartSelect
    v-bind="$attrs"
    :items="items"
    :model-value="modelValue"
    :recent-key="recentKey ?? 'depts'"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
