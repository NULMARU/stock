/**
 * Time contract: integer quarter indices plus explicit quarter labels.
 * Monthly resolution is intentionally unsupported in this engine version —
 * see docs/simulation-model-validation.md §5 (a monthly model is a separate
 * model version, not a smaller time step of the same model).
 */

export interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

export function parseQuarter(label: string): Quarter {
  const m = /^(\d{4})Q([1-4])$/.exec(label);
  if (!m || Number(m[1]) < 1)
    throw new Error(
      `Invalid quarter label: ${JSON.stringify(label)} (expected e.g. "2026Q1")`,
    );
  return { year: Number(m[1]), q: Number(m[2]) as Quarter["q"] };
}

/** Global quarter ordinal: 2025Q1 → 2025*4+0. Monotonic across year rollover. */
export function quarterIndex(label: string): number {
  const { year, q } = parseQuarter(label);
  return year * 4 + (q - 1);
}

export function quarterLabel(index: number): string {
  if (!Number.isInteger(index) || index < 4 || index > 39999)
    throw new Error(`Quarter index must be an integer, got ${index}`);
  return `${String(Math.floor(index / 4)).padStart(4, "0")}Q${(index % 4) + 1}`;
}

export function addQuarters(label: string, n: number): string {
  return quarterLabel(quarterIndex(label) + n);
}

/**
 * Inclusive quarter count between start and end.
 * Throws on reversed ranges — an invalid period is never silently accepted (F05).
 */
export function quarterCount(start: string, end: string): number {
  const s = quarterIndex(start);
  const e = quarterIndex(end);
  if (e < s) {
    throw new Error(`Invalid period: start ${start} is after end ${end}`);
  }
  return e - s + 1;
}

/** Inclusive list of quarter labels from start to end. */
export function quarterRange(start: string, end: string): string[] {
  const n = quarterCount(start, end);
  const s = quarterIndex(start);
  return Array.from({ length: n }, (_, i) => quarterLabel(s + i));
}

/** Maximum supported horizon guard: prevents accidental multi-century loops. */
export const MAX_QUARTERS = 400;

export function assertReasonablePeriod(start: string, end: string): number {
  const n = quarterCount(start, end);
  if (n > MAX_QUARTERS) {
    throw new Error(`Period too long: ${n} quarters (max ${MAX_QUARTERS})`);
  }
  return n;
}
