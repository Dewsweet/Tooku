/** Preserve the precision supplied by a catalog; never invent month/day values. */
export function catalogReleaseDate(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0 || value < -30610224000000 || value > 253402300799999) return undefined;
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return undefined;
  const date = value.includes('T') ? value.split('T')[0] : value;
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date)) return undefined;
  if (Number(date.slice(0, 4)) < 1000) return undefined;
  const full = date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date;
  const parsed = new Date(`${full}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === full ? date : undefined;
}
