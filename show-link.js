// phone/show-link.js
//
// The link IS the saved state of a show: the message and the three timings
// ride in the URL hash, so tuning one and sending it needs no account, no
// storage and no redeploy.
//
//   #t=LINE%0ALINE&h=<line seconds>&s=<shape seconds>&x=<transition seconds>&b=<bpm>&r=<trace Hz>
//
// Pure string-to-state and state-to-string, kept out of the player so both
// halves can be tested without a browser. A link is the one piece of this that
// arrives from outside — pasted, forwarded, hand-edited, truncated by a chat
// app — so every field is clamped on the way in rather than trusted.

// rate: how many times a second the beam retraces the page. The phone puts out
// 48000 samples a second, so this sets the samples per lap (48000/75 = 640). At
// 150 the 1024-point tables were cut to every third point, and the DAC filter
// rang at every stroke-to-stroke jump: fine on the canvas, glitchy on a tube.
// Lower is cleaner but flickers sooner; 75 is the default after simulating it.
export const SHOW_DEFAULTS = { hold: 3.2, solidHold: 2.4, morph: 0.7, bpm: 96, rate: 75 };

export const SHOW_LIMITS = { hold: [1, 10], solidHold: [1, 10], morph: [0.2, 3], bpm: [40, 200], rate: [40, 150] };

// A message long enough to break a URL is a message nobody can send, and every
// page it makes is a resampled table held in memory.
import { MOVES, MOVE_DEFAULT, INTENSITY_DEFAULT } from './movement.js';

export const MAX_MESSAGE = 600;
// The event's name: browser tab and opening heading. Optional; without it the
// page keeps its generic title.
export const MAX_TITLE = 90;
export const DEFAULT_TITLE = 'For your oscilloscope';

// Transition styles: 'morph' point-lerps page into page; 'static' blows the
// outgoing page apart into fuzz before the next one draws on; 'warp' swirls
// it through a vortex into the next.
export const FX = ['morph', 'static', 'warp'];

const KEYS = { hold: 'h', solidHold: 's', morph: 'x', bpm: 'b', rate: 'r' };

export function clampTiming(key, value) {
  const [lo, hi] = SHOW_LIMITS[key];
  return Number.isFinite(+value) && String(value).trim() !== ''
    ? Math.min(hi, Math.max(lo, +value))
    : SHOW_DEFAULTS[key];
}

// parseShowLink: the hash (with or without its leading #) plus the message the
// page ships with, which is what a link carrying no message of its own gets.
// `custom` tells the caller whether the message came from the link, because
// only then does the link need to keep carrying it.
export function parseShowLink(hash, fallbackMessage = '') {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const t = params.get('t');
  const custom = typeof t === 'string' && t.trim() !== '' && t.length <= MAX_MESSAGE;
  const state = {
    message: custom ? t : fallbackMessage,
    custom,
  };
  const n = (params.get('n') ?? '').trim();
  state.title = n ? n.slice(0, MAX_TITLE) : '';
  state.fx = FX.includes(params.get('e')) ? params.get('e') : 'morph';
  state.move = MOVES.includes(params.get('m')) ? params.get('m') : MOVE_DEFAULT;
  const i = Number(params.get('i'));
  state.intensity = params.has('i') && Number.isFinite(i) ? Math.min(100, Math.max(0, Math.round(i))) : INTENSITY_DEFAULT;
  for (const [key, param] of Object.entries(KEYS)) {
    state[key] = params.has(param)
      ? clampTiming(key, params.get(param))
      : SHOW_DEFAULTS[key];
  }
  return state;
}

// buildShowLink: the hash for a state, rounded to the precision the sliders
// actually offer so the URL does not carry 3.2000000000000002 around.
export function buildShowLink(state) {
  const params = new URLSearchParams();
  if (state.custom && state.message?.trim()) {
    params.set('t', state.message.trim().slice(0, MAX_MESSAGE));
  }
  params.set(KEYS.hold, clampTiming('hold', state.hold).toFixed(1));
  params.set(KEYS.solidHold, clampTiming('solidHold', state.solidHold).toFixed(1));
  params.set(KEYS.morph, clampTiming('morph', state.morph).toFixed(2));
  params.set(KEYS.bpm, Math.round(clampTiming('bpm', state.bpm ?? SHOW_DEFAULTS.bpm)));
  if (state.rate != null && Math.round(state.rate) !== SHOW_DEFAULTS.rate) {
    params.set(KEYS.rate, Math.round(clampTiming('rate', state.rate)));
  }
  if (state.title?.trim()) params.set('n', state.title.trim().slice(0, MAX_TITLE));
  if (state.fx && state.fx !== 'morph' && FX.includes(state.fx)) params.set('e', state.fx);
  if (state.move && MOVES.includes(state.move)) params.set('m', state.move);
  if (Number.isFinite(state.intensity)) params.set('i', String(Math.round(state.intensity)));
  return `#${params}`;
}

// tapTempo: BPM from a run of tap timestamps (ms). Uses the last few gaps so
// one sloppy tap does not swing it, and a pause longer than RESET_MS starts a
// fresh run. Returns null until there are two taps in the current run.
export const TAP_RESET_MS = 2000;

export function tapTempo(taps) {
  let run = [];
  for (const t of taps) {
    if (run.length && t - run[run.length - 1] > TAP_RESET_MS) run = [];
    run.push(t);
  }
  if (run.length < 2) return null;
  const recent = run.slice(-5);
  const gap = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  return clampTiming('bpm', 60000 / gap);
}
