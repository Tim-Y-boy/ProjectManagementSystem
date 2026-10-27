<script setup lang="ts">
import { computed } from 'vue';
import { toNumericId } from '@/utils/ids';
import { useAuthStore } from '@/stores/auth';
import { groupUsersByRecent, personLabel, recordRecentUsers } from '@/utils/recent-people';
import UserAvatar from '@/components/UserAvatar.vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** 当前页已加载的用户列表（含 isMock 字段） */
  users: any[];
  /** 单选为 number | null，多选为 number[] */
  modelValue?: number | number[] | null;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', v: any): void }>();

const auth = useAuthStore();
const currentUserId = computed(() => auth.user?.id);

const groups = computed(() => groupUsersByRecent(props.users, currentUserId.value));

function handleChange(v: number | number[] | null) {
  recordRecentUsers(currentUserId.value, v);
  emit('update:modelValue', v);
}
</script>

<template>
  <!-- $attrs 透传 el-select 的 placeholder/style/filterable/clearable/multiple/collapse-tags/size/disabled/class/@change 等 -->
  <el-select v-bind="$attrs" :model-value="modelValue" @update:model-value="handleChange">
    <template v-if="groups.recent.length">
      <el-option-group label="最近使用">
        <el-option
          v-for="u in groups.recent"
          :key="u.id"
          :label="personLabel(u)"
          :value="toNumericId(u.id)"
        >
          <div class="uo">
            <UserAvatar :name="u.name" :avatar-url="u.avatarUrl || null" :size="20" />
            <span class="uo-name">{{ personLabel(u) }}</span>
          </div>
        </el-option>
      </el-option-group>
      <el-option-group v-if="groups.others.length" label="全部人员">
        <el-option
          v-for="u in groups.others"
          :key="u.id"
          :label="personLabel(u)"
          :value="toNumericId(u.id)"
        >
          <div class="uo">
            <UserAvatar :name="u.name" :avatar-url="u.avatarUrl || null" :size="20" />
            <span class="uo-name">{{ personLabel(u) }}</span>
          </div>
        </el-option>
      </el-option-group>
    </template>
    <template v-else>
      <el-option
        v-for="u in users"
        :key="u.id"
        :label="personLabel(u)"
        :value="toNumericId(u.id)"
      >
        <div class="uo">
          <UserAvatar :name="u.name" :avatar-url="u.avatarUrl || null" :size="20" />
          <span class="uo-name">{{ personLabel(u) }}</span>
        </div>
      </el-option>
    </template>
  </el-select>
</template>

<style scoped>
.uo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.uo-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
