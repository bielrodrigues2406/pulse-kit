import { describe, expect, it } from 'vitest';

import { DFA_MAX_BOX_BEATS, DFA_MIN_BOX_BEATS, dfaAlpha1, dfaAlpha1Series, dfaAlpha1Window, olsSlope } from './dfa-alpha1.js';
import { classifyRrSeries, type RrBeat } from './rr-quality.js';
import { brownNoise, pinkNoise, toRrMs, whiteNoise } from './test-support/noise.js';

const SEEDS = [1, 2, 3, 4, 5];
const LONG = 8000;

/**
 * For white noise, linear DFA has F^2(n) proportional to (n^2 - 4) / n (Kantelhardt et al., 2001),
 * so the least-squares exponent over 4..16 beats is about 0.583, not the asymptotic 0.5.
 */
function whiteNoiseAlpha1OverBoxes(): number {
  const logN: number[] = [];
  const logF: number[] = [];
  for (let n = DFA_MIN_BOX_BEATS; n <= DFA_MAX_BOX_BEATS; n++) {
    logN.push(Math.log10(n));
    logF.push(0.5 * Math.log10((n * n - 4) / n));
  }
  return olsSlope(logN, logF);
}

const meanAlpha = (make: (n: number, seed: number) => number[]): number =>
  SEEDS.map((seed) => dfaAlpha1(make(LONG, seed)) ?? Number.NaN).reduce((s, v) => s + v, 0) / SEEDS.length;

describe('dfaAlpha1', () => {
  it('matches the finite-scale theory for white noise', () => {
    expect(whiteNoiseAlpha1OverBoxes()).toBeCloseTo(0.583, 3);
    expect(meanAlpha(whiteNoise)).toBeCloseTo(whiteNoiseAlpha1OverBoxes(), 1);
    expect(Math.abs(meanAlpha(whiteNoise) - whiteNoiseAlpha1OverBoxes())).toBeLessThan(0.03);
  });

  it('is about 1.0 for 1/f noise', () => {
    expect(Math.abs(meanAlpha(pinkNoise) - 1)).toBeLessThan(0.06);
  });

  it('is about 1.5 for Brownian noise', () => {
    expect(Math.abs(meanAlpha(brownNoise) - 1.5)).toBeLessThan(0.06);
  });

  it('orders the three noises even on a 2-minute-sized series', () => {
    for (const seed of SEEDS) {
      const white = dfaAlpha1(whiteNoise(150, seed)) ?? Number.NaN;
      const brown = dfaAlpha1(brownNoise(150, seed)) ?? Number.NaN;
      expect(white).toBeLessThan(brown);
    }
  });

  it('does not depend on the mean or the unit of the intervals', () => {
    const base = toRrMs(pinkNoise(600, 9), 40);
    const alpha = dfaAlpha1(base) ?? Number.NaN;
    expect(dfaAlpha1(base.map((v) => v + 250))).toBeCloseTo(alpha, 10);
    expect(dfaAlpha1(base.map((v) => v / 1000))).toBeCloseTo(alpha, 10);
  });

  it('returns null for a series too short or without fluctuation', () => {
    expect(dfaAlpha1(whiteNoise(31, 1))).toBeNull();
    expect(dfaAlpha1(Array<number>(200).fill(800))).toBeNull();
  });
});

function beatsWithArtifacts(count: number, artifactEvery: number | null): readonly RrBeat[] {
  const rr = toRrMs(pinkNoise(count, 3), 25);
  return classifyRrSeries(rr.map((v, i) => (artifactEvery !== null && i > 0 && i % artifactEvery === 0 ? 3000 : v)));
}

describe('dfaAlpha1Window', () => {
  it('scores a clean window', () => {
    const result = dfaAlpha1Window(beatsWithArtifacts(150, null));
    expect(result?.artifactRate).toBe(0);
    expect(result?.lowConfidence).toBe(false);
    expect(result?.acceptedBeats).toBe(150);
  });

  it('flags 3-5% artifacts as low confidence', () => {
    const result = dfaAlpha1Window(beatsWithArtifacts(150, 25));
    expect(result?.artifactRate).toBeGreaterThan(0.03);
    expect(result?.lowConfidence).toBe(true);
  });

  it('refuses more than 5% artifacts', () => {
    expect(dfaAlpha1Window(beatsWithArtifacts(150, 10))).toBeNull();
  });

  it('refuses fewer than 90 accepted beats', () => {
    expect(dfaAlpha1Window(beatsWithArtifacts(89, null))).toBeNull();
  });
});

describe('dfaAlpha1Series', () => {
  it('slides a 2-minute window every 5 seconds', () => {
    const beats = classifyRrSeries(toRrMs(pinkNoise(600, 4), 20));
    const points = dfaAlpha1Series(beats);
    const lastMs = beats.at(-1)?.tMs ?? 0;
    expect(points.length).toBe(Math.floor((lastMs - 120_000) / 5_000) + 1);
    expect(points[0]?.tMs).toBe(120_000);
    expect(points[0]?.hrBpm).toBeCloseTo(75, 0);
  });

  it('is empty without beats', () => {
    expect(dfaAlpha1Series([])).toEqual([]);
  });
});
