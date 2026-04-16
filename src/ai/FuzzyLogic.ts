import * as YUKA from 'yuka';
import type { TDMAgent } from '@/entities/TDMAgent';

export function setupFuzzy(ag: TDMAgent): void {
  const fm = new YUKA.FuzzyModule();

  const hV = new YUKA.FuzzyVariable();
  const hCrit = new YUKA.LeftShoulderFuzzySet(0, 0, 15, 30);
  const hLow = new YUKA.TriangularFuzzySet(20, 37, 55);
  const hMed = new YUKA.TriangularFuzzySet(45, 62, 78);
  const hHigh = new YUKA.RightShoulderFuzzySet(68, 82, 100, 100);
  hV.add(hCrit); hV.add(hLow); hV.add(hMed); hV.add(hHigh);
  fm.addFLV('health', hV);

  const dV = new YUKA.FuzzyVariable();
  const dCls = new YUKA.LeftShoulderFuzzySet(0, 0, 10, 22);
  const dMed = new YUKA.TriangularFuzzySet(16, 35, 55);
  const dFar = new YUKA.RightShoulderFuzzySet(45, 70, 120, 120);
  dV.add(dCls); dV.add(dMed); dV.add(dFar);
  fm.addFLV('distance', dV);

  const aV = new YUKA.FuzzyVariable();
  const aLow = new YUKA.LeftShoulderFuzzySet(0, 0, 25, 45);
  const aMed = new YUKA.TriangularFuzzySet(30, 50, 70);
  const aHigh = new YUKA.RightShoulderFuzzySet(55, 75, 100, 100);
  aV.add(aLow); aV.add(aMed); aV.add(aHigh);
  fm.addFLV('aggression', aV);

  const R = (c: YUKA.FuzzyCompositeTerm, r: YUKA.FuzzySet) =>
    fm.addRule(new YUKA.FuzzyRule(c, r));

  R(new YUKA.FuzzyAND(hCrit, dCls), aLow);
  R(new YUKA.FuzzyAND(hCrit, dMed), aLow);
  R(new YUKA.FuzzyAND(hCrit, dFar), aLow);
  R(new YUKA.FuzzyAND(hLow, dCls), aLow);
  R(new YUKA.FuzzyAND(hLow, dMed), aMed);
  R(new YUKA.FuzzyAND(hLow, dFar), aMed);
  R(new YUKA.FuzzyAND(hMed, dCls), aMed);
  R(new YUKA.FuzzyAND(hMed, dMed), aMed);
  R(new YUKA.FuzzyAND(hMed, dFar), aHigh);
  R(new YUKA.FuzzyAND(hHigh, dCls), aHigh);
  R(new YUKA.FuzzyAND(hHigh, dMed), aHigh);
  R(new YUKA.FuzzyAND(hHigh, dFar), aMed);

  ag.fuzzyModule = fm;
}

export function evalFuzzy(ag: TDMAgent, targetDist: number): void {
  if (!ag.fuzzyModule) return;

  ag.fuzzyModule.fuzzify('health', Math.max(0, Math.min(100, (ag.hp / ag.maxHP) * 100)));
  ag.fuzzyModule.fuzzify('distance', Math.max(0, Math.min(120, targetDist)));

  let aggression = ag.fuzzyModule.defuzzify('aggression', YUKA.FuzzyModule.DEFUZ_TYPE.CENTROID);

  const ammoRatio = ag.magSize > 0 ? ag.ammo / ag.magSize : 0;
  if (ammoRatio < 0.15) aggression *= 0.5;
  else if (ammoRatio < 0.3) aggression *= 0.75;
  else if (ammoRatio > 0.8) aggression *= 1.1;

  const confFactor = (ag.confidence - 50) * 0.004;
  aggression *= (1 + confFactor);

  aggression *= (0.5 + ag.aggressivenessBase);

  if (ag.nearbyAllies >= 2) aggression *= 1.15;
  if (ag.nearbyAllies >= 3) aggression *= 1.1;

  if (ag.underPressure) aggression *= (1 - ag.pressureLevel * 0.4);

  // ── Personality bias ──
  const p = ag.personality;
  if (p) {
    aggression += p.aggressionBias * 20;
    // Tilt reduces composure and pushes aggression one way or the other
    if (ag.tiltLevel > 0) {
      const tiltSwing = (Math.random() - 0.5) * p.tiltFactor * ag.tiltLevel * 30;
      aggression += tiltSwing;
    }
    // Teamwork: having allies nearby boosts more for team-oriented personalities
    if (ag.nearbyAllies >= 2) aggression += p.teamworkBias * 8;
  }

  ag.fuzzyAggr = Math.max(0, Math.min(100, aggression));
}
