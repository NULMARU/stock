import { describe, expect, it } from 'vitest';
import { RISK_CATALOG, RISK_IDS, RISK_STAGES } from '../geopolitical/catalog';
import type { RiskId, RiskStage } from '../types';

interface ExpectedRow {
  risk: RiskId;
  stage: RiskStage;
  impacts: Record<string, number>;
  sustainQ: number;
  recoveryQ: number;
}

const rows: ExpectedRow[] = [
  { risk: 'taiwan', stage: 1, impacts: { packaging: -0.05, reinvestRatio: -0.15, policyCAPEX: 0.20 }, sustainQ: 1, recoveryQ: 2 },
  { risk: 'taiwan', stage: 2, impacts: { memory: -0.05, packaging: -0.30, reinvestRatio: -0.30, policyCAPEX: 0.50 }, sustainQ: 2, recoveryQ: 6 },
  { risk: 'taiwan', stage: 3, impacts: { memory: -0.12, packaging: -0.80, reinvestRatio: -0.50, policyCAPEX: 1.00 }, sustainQ: 4, recoveryQ: 12 },
  { risk: 'taiwan', stage: 4, impacts: { memory: -0.20, packaging: -0.95, reinvestRatio: -0.70, policyCAPEX: 1.50 }, sustainQ: 8, recoveryQ: 28 },

  { risk: 'russiaNato', stage: 1, impacts: { deliverablePower: -0.02, leadTime: 0.05, revenueGrowth: -0.02, reinvestRatio: -0.05, policyCAPEX: 0.05 }, sustainQ: 4, recoveryQ: 4 },
  { risk: 'russiaNato', stage: 2, impacts: { deliverablePower: -0.06, leadTime: 0.15, revenueGrowth: -0.05, reinvestRatio: -0.12, policyCAPEX: 0.15 }, sustainQ: 6, recoveryQ: 8 },
  { risk: 'russiaNato', stage: 3, impacts: { deliverablePower: -0.12, leadTime: 0.30, cloudEfficiency: -0.04, revenueGrowth: -0.12, reinvestRatio: -0.30, policyCAPEX: 0.40 }, sustainQ: 2, recoveryQ: 12 },
  { risk: 'russiaNato', stage: 4, impacts: { deliverablePower: -0.22, leadTime: 0.50, cloudEfficiency: -0.10, revenueGrowth: -0.25, reinvestRatio: -0.50, policyCAPEX: 0.80 }, sustainQ: 12, recoveryQ: 24 },

  { risk: 'middleEast', stage: 1, impacts: { leadTime: 0.05, revenueGrowth: -0.01, reinvestRatio: -0.03 }, sustainQ: 4, recoveryQ: 3 },
  { risk: 'middleEast', stage: 2, impacts: { deliverablePower: -0.04, leadTime: 0.12, revenueGrowth: -0.04, reinvestRatio: -0.08, policyCAPEX: 0.10 }, sustainQ: 4, recoveryQ: 6 },
  { risk: 'middleEast', stage: 3, impacts: { deliverablePower: -0.12, leadTime: 0.25, revenueGrowth: -0.10, reinvestRatio: -0.20, policyCAPEX: 0.25 }, sustainQ: 2, recoveryQ: 6 },
  { risk: 'middleEast', stage: 4, impacts: { deliverablePower: -0.25, leadTime: 0.45, revenueGrowth: -0.20, reinvestRatio: -0.35, policyCAPEX: 0.50 }, sustainQ: 4, recoveryQ: 12 },
];

describe('geopolitical risk catalog', () => {
  it('contains exactly three risks and five stages', () => {
    expect(Object.keys(RISK_CATALOG)).toEqual(RISK_IDS);
    for (const riskId of RISK_IDS) {
      expect(Object.keys(RISK_CATALOG[riskId]).map(Number)).toEqual(RISK_STAGES);
    }
  });

  it.each(rows)('$risk stage $stage reproduces the approved stress table', (row) => {
    const definition = RISK_CATALOG[row.risk][row.stage];
    expect(definition.impacts).toEqual(row.impacts);
    expect(definition.sustainQ).toBe(row.sustainQ);
    expect(definition.recoveryQ).toBe(row.recoveryQ);
  });

  it('uses stage 0 as a neutral additional shock for every risk', () => {
    for (const riskId of RISK_IDS) {
      expect(RISK_CATALOG[riskId][0]).toMatchObject({
        impacts: {},
        sustainQ: 0,
        recoveryQ: 0,
      });
    }
  });
});
