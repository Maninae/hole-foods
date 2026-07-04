// Number formatting for scores and point floaters. Accepts Number or BigInt.
// The suffix ladder goes past standard NumberFormat (which caps at Q for
// quadrillion and gets flaky past ~1e21); we walk a suffix table and, past
// Dc (1e33), fall back to mantissa + exponent so any BigInt magnitude renders.
//
// Uses digit-string math throughout so BigInt tier selection is exact — never
// round-trip a huge BigInt through Number to pick its tier. Pure module.

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function fmtCompactFromDigits(digits) {
  const tier = Math.floor((digits.length - 1) / 3);
  if (tier >= SUFFIXES.length) {
    // Beyond Dc: mantissa (one decimal) + exponent, e.g. "3.4e38".
    const exp = digits.length - 1;
    const first = digits[0];
    const dec = digits[1] ?? '0';
    return `${first}.${dec}e${exp}`;
  }
  // Within a tier: 1–3 integer digits and one ROUNDED decimal ("20,455" →
  // "20.5K"). Round on the digit after the kept decimal; a full carry
  // (999.95K…) bumps to exactly 1.0 of the next tier.
  const intLen = digits.length - tier * 3;
  const kept = Number(digits.slice(0, intLen + 2).padEnd(intLen + 2, '0'));
  let mantissa = Math.round(kept / 10); // intLen+1 significant digits
  if (String(mantissa).length > intLen + 1) {
    return tier + 1 >= SUFFIXES.length
      ? `1.0e${digits.length}`
      : `1.0${SUFFIXES[tier + 1]}`;
  }
  const m = String(mantissa);
  return `${m.slice(0, intLen)}.${m[intLen]}${SUFFIXES[tier]}`;
}

// Shared body: group below the threshold, compact ladder above it.
function fmt(n, threshold, thresholdBig) {
  if (typeof n === 'bigint') {
    if (n >= 0n && n < thresholdBig) return Number(n).toLocaleString('en-US');
    if (n < 0n && n > -thresholdBig) return Number(n).toLocaleString('en-US');
    // Negative BigInts aren't a scoring case, but handle them defensively.
    const sign = n < 0n ? '-' : '';
    const digits = (n < 0n ? -n : n).toString();
    return sign + fmtCompactFromDigits(digits);
  }
  if (Math.abs(n) < threshold) return Math.round(n).toLocaleString('en-US');
  // A fixed-notation digit string so the same value in BigInt or Number form
  // runs through the same tier logic. toFixed(0) also covers the >1e21 range
  // where toString() flips to scientific — precision is display-only.
  const sign = n < 0 ? '-' : '';
  return sign + fmtCompactFromDigits(Math.abs(n).toFixed(0));
}

// HUD score and best-run lines: full grouping until a million ("861,204"),
// then the ladder ("56.0M").
export function fmtNum(n) {
  return fmt(n, 1e6, 1000000n);
}

// Point floaters and other glanceable gains: compact from five digits up —
// "+9,999" stays exact, "+20,455" becomes "+20.5K".
export function fmtShort(n) {
  return fmt(n, 1e4, 10000n);
}
