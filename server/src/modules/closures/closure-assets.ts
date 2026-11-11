import type { EntityManager } from 'typeorm';

/** Called inside the closure's project lock: capture the current projection, not version history. */
export async function captureClosureAssets(manager: Pick<EntityManager, 'query'>, projectId: number) {
  const assets = await manager.query('SELECT * FROM task_assets WHERE project_id=$1 ORDER BY id', [projectId]);
  return assets.map((asset: any) => ({ ...asset, version_id: asset.current_version_id ?? null }));
}
