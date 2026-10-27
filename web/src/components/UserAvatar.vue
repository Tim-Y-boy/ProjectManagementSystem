<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  name?: string | null;
  avatarUrl?: string | null;
  showName?: boolean;
  size?: number;
}>(), {
  name: '',
  avatarUrl: null,
  showName: false,
  size: 24,
});

const hasAvatar = computed(() => !!props.avatarUrl);
const initial = computed(() => (props.name || '?').slice(0, 1));
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }));

function onAvatarError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<template>
  <span class="ua">
    <span class="ua-avatar" :style="style">
      <img v-if="hasAvatar" :src="avatarUrl!" :alt="name || ''" @error="onAvatarError" />
      <span v-else class="ua-initial">{{ initial }}</span>
    </span>
    <span v-if="showName" class="ua-name" :title="name || ''">{{ name }}</span>
  </span>
</template>

<style scoped>
.ua { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.ua-avatar {
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: #ecf4f2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ua-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ua-initial {
  color: #237266;
  font-weight: 800;
  font-size: 12px;
  width: 100%;
  text-align: center;
}
.ua-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
