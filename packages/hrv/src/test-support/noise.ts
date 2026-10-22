/** Deterministic noise generators for tests. */

/** mulberry32: small seeded PRNG with a uniform output in [0, 1). */
export function seededUniform(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededGaussian(seed: number): () => number {
  const uniform = seededUniform(seed);
  return () => {
    const u1 = Math.max(uniform(), Number.EPSILON);
    const u2 = uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

export function whiteNoise(length: number, seed: number): number[] {
  const gaussian = seededGaussian(seed);
  return Array.from({ length }, () => gaussian());
}

export function brownNoise(length: number, seed: number): number[] {
  let level = 0;
  return whiteNoise(length, seed).map((step) => (level += step));
}

/**
 * Approximate 1/f noise by spectral synthesis: random-phase sinusoids with amplitude 1/sqrt(f).
 * A direct sum is O(n * components); fine for test sizes.
 */
export function pinkNoise(length: number, seed: number): number[] {
  const uniform = seededUniform(seed);
  const components = Math.floor(length / 2);
  const out = new Float64Array(length);
  for (let k = 1; k <= components; k++) {
    const amplitude = 1 / Math.sqrt(k);
    const phase = 2 * Math.PI * uniform();
    const omega = (2 * Math.PI * k) / length;
    for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) + amplitude * Math.cos(omega * i + phase);
  }
  return [...out];
}

/** RR-like series: mean 800 ms plus scaled noise, kept inside the physiological gate. */
export function toRrMs(noise: readonly number[], sdMs: number): number[] {
  const mean = noise.reduce((s, v) => s + v, 0) / noise.length;
  const sd = Math.sqrt(noise.reduce((s, v) => s + (v - mean) ** 2, 0) / noise.length) || 1;
  return noise.map((v) => 800 + ((v - mean) / sd) * sdMs);
}
