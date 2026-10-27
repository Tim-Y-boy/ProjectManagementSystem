<script setup lang="ts">
withDefaults(defineProps<{ count: number; fresh: boolean; label?: string; animated?: boolean }>(), { label: '项待处理', animated: true });
</script>

<template>
  <span v-if="count > 0" class="menu-count-badge" :class="{ fresh, 'is-static': !animated }"
    :aria-label="`${count} ${label}`"
    :title="`${count} ${label}`">
    {{ count > 99 ? '99+' : count }}
  </span>
</template>

<style scoped>
.menu-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  margin-left: auto;
  flex-shrink: 0;
  border-radius: 999px;
  background: #fce5e7;
  color: #a63b49;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  transition: background-color 240ms ease, color 240ms ease;
}
.menu-count-badge.fresh {
  background: #dc354b;
  color: #fff;
  animation: badge-breathe 2.8s ease-in-out infinite;
}
@keyframes badge-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 53, 75, 0); }
  45% { box-shadow: 0 0 0 4px rgba(220, 53, 75, 0.14); }
}
.menu-count-badge.is-static { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .menu-count-badge, .menu-count-badge.fresh { animation: none; transition: none; }
}
</style>
