<script setup lang="ts">
defineProps<{ count: number }>();
</script>
<template><span class="count-pill" :class="{ 'has-items': count > 0 }">{{ count }}</span></template>
<style scoped>
.count-pill{display:inline-flex;align-items:center;justify-content:center;margin-left:8px;font-size:inherit;font-weight:700;line-height:20px;height:20px;font-variant-numeric:tabular-nums;color:inherit;position:relative;top:1px}
.count-pill.has-items{color:var(--count-color,#c52d43)}
</style>
