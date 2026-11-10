export function toNumericId(id: unknown): number {
  return Number(id);
}

export function toNullableNumericId(id: unknown): number | null {
  if (id == null || id === '') return null;
  const value = Number(id);
  return Number.isFinite(value) ? value : null;
}

export function normalizeNumericIds(ids: unknown, fallbackId?: unknown): number[] {
  const source = Array.isArray(ids)
    ? ids
    : fallbackId != null
      ? [fallbackId]
      : [];

  return source
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}
