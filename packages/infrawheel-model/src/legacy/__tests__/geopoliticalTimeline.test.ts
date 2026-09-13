import { describe, expect, it } from 'vitest';
import { RISK_CATALOG } from '../geopolitical/catalog';
import {
  getRiskTiming,
  quarterOrdinal,
  riskIntensityAtQuarter,
} from '../geopolitical/timeline';
import type { RiskEvent } from '../types';

describe('geopolitical event timing', () => {
  it('orders quarters correctly across year boundaries', () => {
    expect(quarterOrdinal('2025Q4')).toBeTypeOf('number');
    expect(quarterOrdinal('2026Q1')! - quarterOrdinal('2025Q4')!).toBe(1);
    expect(quarterOrdinal('2025-Q4')).toBeNull();
    expect(quarterOrdinal('2025Q5')).toBeNull();
  });

  it('has no impact before start, holds fully, then recovers linearly to zero', () => {
    const event: RiskEvent = { stage: 2, startQuarter: '2025Q4' };
    const definition = RISK_CATALOG.taiwan[2]; // operational: hold 2, recovery 6

    expect(riskIntensityAtQuarter(event, definition, 'memory', '2025Q3')).toBe(0);
    expect(riskIntensityAtQuarter(event, definition, 'memory', '2025Q4')).toBe(1);
    expect(riskIntensityAtQuarter(event, definition, 'memory', '2026Q1')).toBe(1);
    expect(riskIntensityAtQuarter(event, definition, 'memory', '2026Q2')).toBeCloseTo(5 / 6);
    expect(riskIntensityAtQuarter(event, definition, 'memory', '2027Q2')).toBeCloseTo(1 / 6);
    expect(riskIntensityAtQuarter(event, definition, 'memory', '2027Q3')).toBe(0);
  });

  it('recovers market channels twice as fast as operational channels', () => {
    const event: RiskEvent = { stage: 2, startQuarter: '2025Q1' };
    const definition = RISK_CATALOG.taiwan[2];
    expect(getRiskTiming(event, definition, 'memory').recoveryQ).toBe(6);
    expect(getRiskTiming(event, definition, 'reinvestRatio').recoveryQ).toBe(3);
    expect(riskIntensityAtQuarter(event, definition, 'reinvestRatio', '2025Q3')).toBeCloseTo(2 / 3);
    expect(riskIntensityAtQuarter(event, definition, 'reinvestRatio', '2026Q1')).toBe(0);
    expect(riskIntensityAtQuarter(event, definition, 'memory', '2026Q1')).toBeCloseTo(0.5);
  });

  it('delays policy by one quarter and extends its recovery by 1.5x', () => {
    const event: RiskEvent = { stage: 2, startQuarter: '2025Q1' };
    const definition = RISK_CATALOG.taiwan[2];
    expect(getRiskTiming(event, definition, 'policyCAPEX')).toEqual({
      delayQ: 1,
      sustainQ: 2,
      recoveryQ: 9,
    });
    expect(riskIntensityAtQuarter(event, definition, 'policyCAPEX', '2025Q1')).toBe(0);
    expect(riskIntensityAtQuarter(event, definition, 'policyCAPEX', '2025Q2')).toBe(1);
    expect(riskIntensityAtQuarter(event, definition, 'policyCAPEX', '2025Q3')).toBe(1);
    expect(riskIntensityAtQuarter(event, definition, 'policyCAPEX', '2025Q4')).toBeCloseTo(8 / 9);
  });

  it('uses durationOverrideQ only for the full-impact hold', () => {
    const event: RiskEvent = { stage: 4, startQuarter: '2025Q1', durationOverrideQ: 1 };
    const definition = RISK_CATALOG.russiaNato[4];
    expect(getRiskTiming(event, definition, 'deliverablePower')).toEqual({
      delayQ: 0,
      sustainQ: 1,
      recoveryQ: 24,
    });
    expect(riskIntensityAtQuarter(event, definition, 'deliverablePower', '2025Q1')).toBe(1);
    expect(riskIntensityAtQuarter(event, definition, 'deliverablePower', '2025Q2')).toBeCloseTo(23 / 24);
  });

  it('neutralizes stage 0 and malformed/non-finite timing input', () => {
    const definition = RISK_CATALOG.middleEast[2];
    expect(riskIntensityAtQuarter(
      { stage: 0, startQuarter: 'not-a-quarter' },
      definition,
      'leadTime',
      'also-invalid',
    )).toBe(0);

    const event: RiskEvent = {
      stage: 2,
      startQuarter: '2025Q1',
      durationOverrideQ: Number.POSITIVE_INFINITY,
    };
    expect(getRiskTiming(event, definition, 'leadTime').sustainQ).toBe(definition.sustainQ);
    expect(riskIntensityAtQuarter(event, definition, 'leadTime', 'invalid')).toBe(0);
  });
});
