export function assetProgressIds(asset: any): number[] {
  const extra = asset.linkedDailyUpdateIds;
  return [...new Set([asset.dailyUpdateId, ...(Array.isArray(extra) ? extra : [])]
    .filter(id => id != null).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
}
export function assetLinksProgress(asset: any, updateId: any): boolean {
  return updateId != null && assetProgressIds(asset).includes(Number(updateId));
}

export interface TaskAssetLike {
  url?: string | null;
  title?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
}

/** Classify by source, without guessing document content from legacy labels. */
export function assetSourceType(asset: TaskAssetLike): 'file' | 'link' {
  return asset.url?.trim() ? 'link' : 'file';
}

export function assetSourceLabel(asset: TaskAssetLike) {
  return assetSourceType(asset) === 'link' ? '链接' : '文件';
}

export function assetLinkUrl(asset: TaskAssetLike) {
  try {
    const url = new URL(asset.url || '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

/** Legacy URL/hostname titles are identifiers, not document names. */
export function assetDisplayTitle(asset: TaskAssetLike) {
  const title = (asset.title || '').trim();
  if (!asset.url) return title || asset.originalName || '文件资料';
  const href = assetLinkUrl(asset);
  if (!href) return title || '资料链接';
  const url = new URL(href);
  const isAddress = /^https?:\/\//i.test(title) || title.toLowerCase() === url.hostname.toLowerCase()
    || title.toLowerCase() === url.host.toLowerCase() || title === url.pathname;
  if (title && !isAddress) return title;
  if (/(^|\.)(feishu\.cn|larksuite\.com)$/i.test(url.hostname)) {
    if (url.pathname.startsWith('/sheets/')) return '飞书表格';
    if (url.pathname.startsWith('/base/')) return '飞书多维表格';
    if (url.pathname.startsWith('/wiki/')) return '飞书知识库文档';
    if (url.pathname.startsWith('/file/')) return '飞书文件';
    return '飞书文档';
  }
  return '外部资料链接';
}

const TEXT_EXTENSIONS = [
  '.md',
  '.markdown',
  '.txt',
  '.log',
  '.csv',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
];

const TEXT_MIME_TYPES = [
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
];

export function assetFileName(asset: TaskAssetLike) {
  return asset.originalName || asset.title || 'download';
}

function normalizedAssetName(asset: TaskAssetLike) {
  return assetFileName(asset).toLowerCase();
}

function normalizedMimeType(asset: TaskAssetLike, fallback = '') {
  return String(asset.mimeType || fallback || '').toLowerCase().split(';')[0].trim();
}

function isTextAsset(asset: TaskAssetLike, fallbackMimeType = '') {
  const mimeType = normalizedMimeType(asset, fallbackMimeType);
  const name = normalizedAssetName(asset);
  return (
    mimeType.startsWith('text/') ||
    TEXT_MIME_TYPES.includes(mimeType) ||
    TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

export function isAssetPreviewable(asset: TaskAssetLike) {
  if (asset.url) return true;
  const mimeType = normalizedMimeType(asset);
  const name = normalizedAssetName(asset);
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    isTextAsset(asset) ||
    name.endsWith('.pdf')
  );
}

export function normalizePreviewBlob(asset: TaskAssetLike, blob: Blob) {
  if (!isTextAsset(asset, blob.type)) return blob;
  const mimeType = normalizedMimeType(asset, blob.type);
  const name = normalizedAssetName(asset);
  const type = mimeType || (name.endsWith('.md') || name.endsWith('.markdown') ? 'text/markdown' : 'text/plain');
  return new Blob([blob], { type: `${type};charset=utf-8` });
}
