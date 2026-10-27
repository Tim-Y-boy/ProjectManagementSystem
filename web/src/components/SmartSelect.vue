<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  type SelectOption,
  groupOptionsByRecent,
  recordRecentOptions,
} from '@/utils/recent-items';

// 通用"可搜索下拉"（单选）：
// - 内置 filterable
// - 自定义过滤：连续子串 + 中文缩写跳字（"质控" → "质量控制部"）
// - 传入 recentKey 时启用"最近使用"分组并持久化（不传则纯过滤）
// $attrs 透传 el-select 的 placeholder/style/clearable/size/disabled/loading/class/@change 等。
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** 下拉选项：{ value, label }（value 可为 number 或 string） */
  items: SelectOption[];
  /** 单选值 */
  modelValue?: number | string | null;
  /** 启用"最近使用"时的记录命名空间；缺省不分组不记录 */
  recentKey?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', v: any): void }>();

const auth = useAuthStore();
const currentUserId = computed(() => auth.user?.id);

const groups = computed(() =>
  props.recentKey ? groupOptionsByRecent(props.items, props.recentKey, currentUserId.value) : { recent: [] as SelectOption[], others: props.items },
);

const currentLabel = computed(
  () =>
    (props.items.find((it) => String(it.value) === String(props.modelValue))?.label as string) || '',
);

// 当前过滤关键字（打开时 EP 会把已选 label 预填进输入框，视为未过滤）
const filterQuery = ref('');
function onFilter(raw: string) {
  const s = (raw || '').trim();
  filterQuery.value = currentLabel.value && s === currentLabel.value ? '' : s;
}

// 连续子串或按字序跳字命中（中文缩写友好）
function fuzzyMatch(label: string, query: string): boolean {
  const q = query.toLowerCase();
  const s = String(label ?? '').toLowerCase();
  if (!q) return true;
  if (s.includes(q)) return true;
  let qi = 0;
  for (const ch of s) {
    if (qi < q.length && ch === q[qi]) qi++;
  }
  return qi >= q.length;
}

// 过滤后的完整列表；始终把当前选中项带上，避免被过滤后选择态丢失
const filteredItems = computed(() => {
  const q = filterQuery.value;
  const list = props.items.filter((it) => fuzzyMatch(it.label, q));
  if (props.modelValue != null && props.modelValue !== '') {
    const hit = props.items.find((it) => String(it.value) === String(props.modelValue));
    if (hit && !list.some((it) => String(it.value) === String(props.modelValue))) {
      list.unshift(hit);
    }
  }
  return list;
});

// 有过滤词时忽略"最近使用/全部"分组，直接展示匹配结果
const recent = computed(() => (filterQuery.value ? [] : groups.value.recent));
const others = computed(() =>
  filterQuery.value ? filteredItems.value : groups.value.others,
);

function handleChange(v: number | string | null) {
  if (props.recentKey) {
    recordRecentOptions(props.recentKey, currentUserId.value, v);
  }
  emit('update:modelValue', v);
}
</script>

<template>
  <el-select
    v-bind="$attrs"
    filterable
    :filter-method="onFilter"
    :model-value="modelValue"
    @update:model-value="handleChange"
  >
    <template v-if="recent.length">
      <el-option-group label="最近使用">
        <el-option
          v-for="it in recent"
          :key="String(it.value)"
          :label="it.label"
          :value="it.value"
        />
      </el-option-group>
      <el-option-group v-if="others.length" label="全部">
        <el-option
          v-for="it in others"
          :key="String(it.value)"
          :label="it.label"
          :value="it.value"
        />
      </el-option-group>
    </template>
    <template v-else>
      <el-option
        v-for="it in others"
        :key="String(it.value)"
        :label="it.label"
        :value="it.value"
      />
    </template>
  </el-select>
</template>
