import { describe, expect, it } from 'vitest';

import { trainingLoadSeries } from './training-load.js';

describe('trainingLoadSeries', () => {
  it('moves ATL a seventh and CTL a forty-second toward the day load', () => {
    const [day] = trainingLoadSeries([{ date: '2026-10-01', load: 70 }], { toDate: '2026-10-01' });
    expect(day?.atl).toBeCloseTo(10, 10);
    expect(day?.ctl).toBeCloseTo(70 / 42, 10);
    expect(day?.tsb).toBe(0);
  });

  it('uses yesterday for form, so today does not change it', () => {
    const days = trainingLoadSeries([{ date: '2026-10-01', load: 70 }], { toDate: '2026-10-02' });
    expect(days[1]?.tsb).toBeCloseTo((days[0]?.ctl ?? 0) - (days[0]?.atl ?? 0), 10);
  });

  it('fills rest days and sums sessions on the same day', () => {
    const days = trainingLoadSeries(
      [
        { date: '2026-10-01', load: 30 },
        { date: '2026-10-01', load: 40 },
        { date: '2026-10-04', load: 10 },
      ],
      { toDate: '2026-10-05' },
    );
    expect(days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(days.map((d) => d.load)).toEqual([70, 0, 0, 10, 0]);
  });

  it('converges to a constant daily load', () => {
    const loads = Array.from({ length: 400 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      load: 100,
    }));
    const last = trainingLoadSeries(loads, { toDate: loads.at(-1)?.date ?? '' }).at(-1);
    expect(last?.atl).toBeCloseTo(100, 6);
    expect(last?.ctl).toBeCloseTo(100, 1);
  });

  it('crosses month and leap-day boundaries', () => {
    const days = trainingLoadSeries([], { fromDate: '2028-02-28', toDate: '2028-03-01' });
    expect(days.map((d) => d.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('rejects malformed dates', () => {
    expect(() => trainingLoadSeries([{ date: '2026-13-01', load: 1 }], { toDate: '2026-10-01' })).toThrow(RangeError);
    expect(() => trainingLoadSeries([], { toDate: '1/10/2026' })).toThrow(RangeError);
  });
});
