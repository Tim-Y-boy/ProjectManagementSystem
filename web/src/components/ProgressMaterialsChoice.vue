<script setup lang="ts">
const choice = defineModel<'' | 'yes' | 'no'>({ required: true });
const source = defineModel<'file' | 'link' | 'feishu' | 'existing'>('source', { required: true });
defineProps<{ disabled?: boolean; hasSavedMaterials?: boolean; supplementOnly?: boolean; feishu?: boolean }>();
</script>

<template>
  <div class="materials-choice">
    <el-form-item label="本次是否有资料" required>
      <el-radio-group v-model="choice" :disabled="disabled || supplementOnly" aria-label="本次是否有资料">
        <el-radio value="yes">有资料</el-radio>
        <el-radio value="no" :disabled="hasSavedMaterials">暂无资料</el-radio>
      </el-radio-group>
    </el-form-item>
    <p v-if="supplementOnly" class="choice-tip">正在为已有进展补资料，请选择资料来源。</p>
    <p v-else-if="hasSavedMaterials" class="choice-tip">本条进展已关联资料；如需改为暂无资料，请先在记录中解除关联。</p>
    <template v-if="choice === 'yes'">
      <el-form-item label="资料来源">
        <el-radio-group v-model="source" :disabled="disabled" class="source-options" aria-label="资料来源">
          <el-radio-button value="file">上传文件</el-radio-button>
          <el-radio-button value="link">粘贴链接</el-radio-button>
          <el-radio-button v-if="feishu" value="feishu">飞书文件</el-radio-button>
          <el-radio-button value="existing">关联已有资料</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <p class="choice-tip">可切换来源添加多种资料，已选资料会一起保存。</p>
      <div v-show="source === 'file'"><slot name="file" /></div>
      <div v-show="source === 'link'"><slot name="link" /></div>
      <div v-show="source === 'feishu'"><slot name="feishu" /></div>
      <div v-show="source === 'existing'"><slot name="existing" /></div>
      <slot name="selected" />
    </template>
    <template v-else-if="choice === 'no'">
      <p class="choice-tip">本次只保存进展与无资料原因。已选资料草稿暂存，切回“有资料”可继续。</p>
      <slot name="reason" />
    </template>
  </div>
</template>

<style scoped>
.choice-tip{font-size:12px;color:#596e65;line-height:1.6;margin:0 0 12px}.source-options{display:flex;flex-wrap:wrap;gap:6px}.source-options :deep(.el-radio-button__inner){border:1px solid var(--el-border-color);border-radius:6px!important;box-shadow:none!important;padding:9px 12px}.materials-choice :deep(.el-form-item){margin-bottom:14px}
</style>
