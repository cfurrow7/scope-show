// phone/wave.js
//
// A great wave in the Japanese woodblock style, drawn for the beam: a tall
// wave rising on the left and curling over to the right, its lip breaking
// into claw-like fingers of foam, an inner curl, foam lines following the
// wave's body, small waves in the foreground and a little snow-capped
// mountain in the trough. Original line drawing, authored on a 0-100 grid.
//
// Curves are authored as a few control points and smoothed (Catmull-Rom);
// the claws and the mountain are left sharp on purpose.

const MARGIN = 0.9;

// Grid (0..100, y up) to tube coordinates.
const P = ([x, y]) => ({ x: (x / 100) * 2 * MARGIN - MARGIN, y: (y / 100) * 2 * MARGIN - MARGIN });

// smooth: Catmull-Rom through the points, `per` samples per segment.
function smooth(pts, per = 8) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// claws: foam fingers hanging from the underside of the lip, running from
// `a` back to `b`. Each one drops down, hooks, and curls its tip back toward
// the wave, rounded rather than toothed, then the beam returns along the lip
// to the next. Smoothed per finger so they read as spray, not a saw.
function claws(a, b, count, reach) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const u = i / count;
    const x = a[0] + (b[0] - a[0]) * u;
    const y = a[1] + (b[1] - a[1]) * u;
    const r = reach * (1 - 0.4 * u);
    const finger = smooth([
      [x, y],
      [x + r * 0.25, y - r * 0.55],
      [x - r * 0.05, y - r * 1.0],
      [x - r * 0.45, y - r * 0.85],
      [x - r * 0.35, y - r * 0.55],
    ], 5);
    out.push(...finger);
    const nu = (i + 1) / count;
    out.push([a[0] + (b[0] - a[0]) * nu, a[1] + (b[1] - a[1]) * nu]);
  }
  return out;
}

function build() {
  const strokes = [];

  // The wave: up the back, over the crest, out along the lip, then the
  // claws breaking down the front, ending in the inner curl. One stroke.
  const back = smooth([[2, 26], [10, 42], [20, 60], [32, 76], [46, 86], [60, 90], [72, 89], [82, 83], [88, 74]]);
  const lip = claws([88, 74], [66, 62], 6, 8);
  const curl = smooth([[66, 62], [60, 64], [55, 60], [56, 53], [61, 52], [63, 56], [60, 58]], 6);
  strokes.push([...back, ...lip, ...curl]);

  // The rest, ordered so each stroke starts near where the last one ended
  // (some run backwards for it): every gap between strokes is a beam jump
  // that streaks across the picture, so the route matters.
  // Foam lines following the body of the wave, zig-zagging down from the curl.
  strokes.push(smooth([[10, 30], [18, 46], [28, 62], [40, 75], [54, 81], [68, 80]]).reverse());
  strokes.push(smooth([[18, 26], [26, 40], [35, 54], [45, 64], [54, 67]]));
  strokes.push(smooth([[26, 22], [33, 34], [41, 45], [49, 52]]).reverse());

  // The mountain in the trough, with a snow line across its peak.
  strokes.push([[36, 16], [44, 30], [47, 32], [50, 31], [58, 16]]);
  strokes.push([[53, 24], [51, 23], [49, 26], [47, 23], [45, 26], [43, 23], [41, 25]]);

  // Small waves in the foreground, each with its own little curl.
  strokes.push(smooth([[70, 6], [77, 14], [84, 18], [89, 15], [87, 11], [83, 12]], 6));
  strokes.push(smooth([[84, 4], [90, 9], [95, 10], [97, 7], [94, 5]], 6));

  // The hollow under the curl, drawn from the sea on the right back up into it.
  strokes.push(smooth([[56, 50], [59, 38], [64, 27], [73, 19], [86, 17], [100, 19]]).reverse());

  return strokes.map(s => s.map(P));
}

const WAVE = build();

// waveStrokes: the wave at time t, rocking gently about its base as if it is
// still building, with a slow breath in its height.
export function waveStrokes(t) {
  const a = 0.045 * Math.sin(t * 0.7);
  const lift = 1 + 0.035 * Math.sin(t * 0.9 + 0.6);
  const cos = Math.cos(a), sin = Math.sin(a);
  const pivot = { x: 0, y: -MARGIN };
  return WAVE.map(s => s.map(({ x, y }) => {
    const dx = x - pivot.x, dy = (y - pivot.y) * lift;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  }));
}
