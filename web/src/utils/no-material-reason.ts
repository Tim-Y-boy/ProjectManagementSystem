export const NO_MATERIAL_REASONS = [
  '现场沟通协调，无独立文件资料',
  '现场操作或检查，无独立文件资料',
  '过程性工作，本次尚未形成资料',
];

export function progressMaterialReason(updates: { noMaterialReason?: string | null }[]): string {
  return [...new Set(updates.map(u => u.noMaterialReason?.trim() || '').filter(Boolean))].sort().join('\n');
}
