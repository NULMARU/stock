/**
 * Validation helpers shared by models: finiteness, ranges, unknown fields.
 * Unknown or auto-corrected fields are surfaced as diagnostics, never silently
 * dropped or rewritten (development plan §5).
 */

import type { Diagnostic } from "./contracts";

export interface FieldRule {
  key: string;
  label: string;
  min: number;
  max: number;
  /** Default used when the field is missing; absence of a default = required. */
  default?: number;
  integer?: boolean;
  unit: string;
}

export interface FieldValidationResult {
  values: Record<string, number>;
  diagnostics: Diagnostic[];
  ok: boolean;
}

export function validateNumericFields(
  raw: Record<string, unknown>,
  rules: FieldRule[],
): FieldValidationResult {
  const diagnostics: Diagnostic[] = [];
  const values: Record<string, number> = {};
  const known = new Set(rules.map((r) => r.key));

  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      diagnostics.push({
        level: "warning",
        code: "UNKNOWN_FIELD",
        message: `알 수 없는 입력 필드 무시됨: ${key}`,
      });
    }
  }

  let ok = true;
  for (const rule of rules) {
    const v = raw[rule.key];
    if (v === undefined || v === null) {
      if (rule.default !== undefined) {
        values[rule.key] = rule.default;
        diagnostics.push({
          level: "info",
          code: "DEFAULT_APPLIED",
          message: `${rule.label}: 기본값 ${rule.default}${rule.unit} 적용`,
        });
      } else {
        ok = false;
        diagnostics.push({
          level: "error",
          code: "MISSING_FIELD",
          message: `${rule.label}: 필수 입력 누락`,
        });
      }
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      ok = false;
      diagnostics.push({
        level: "error",
        code: "NON_FINITE",
        message: `${rule.label}: 유한한 숫자가 아님 (${String(v)})`,
      });
      continue;
    }
    if (rule.integer && !Number.isInteger(v)) {
      ok = false;
      diagnostics.push({
        level: "error",
        code: "NON_INTEGER",
        message: `${rule.label}: 정수만 허용 (${v})`,
      });
      continue;
    }
    if (v < rule.min || v > rule.max) {
      ok = false;
      diagnostics.push({
        level: "error",
        code: "OUT_OF_RANGE",
        message: `${rule.label}: 허용 범위 ${rule.min}~${rule.max}${rule.unit} 밖 (${v})`,
      });
      continue;
    }
    values[rule.key] = v;
  }
  return { values, diagnostics, ok };
}

/** Sum ≤ budget check used by allocation invariants. */
export function checkBudget(
  allocations: Record<string, number>,
  budget: number,
  tolerance = 1e-9,
): string | null {
  if(!Number.isFinite(budget)||budget<0||!Number.isFinite(tolerance)||tolerance<0)return "invalid budget or tolerance";
  let sum = 0;
  for (const [name, v] of Object.entries(allocations)) {
    if (!Number.isFinite(v)) return `${name} allocation is not finite`;
    if (v < 0) return `${name} allocation is negative (${v})`;
    sum += v;
  }
  return sum > budget + tolerance
    ? `allocation sum ${sum} exceeds budget ${budget}`
    : null;
}
