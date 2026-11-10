<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import { closuresApi } from '@/api';
const props = defineProps<{ request: any }>();
const emit = defineEmits<{ reading: [] }>();
const frame = shallowRef<HTMLIFrameElement | null>(null);
const downloading = shallowRef(false);
const html = computed(() => (props.request.reportHtml || '').replace('</head>', `<style>
@media screen {
  .doc { max-width:none; width:calc(100% - 32px); margin:16px auto; padding:32px; }
  .report,.report.embedded { max-width:none; }
}
@media screen and (max-width:640px) {
  .doc { width:calc(100% - 16px); margin:8px auto; padding:20px 16px; }
}
</style></head>`));
let documentCleanup: (() => void) | undefined;
async function download(id: number) {
  if (downloading.value) return;
  const requestId = Number(props.request.id);
  const asset = (props.request.report || props.request.snapshot)?.assets?.find((a: any) => Number(a.id) === id);
  if (!asset?.file_path) return;
  downloading.value = true;
  try {
    const blob = await closuresApi.downloadAsset(requestId, id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = asset.original_name || asset.title || '附件'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error: any) { if (!error.messageShown) ElMessage.error(error.message || '下载失败，请重试'); }
  finally { downloading.value = false; }
}
function onLoad() {
  documentCleanup?.();
  const doc = frame.value?.contentDocument;
  if (!doc) return;
  // 模板由后端统一转义；iframe 禁止脚本，仅由父页面接管经过鉴权的附件下载。
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.nav-link'));
  const sections = links.map(link => doc.getElementById(link.hash.slice(1))).filter((item): item is HTMLElement => !!item);
  let scrollFrame = 0;
  let lastScrollTop = 0;
  const markCurrent = () => {
    scrollFrame = 0;
    let current = sections[0]?.id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 100) current = section.id;
    }
    links.forEach(link => {
      if (link.hash === '#' + current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  const scroll = () => {
    const top = doc.scrollingElement?.scrollTop || 0;
    if (top > lastScrollTop && top > 48) emit('reading');
    lastScrollTop = top;
    if (!scrollFrame) scrollFrame = requestAnimationFrame(markCurrent);
  };
  const click = (event: Event) => {
    const target = (event.target as Element | null)?.closest?.('a,button');
    if (!target) return;
    const charterId = target.getAttribute('data-charter-id');
    if (charterId && /^\d+$/.test(charterId)) { event.preventDefault(); void downloadCharter(Number(charterId)); return; }
    const assetId = target.getAttribute('data-asset-id');
    if (assetId && /^\d+$/.test(assetId)) { event.preventDefault(); void download(Number(assetId)); return; }
    const href = target.getAttribute('href');
    if (href?.startsWith('#')) {
      event.preventDefault();
      const section = doc.getElementById(href.slice(1));
      let ancestor: HTMLElement | null = section || null;
      while (ancestor) {
        if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true;
        ancestor = ancestor.parentElement;
      }
      if (section?.id === 'assets') section.querySelectorAll('details').forEach(item => { item.open = true; });
      section?.scrollIntoView({ block: 'start' });
      if (target.classList.contains('nav-link')) {
        links.forEach(link => link.removeAttribute('aria-current'));
        target.setAttribute('aria-current', 'location');
      }
    }
  };
  doc.addEventListener('click', click);
  doc.addEventListener('scroll', scroll, { passive: true });
  markCurrent();
  documentCleanup = () => {
    doc.removeEventListener('click', click);
    doc.removeEventListener('scroll', scroll);
    cancelAnimationFrame(scrollFrame);
  };
}
async function downloadCharter(id: number) {
  if (downloading.value) return;
  const file=(props.request.report||props.request.snapshot).application?.charters?.find((f:any)=>Number(f.id)===id);
  if(!file)return;
  downloading.value=true;
  try{const blob=await closuresApi.downloadCharter(Number(props.request.id),id);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file.original_name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(e:any){if(!e.messageShown)ElMessage.error(e.message||'立项书下载失败');}
  finally{downloading.value=false;}
}
onBeforeUnmount(() => documentCleanup?.());
</script>
<template>
  <section class="report-reader" aria-label="项目结项报告阅读器">
    <div v-if="html" class="reader-tools">
      <span class="reader-hint" aria-live="polite">{{ downloading ? '正在下载附件…' : '项目结论、成果产出、延期与关键事项' }}</span>
    </div>
    <iframe v-if="html" ref="frame" class="report-frame" title="项目结项报告" :srcdoc="html" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" @load="onLoad" />
    <el-alert v-else title="报告内容暂不可用，请确认后端已更新后重新打开报告。" type="warning" :closable="false" />
  </section>
</template>
<style scoped>
.report-reader { min-width: 0; }
.reader-tools { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 0 24px 14px; border-bottom: 1px solid var(--border); }
.reader-hint { color: var(--text-2); font-size: 13px; }
.report-frame { display: block; width: 100%; height: calc(100dvh - 120px); min-height: 540px; border: 0; background: white; }
@media (max-width: 640px) { .reader-tools { padding: 0 4px 12px; } .report-frame { height: calc(100dvh - 100px); min-height: 420px; } }
</style>
