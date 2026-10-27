<script setup lang="ts">
import { computed } from 'vue';
import { assetDisplayTitle, assetLinksProgress, assetSourceLabel, assetLinkUrl } from '@/utils/task-assets';
const props = defineProps<{ modelValue: number[]; assets: any[]; updateId?: number | null; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [ids: number[]] }>();
const choices = computed(() => props.assets.filter(asset => asset.filePath || assetLinkUrl(asset)));
</script>

<template>
  <div class="existing-assets">
    <label class="existing-assets-label">关联已有资料</label>
    <el-select
      :model-value="modelValue" multiple filterable collapse-tags collapse-tags-tooltip :max-collapse-tags="3"
      :disabled="disabled || !choices.length" placeholder="选择本任务已上传的文件或链接"
      aria-label="关联已有资料" class="existing-assets-select"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <el-option v-for="asset in choices" :key="asset.id" :value="Number(asset.id)"
        :label="assetDisplayTitle(asset)" :disabled="assetLinksProgress(asset, updateId)">
        <span>{{ assetDisplayTitle(asset) }}</span>
        <small class="existing-assets-kind">{{ assetLinksProgress(asset, updateId) ? '本条已关联' : assetSourceLabel(asset) }}</small>
      </el-option>
    </el-select>
    <p class="existing-assets-help">{{ choices.length ? '复用同一份资料，无需重复上传；选择后随本次进展保存。' : '本任务暂无已有资料，可先上传文件或添加链接。' }}</p>
  </div>
</template>

<style scoped>
.existing-assets { margin: 12px 0 18px; }
.existing-assets-label { display: block; margin-bottom: 8px; font-weight: 600; color: #526460; }
.existing-assets-select { width: 100%; }
.existing-assets-kind { margin-left: 12px; color: #84938f; }
.existing-assets-help { margin: 7px 0 0; font-size: 12px; line-height: 1.6; color: #7d8d89; }
</style>
