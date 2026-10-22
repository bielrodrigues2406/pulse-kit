import { describe, expect, it } from 'vitest';

import {
  banisterTrimp,
  edwardsTrimp,
  heartRateDriftPct,
  quarterMeansBpm,
  secondsInZones,
  signalGaps,
} from './heart-rate-load.js';

const base = { restingHrBpm: 55, maxHrBpm: 195, sex: 'male' as const };

describe('banisterTrimp', () => {
  it('is the closed form for an hour at maximum heart rate', () => {
    const trimp = banisterTrimp({ ...base, hrBpm: Array<number>(3600).fill(195), intervalS: 1 });
    expect(trimp).toBeCloseTo(60 * 0.64 * Math.exp(1.92), 8);
  });

  it('does not depend on the sampling interval', () => {
    const at1s = banisterTrimp({ ...base, hrBpm: Array<number>(3600).fill(150), intervalS: 1 });
    const at5s = banisterTrimp({ ...base, hrBpm: Array<number>(720).fill(150), intervalS: 5 });
    expect(at5s).toBeCloseTo(at1s ?? Number.NaN, 8);
  });

  it('skips lost samples and uses the female coefficients when asked', () => {
    const female = banisterTrimp({ ...base, sex: 'female', hrBpm: [195, null, 195], intervalS: 60 });
    expect(female).toBeCloseTo(2 * 0.86 * Math.exp(1.67), 8);
  });

  it('needs a maximum above the resting heart rate', () => {
    expect(banisterTrimp({ ...base, maxHrBpm: 55, hrBpm: [150], intervalS: 1 })).toBeNull();
  });
});

describe('edwardsTrimp', () => {
  it('weights zone 1 by 1 and zone 5 by 5', () => {
    expect(edwardsTrimp([600, 0, 600, 0, 60])).toBe(10 + 30 + 5);
    expect(edwardsTrimp([])).toBeNull();
  });
});

describe('heartRateDriftPct', () => {
  it('ignores the warm-up', () => {
    expect(heartRateDriftPct([...Array<number>(600).fill(100), ...Array<number>(1200).fill(140)], 1)).toBe(0);
  });

  it('honours the sampling interval', () => {
    const series = [...Array<number>(120).fill(150), ...Array<number>(120).fill(100), ...Array<number>(120).fill(110)];
    expect(heartRateDriftPct(series, 5)).toBeCloseTo(10, 10);
  });

  it('needs 20 minutes after the warm-up', () => {
    expect(heartRateDriftPct(Array<number>(1500).fill(140), 1)).toBeNull();
  });
});

describe('quarterMeansBpm', () => {
  it('puts the remainder in the last quarter and skips gaps', () => {
    expect(quarterMeansBpm([1, 1, 2, null, 3, 3, 4, 4, 4])).toEqual([1, 2, 3, 4]);
    expect(quarterMeansBpm([1, 2, 3])).toEqual([]);
  });
});

describe('secondsInZones', () => {
  it('counts each sample in the highest zone it reaches', () => {
    const zones = { lowerBpm: [100, 120, 140, 160, 180] };
    expect(secondsInZones([90, 100, 119, 120, 185, null], 5, zones)).toEqual([10, 5, 0, 0, 5]);
  });
});

describe('signalGaps', () => {
  it('reports runs of lost samples at least the minimum long', () => {
    const series = [140, null, 141, null, null, null, 142, null, null];
    expect(signalGaps(series, 10, 30)).toEqual([{ startS: 30, durationS: 30 }]);
    expect(signalGaps(series, 10, 20)).toEqual([
      { startS: 30, durationS: 30 },
      { startS: 70, durationS: 20 },
    ]);
  });
});
