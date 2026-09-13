import { describe, expect, it } from "vitest";
import { sha256Hex } from "../sha256";
import { canonicalHash, canonicalJson } from "../canonical";
import {
  createPrng,
  createSamplePrng,
  PRNG_VERSION,
  sampleSeed,
} from "../prng";

describe("sha256", () => {
  it("matches published test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

describe("canonical JSON + hash", () => {
  it("is key-order independent", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("normalizes -0 and rejects non-finite numbers and undefined", () => {
    expect(canonicalJson({ x: -0 })).toBe('{"x":0}');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ x: undefined })).toThrow();
  });
});

describe("prng (V07, V13)", () => {
  it("produces a deterministic stream per seed", () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("derives independent per-sample streams (worker-order independence)", () => {
    expect(sampleSeed(1, 0)).not.toBe(sampleSeed(1, 1));
    const s0 = createSamplePrng(7, 0);
    const s1 = createSamplePrng(7, 1);
    expect([s0.next(), s0.next()]).not.toEqual([s1.next(), s1.next()]);
    // Same sample index → identical stream regardless of creation order.
    const first = createSamplePrng(7, 5).next();
    const again = createSamplePrng(7, 5).next();
    expect(first).toBe(again);
  });

  it("pins the algorithm version string", () => {
    expect(PRNG_VERSION).toBe("mulberry32.v1");
  });
});
