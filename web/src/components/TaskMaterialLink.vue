<script setup lang="ts">
import { assetDisplayTitle, assetLinkUrl, type TaskAssetLike } from '@/utils/task-assets';

defineProps<{ asset: TaskAssetLike }>();
defineEmits<{ open: [asset: TaskAssetLike] }>();
</script>

<template>
  <a v-if="assetLinkUrl(asset)" class="material-link" :href="assetLinkUrl(asset)" target="_blank" rel="noopener noreferrer" :title="asset.url || undefined">
    <span class="material-link-icon" aria-hidden="true">↗</span>
    <span class="material-link-name">{{ assetDisplayTitle(asset) }}</span>
    <span class="material-link-action">打开<span class="sr-only">（新窗口）</span></span>
  </a>
  <button v-else type="button" class="material-link" @click="$emit('open', asset)">
    <span class="material-link-name">{{ assetDisplayTitle(asset) }}</span>
    <span class="material-link-action">查看</span>
  </button>
</template>

<style scoped>
.material-link { display: flex; align-items: baseline; gap: 8px; width: 100%; box-sizing: border-box; padding: 4px 0; border: 0; background: transparent; color: #1d4ed8; font: inherit; font-size: 13px; text-align: left; cursor: pointer; text-decoration: none; }
.material-link:hover { color: #1e40af; }
.material-link:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.material-link-name { min-width: 0; overflow-wrap: anywhere; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.material-link-action { margin-left: auto; flex-shrink: 0; font-size: 12px; }
.material-link-icon { flex-shrink: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
