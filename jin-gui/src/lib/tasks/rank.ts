/**
 * Pure fractional position key generator — JS twin of jin-core/src/order.rs (§1.5).
 *
 * # Alphabet
 * Base-62, ASCII-ordered: `0-9A-Za-z`.
 * Lexicographic string comparison (JS `<` / `>`) yields the correct rank order
 * because the alphabet characters are in strictly increasing code-point order.
 *
 * # Contract
 * `between(a, b)` returns a key `m` such that:
 * - `a !== null` → `a < m` (JS string comparison)
 * - `b !== null` → `m < b` (JS string comparison)
 * - `null` on either side means an open bound (−∞ / +∞).
 *
 * Must stay in sync with jin-core/src/order.rs `between()`.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = 62;
/** Index of 'V' — approximate midpoint of the alphabet. */
const MID_IDX = 31;

/** Returns the position (0-based) of `c` in ALPHABET.  Throws if not found. */
function idxOf(c: string): number {
  const i = ALPHABET.indexOf(c);
  if (i === -1) {
    throw new Error(`rank.between — character '${c}' is not in the base-62 alphabet`);
  }
  return i;
}

/**
 * Returns a string strictly less than `b` by decrementing the last character
 * that is not at the alphabet minimum ('0').
 *
 * Returns an empty string for the degenerate all-'0' case.
 */
function stepBefore(b: string): string {
  if (b.length === 0) return "";
  for (let i = b.length - 1; i >= 0; i--) {
    const cur = idxOf(b[i]);
    if (cur > 0) {
      return b.slice(0, i) + ALPHABET[cur - 1];
    }
    // cur === 0 ('0'): minimum character, keep going left.
  }
  // All characters are '0'.
  return "";
}

/**
 * Returns a string strictly between `a` and `b` (requires `a < b`).
 *
 * Uses the same digit-by-digit midpoint algorithm as the Rust twin.
 */
function midpointStr(a: string, b: string): string {
  const maxLen = Math.max(a.length, b.length) + 1;
  const result: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const da = i < a.length ? idxOf(a[i]) : 0;   // pad a with minimum
    const db = i < b.length ? idxOf(b[i]) : BASE; // pad b with sentinel

    if (db === da) {
      result.push(ALPHABET[da]);
    } else if (db === da + 1) {
      result.push(ALPHABET[da]);
      // Copy remaining digits of a.
      for (let j = i + 1; j < a.length; j++) {
        result.push(a[j]);
      }
      result.push(ALPHABET[MID_IDX]);
      return result.join("");
    } else if (db > da + 1) {
      result.push(ALPHABET[da + Math.floor((db - da) / 2)]);
      return result.join("");
    } else {
      throw new Error(
        `rank.between — a is not less than b at position ${i} (a=${JSON.stringify(a)} b=${JSON.stringify(b)})`,
      );
    }
  }

  // Safety net (should be unreachable for valid inputs).
  return a + ALPHABET[MID_IDX];
}

/**
 * Returns a rank key strictly between `a` and `b`.
 *
 * @param a Lower bound (null = open lower bound / −∞).
 * @param b Upper bound (null = open upper bound / +∞).
 */
export function between(a: string | null, b: string | null): string {
  if (a === null && b === null) return ALPHABET[MID_IDX];
  if (a !== null && b === null) return a + ALPHABET[MID_IDX];
  if (a === null && b !== null) return stepBefore(b);
  return midpointStr(a!, b!);
}
