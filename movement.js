// phone/movement.js
//
// Movement presets for the show: how the whole picture moves while a page
// holds. Pure functions of time, beats and an intensity (0..1), so they can be
// tested and so the same preset looks the same on every phone.
//
// Everything except the screen-only flicker alpha goes into the signal: the
// table is offset and scaled before it is posted to the audio, so a scope
// slides, floats, shakes and sputters exactly like the preview.
//
// A note on flicker: an XY scope has no brightness input here, so "flicker"
// on the tube is a sputter (the picture twitches and shrinks a hair during
// each dropout). On screen it also dims, the way an old neon sign does.

export const MOVES = ['pulse', 'slide-x', 'slide-y', 'float', 'flicker', 'shake', 'none'];
export const MOVE_DEFAULT = 'pulse';
export const INTENSITY_DEFAULT = 50;

const TAU = Math.PI * 2;

// hash: a cheap repeatable 0..1 from an integer, so the flicker pattern is
// random-looking but the same on every run.
function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// neon: whether the sign is "out" at time t, and how badly. Time is cut into
// short flicker slots; slots inside a "bad stretch" drop out far more often,
// which gives the clustered stutter of a failing tube rather than an even
// strobe. Intensity scales how often it happens at all.
function neon(t, intensity) {
  const stretch = Math.floor(t / 1.4);
  const bad = hash(stretch * 7919) < 0.45;
  const slot = Math.floor(t / 0.06);
  const p = (bad ? 0.5 : 0.04) * intensity;
  return hash(slot * 104729 + 17) < p;
}

// movement: the transform for this instant.
//   beats: beats elapsed at the current tempo (drives slides and floats, so
//          they follow tap tempo); t: seconds (drives flicker and shake).
// Returns offsets and scale for the signal, `alpha` for the screen only, and
// `beat` for the beat-pulse strength (only Pulse uses it).
export function movement(preset, intensity, { beats, t, rand = Math.random }) {
  const I = Math.min(1, Math.max(0, intensity));
  const out = { dx: 0, dy: 0, scale: 1, alpha: 1, beat: 0 };
  switch (preset) {
    case 'pulse':
      out.beat = 0.7 * I;
      break;
    case 'slide-x':
      // One full side-to-side every two bars: slow enough to read as drift.
      out.dx = 0.14 * I * Math.sin((TAU * beats) / 8);
      break;
    case 'slide-y':
      out.dy = 0.11 * I * Math.sin((TAU * beats) / 8);
      break;
    case 'float':
      // Two slightly different rates, so the path never quite repeats.
      out.dx = 0.1 * I * Math.sin((TAU * beats) / 8);
      out.dy = 0.07 * I * Math.sin((TAU * beats) / 6 + 1);
      break;
    case 'shake':
      out.dx = 0.022 * I * (rand() * 2 - 1);
      out.dy = 0.022 * I * (rand() * 2 - 1);
      break;
    case 'flicker': {
      const hum = 0.93 + 0.07 * Math.sin(t * TAU * 7.3);
      if (neon(t, I)) {
        out.alpha = 0.12 + 0.2 * hash(Math.floor(t / 0.06));
        out.scale = 1 - 0.03 * I;
        out.dx = 0.006 * I * (rand() * 2 - 1);
      } else {
        out.alpha = 1 - (1 - hum) * I;
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// moveTable: apply a movement to a shape table, writing into `out`. Clamped to
// the signal range so a big slide can never push the beam past full scale.
export function moveTable(table, mv, out) {
  const n = table.x.length;
  for (let i = 0; i < n; i++) {
    out.x[i] = Math.max(-1, Math.min(1, table.x[i] * mv.scale + mv.dx));
    out.y[i] = Math.max(-1, Math.min(1, table.y[i] * mv.scale + mv.dy));
  }
  return out;
}
