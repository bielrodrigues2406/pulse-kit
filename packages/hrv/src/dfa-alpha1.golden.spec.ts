import { describe, expect, it } from 'vitest';

import { dfaAlpha1 } from './dfa-alpha1.js';
import golden from './fixtures/neurokit2-dfa-alpha1.json' with { type: 'json' };

// Copied from physio-lab golden/dfa-alpha1.json (synthetic series, NeuroKit2 as the oracle).
// NeuroKit2 without overlap runs the same algorithm, so the two must agree to rounding.
describe('dfaAlpha1 against NeuroKit2', () => {
  it.each(golden.cases)('$name', ({ rr_ms, nk_alpha1_nonoverlap }) => {
    expect(dfaAlpha1(rr_ms)).toBeCloseTo(nk_alpha1_nonoverlap, 9);
  });

  it('documents how far the 50% overlap default of NeuroKit2 can move short windows', () => {
    const gaps = golden.cases.map((c) => Math.abs(c.nk_alpha1_overlap - c.nk_alpha1_nonoverlap));
    expect(Math.max(...gaps)).toBeLessThan(0.15);
  });
});
