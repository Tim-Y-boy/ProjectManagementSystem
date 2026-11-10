/** Original association plus additional references; one asset row remains one deliverable. */
export function assetProgressIds(asset: any): number[] {
  const extra = asset.linkedDailyUpdateIds ?? asset.linked_daily_update_ids;
  return [...new Set([asset.dailyUpdateId ?? asset.daily_update_id, ...(Array.isArray(extra) ? extra : [])]
    .filter(id => id != null).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
}
export function assetLinksProgress(asset: any, updateId: any): boolean {
  return updateId != null && assetProgressIds(asset).includes(Number(updateId));
}
