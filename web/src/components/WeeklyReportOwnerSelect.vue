<script setup lang="ts">
import { computed, watch } from 'vue';
import UserAvatar from '@/components/UserAvatar.vue';

const props = defineProps<{ ownerIds: number[]; users: any[]; modelValue: number | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();
const ids = computed(() => [...new Set(props.ownerIds.map(Number))]);
const options = computed(() => ids.value.map(id => props.users.find(user => Number(user.id) === id) || { id, name: String(id) }));
watch([ids, () => props.modelValue], () => {
  const next = ids.value.length === 1 ? ids.value[0]
    : props.modelValue != null && ids.value.includes(Number(props.modelValue)) ? Number(props.modelValue) : null;
  if (next !== props.modelValue) emit('update:modelValue', next);
}, { immediate: true });
</script>

<template>
  <el-select :model-value="modelValue" :disabled="ids.length <= 1" placeholder="从项目负责人中选择" style="width:100%" @update:model-value="emit('update:modelValue', Number($event))">
    <el-option v-for="user in options" :key="user.id" :value="Number(user.id)" :label="user.name">
      <UserAvatar :name="user.name" :avatar-url="user.avatarUrl" show-name :size="20" />
    </el-option>
  </el-select>
</template>
