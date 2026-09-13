/**
 * Deterministic PRNG: mulberry32. The algorithm name and version are part of
 * the execution contract — change the version string if the stream changes.
 *
 * Sample-level determinism: the stream for sample i is derived from
 * hash(seed, i), so results do not depend on worker count or completion order.
 */

import { sha256Hex } from "./sha256";

export const PRNG_ALGORITHM = "mulberry32";
export const PRNG_VERSION = "mulberry32.v1";

export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
}

export function createPrng(seed: number): Prng {
  if (!Number.isInteger(seed))
    throw new Error(`Seed must be an integer, got ${seed}`);
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Derive the independent stream seed for sample `sampleIndex` under `seed`. */
export function sampleSeed(seed: number, sampleIndex: number): number {
  const hex = sha256Hex(`${PRNG_VERSION}:${seed}:${sampleIndex}`);
  // Take the first 8 hex chars as a uint32 seed.
  return parseInt(hex.slice(0, 8), 16) >>> 0;
}

export function createSamplePrng(seed: number, sampleIndex: number): Prng {
  return createPrng(sampleSeed(seed, sampleIndex));
}
