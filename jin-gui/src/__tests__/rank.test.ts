/**
 * VG-P2 / VG-P9 rank invariant tests for rank.ts `between()`.
 *
 * Mirrors the invariant tests in jin-core/src/order.rs.
 * Both modules must stay in sync (spec §1.5).
 */

import { describe, it, expect } from "vitest";
import { between } from "../lib/tasks/rank";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function inAlphabet(k: string): boolean {
  return k.split("").every((c) => ALPHABET.includes(c));
}

describe("rank.between — core invariants (VG-P2 / VG-P9)", () => {
  it("between(null, null) returns a non-empty key", () => {
    const k = between(null, null);
    expect(k.length).toBeGreaterThan(0);
    expect(inAlphabet(k)).toBe(true);
  });

  it("a < between(a, b) < b for typical generated keys", () => {
    const a = "V";
    const b = "z";
    const m = between(a, b);
    expect(a < m).toBe(true);
    expect(m < b).toBe(true);
  });

  it("between(null, b) < b for a typical key", () => {
    const b = "V";
    const m = between(null, b);
    expect(m < b).toBe(true);
  });

  it("a < between(a, null) for a typical key", () => {
    const a = "V";
    const m = between(a, null);
    expect(a < m).toBe(true);
  });

  it("is deterministic: same inputs always yield the same output", () => {
    const a = "MN";
    const b = "VV";
    expect(between(a, b)).toBe(between(a, b));
    expect(between(null, b)).toBe(between(null, b));
    expect(between(a, null)).toBe(between(a, null));
  });

  it("all characters in generated keys are in the base-62 alphabet", () => {
    const cases = [
      between(null, null),
      between("V", null),
      between(null, "z"),
      between("0", "z"),
      between("VUz", "VV"),
    ];
    for (const k of cases) {
      expect(inAlphabet(k)).toBe(true);
    }
  });
});

describe("rank.between — sequence ordering (VG-P2 / VG-P9)", () => {
  it("repeated between(prev, upper) insertions stay ordered and unique", () => {
    const upper = "z";
    const keys: string[] = [];
    let prev: string | null = null;

    for (let i = 0; i < 20; i++) {
      const k = between(prev, upper);
      if (prev !== null) {
        expect(prev < k).toBe(true);
      }
      expect(k < upper).toBe(true);
      prev = k;
      keys.push(k);
    }

    // No collisions.
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("midpoint insertions between the same pair stay ordered", () => {
    let lo = "V";
    const hi = "VV";

    for (let i = 0; i < 15; i++) {
      const m = between(lo, hi);
      expect(lo < m).toBe(true);
      expect(m < hi).toBe(true);
      lo = m; // use midpoint as new lower bound
    }
  });

  it("repeated prepend-before-first insertions are ordered", () => {
    let upper = "V";
    const keys: string[] = [];

    for (let i = 0; i < 10; i++) {
      const k = between(null, upper);
      if (k.length > 0) {
        expect(k < upper).toBe(true);
        keys.push(k);
        upper = k;
      }
    }

    // Earlier keys must sort higher than later ones.
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] < keys[i - 1]).toBe(true);
    }
  });
});

describe("rank.between — alphabet edge cases", () => {
  it("between adjacent single-char keys lands strictly between them", () => {
    const m = between("V", "W");
    expect("V" < m).toBe(true);
    expect(m < "W").toBe(true);
  });

  it("between('0', '1') returns a key strictly between them", () => {
    const m = between("0", "1");
    expect("0" < m).toBe(true);
    expect(m < "1").toBe(true);
  });

  it("between('V', 'z') returns a key in range", () => {
    const m = between("V", "z");
    expect("V" < m).toBe(true);
    expect(m < "z").toBe(true);
  });

  it("long key sequences via between(a, null) stay valid", () => {
    let key = between(null, null);
    for (let i = 0; i < 10; i++) {
      key = between(key, null);
    }
    expect(key.length).toBeGreaterThan(0);
    expect(inAlphabet(key)).toBe(true);
  });

  it("between(null, 'V') returns something before V", () => {
    const m = between(null, "V");
    expect(m < "V").toBe(true);
  });

  it("between(null, 'VV') returns something before VV", () => {
    const m = between(null, "VV");
    expect(m < "VV").toBe(true);
  });

  it("between(null, '1') returns something before '1'", () => {
    const m = between(null, "1");
    expect(m < "1").toBe(true);
  });

  it("between('VUz', 'VV') produces a key strictly between them", () => {
    const m = between("VUz", "VV");
    expect("VUz" < m).toBe(true);
    expect(m < "VV").toBe(true);
  });

  it("between(null, '0V') returns something less than '0V'", () => {
    const m = between(null, "0V");
    expect(m < "0V").toBe(true);
  });
});
