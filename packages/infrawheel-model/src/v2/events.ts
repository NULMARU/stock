/**
 * v2 event definitions and combination rules (development plan §8,
 * validation V10). Events declare their channel, unit and combination rule;
 * channels with independent effects commute, same-channel events saturate.
 */

import type { Diagnostic, ScenarioEvent } from "@stock/simulation-core";
import { quarterIndex } from "@stock/simulation-core";
import type { EventDefinition, V2EventType } from "./types";

export const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  {
    type: "power-shock",
    channel: "power",
    unit: "0-1 fraction of online power lost",
    combination: "multiplicative-saturate",
    orderIndependent: true,
    min: 0,
    max: 1,
    description:
      "Temporary reduction of online power (grid outage, export control on equipment).",
  },
  {
    type: "compute-destruction",
    channel: "compute",
    unit: "0-1 fraction of compute stock destroyed",
    combination: "additive-clamped",
    orderIndependent: true,
    min: 0,
    max: 1,
    description: "Permanent loss of installed compute (facility destruction).",
  },
  {
    type: "demand-shock",
    channel: "demand",
    unit: "-0.9..2 demand multiplier delta",
    combination: "additive-clamped",
    orderIndependent: true,
    min: -0.9,
    max: 2,
    description: "Temporary digital demand change (negative = contraction).",
  },
  {
    type: "subsidy",
    channel: "funding",
    unit: "$B/quarter external funding",
    combination: "additive-clamped",
    orderIndependent: true,
    min: 0,
    max: 100,
    description: "External policy funding added to investment budget.",
  },
  {
    type: "lead-time-shock",
    channel: "leadTime",
    unit: "extra quarters added to NEW commitments",
    combination: "additive-clamped",
    orderIndependent: true,
    min: 0,
    max: 12,
    description:
      "Permitting/supply delays for new projects only (F08: in-flight projects need project-delay).",
  },
  {
    type: "project-delay",
    channel: "projects",
    unit: "quarters of delay applied once to in-flight projects",
    combination: "additive-clamped",
    orderIndependent: false,
    min: 0,
    max: 12,
    description:
      "One-time delay of all in-flight projects at event start; each project delayed at most once per event id.",
  },
];

const BY_TYPE = new Map(EVENT_DEFINITIONS.map((d) => [d.type, d]));

export function getEventDefinition(type: string): EventDefinition | undefined {
  return BY_TYPE.get(type as V2EventType);
}

export function validateEvents(events: ScenarioEvent[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const ev of events) {
    try {
      quarterIndex(ev.startQuarter);
    } catch {
      diagnostics.push({
        level: "error",
        code: "EVENT_DATE",
        message: "잘못된 사건 분기",
      });
    }
    if (
      ["project-delay", "lead-time-shock"].includes(ev.type) &&
      !Number.isInteger(ev.magnitude)
    )
      diagnostics.push({
        level: "error",
        code: "EVENT_LAG",
        message: "지연 분기는 정수여야 합니다.",
      });
    if (ids.has(ev.id)) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_EVENT_ID",
        message: `중복 사건 ID: ${ev.id}`,
      });
    }
    ids.add(ev.id);
    const def = getEventDefinition(ev.type);
    if (!def) {
      diagnostics.push({
        level: "error",
        code: "UNKNOWN_EVENT_TYPE",
        message: `알 수 없는 사건 유형: ${ev.type}`,
      });
      continue;
    }
    if (
      !Number.isFinite(ev.magnitude) ||
      ev.magnitude < def.min ||
      ev.magnitude > def.max
    ) {
      diagnostics.push({
        level: "error",
        code: "EVENT_RANGE",
        message: `사건 ${ev.id} (${ev.type}): 크기 ${ev.magnitude}이 허용 범위 ${def.min}~${def.max} 밖`,
      });
    }
    if (!Number.isInteger(ev.durationQuarters) || ev.durationQuarters < 1) {
      diagnostics.push({
        level: "error",
        code: "EVENT_DURATION",
        message: `사건 ${ev.id}: 기간은 1분기 이상 정수`,
      });
    }
  }
  return diagnostics;
}

/** Active events of one channel at a quarter index. */
export function activeEventsAt(
  events: ScenarioEvent[],
  channel: EventDefinition["channel"],
  qIndex: number,
): ScenarioEvent[] {
  return events.filter((ev) => {
    const def = getEventDefinition(ev.type);
    if (!def || def.channel !== channel) return false;
    const start = quarterIndex(ev.startQuarter);
    return qIndex >= start && qIndex < start + ev.durationQuarters;
  });
}

/** Multiplicative saturation: combined loss = 1 - Π(1 - m_i). Order-independent. */
export function combineMultiplicativeSaturate(magnitudes: number[]): number {
  let keep = 1;
  for (const m of magnitudes) keep *= 1 - Math.min(1, Math.max(0, m));
  return 1 - keep;
}

/** Additive clamped to [floor, cap]. Order-independent (addition commutes). */
export function combineAdditiveClamped(
  magnitudes: number[],
  floor: number,
  cap: number,
): number {
  let sum = 0;
  for (const m of magnitudes) sum += m;
  return Math.min(cap, Math.max(floor, sum));
}
