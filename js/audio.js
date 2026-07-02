// WebAudio-synthesized sound: pops pitched by prey size, gulps for big
// swallows, combo ticks, a level-up arpeggio, and a soft ambient pad.
// Zero audio assets. Mute persists in localStorage.

const MUTE_KEY = 'holefoods.muted';

let actx = null;
let master = null;
let ambientNodes = null;
let muted = false;

try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private mode */ }

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = v;
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : 1;
}

// Must be called from a user gesture at least once.
export function unlockAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
}

function env(t0, attack, decay, peak = 1) {
  const g = actx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
  return g;
}

function tone(type, f0, f1, t0, dur, peak) {
  const o = actx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = env(t0, 0.008, dur, peak);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(t0, dur, filterFrom, filterTo, peak) {
  const len = Math.ceil(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(filterFrom, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
  const g = env(t0, 0.005, dur, peak);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// sizeRatio: prey radius / hole radius, 0..~1. Small prey = high chirpy pop.
export function pop(sizeRatio) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const f = 760 - 500 * Math.min(1, sizeRatio);
  tone('sine', f, f * 0.45, t0, 0.11, 0.22);
  noise(t0, 0.05, 2400, 900, 0.1);
}

export function gulp() {
  if (!actx) return;
  const t0 = actx.currentTime;
  tone('sine', 170, 52, t0, 0.28, 0.4);
  noise(t0, 0.22, 900, 120, 0.28);
}

export function comboTick(mult) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const f = 340 * Math.pow(1.14, mult);
  tone('square', f, f * 1.3, t0, 0.07, 0.1);
}

export function levelUp() {
  if (!actx) return;
  const t0 = actx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone('triangle', f, f, t0 + i * 0.075, 0.22, 0.16);
  });
}

export function uiClick() {
  if (!actx) return;
  tone('sine', 520, 380, actx.currentTime, 0.06, 0.12);
}

// A very soft two-oscillator pad; call once when a run starts.
export function startAmbient() {
  if (!actx || ambientNodes) return;
  const g = actx.createGain();
  g.gain.value = 0.02;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 260;
  const lfo = actx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = actx.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain).connect(f.frequency);
  const oscs = [110, 164.8].map((freq, i) => {
    const o = actx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.detune.value = i === 0 ? -4 : 5;
    o.connect(f);
    o.start();
    return o;
  });
  f.connect(g).connect(master);
  lfo.start();
  ambientNodes = { oscs, lfo, g };
}
