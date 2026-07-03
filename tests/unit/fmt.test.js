// fmtNum has to look right across ~40 orders of magnitude — from the first
// swallow (single-digit points) to late-game runs that overflow Number entirely
// (5.8e20+ after 20 sim minutes). Cover the small range, each suffix tier, the
// e-notation fallback past Dc, and BigInt/Number parity where both apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtNum } from '../../js/hud.js';

test('sub-million: locale grouping, rounded', () => {
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(999), '999');
  assert.equal(fmtNum(12345), '12,345');
  assert.equal(fmtNum(999999), '999,999'); // upper edge of the small range
  assert.equal(fmtNum(1e6), '1.0M');         // just crossed into compact
  assert.equal(fmtNum(0n), '0');
  assert.equal(fmtNum(999n), '999');
  assert.equal(fmtNum(12345n), '12,345');
});

test('compact suffixes with one decimal', () => {
  // 1.5e6 -> "1.5M" (digits "1500000", tier 2, intPart "1", decDigit "5").
  assert.equal(fmtNum(1.5e6), '1.5M');
  // 586.2e9 -> "586.2B" (12 digits, tier 3, intPart "586", decDigit "2").
  assert.equal(fmtNum(586.2e9), '586.2B');
  // Exact BigInt parity with the two above.
  assert.equal(fmtNum(1500000n), '1.5M');
  assert.equal(fmtNum(586200000000n), '586.2B');
});

test('BigInt tiers past what Number can represent exactly', () => {
  // 3.4e24: 25 digits, tier 8 = 'Sp'.
  assert.equal(fmtNum(BigInt('3400000000000000000000000')), '3.4Sp');
  // Dc boundary: 1e33 has 34 digits, tier 11 = 'Dc'. intPart "1", decDigit "0".
  assert.equal(fmtNum(BigInt('1' + '0'.repeat(33))), '1.0Dc');
  // Just under the Dc/e-notation transition: 34 digits, tier 11, three-digit intPart.
  assert.equal(fmtNum(BigInt('999' + '0'.repeat(33))), '999.0Dc');
});

test('beyond Dc: falls back to mantissa + exponent', () => {
  // 1e36: 37 digits, tier would be 12 (>= SUFFIXES.length). exp=36, first="1", dec="0".
  assert.equal(fmtNum(BigInt('1' + '0'.repeat(36))), '1.0e36');
  // 3.4...e38 (2^128): digits length 39, exp=38, first="3", dec="4".
  assert.equal(fmtNum(2n ** 128n), '3.4e38');
});

test('Number and BigInt inputs for the same value produce the same string', () => {
  for (const [n, big] of [
    [0, 0n],
    [999, 999n],
    [12345, 12345n],
    [1500000, 1500000n],
    [586200000000, 586200000000n],
  ]) {
    assert.equal(fmtNum(n), fmtNum(big), `mismatch at ${big}`);
  }
});
