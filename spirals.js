// phone/spirals.js
//
// Flat spirals, from a page of hand drawings: a triangle, a square and a round
// spiral, each winding in from an outer tail to a curl at the centre. Emitted
// as strokes, the same as the font and wireframe.js, so a spiral resamples into
// an ordinary shape table and text can point-lerp into it.
//
// Each spiral is ONE stroke. That is the reason they suit a scope better than
// the cube: no pen-ups means no faint beam-jump streaks across the picture.
//
// Motion is a steady in-plane spin. A spinning spiral reads as winding inward
// (or outward) forever, which is the whole point of drawing one.

const MARGIN = 0.86;

// polygonSpiral: corners of a regular polygon with the radius shrinking a
// little at every corner, so each lap sits inside the last. Straight edges need
// only their corners, since resampleStrokes spreads points by arc length.
// `tail` extends the first edge backward past the outermost corner, the way
// the drawn spirals start with a line that overshoots.
function polygonSpiral({ sides, turns, inner, rotation, tail }) {
  const corners = Math.round(sides * turns);
  const pts = [];
  for (let k = 0; k <= corners; k++) {
    const r = 1 - (1 - inner) * (k / corners);
    const a = rotation + (k * 2 * Math.PI) / sides;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const [p0, p1] = pts;
  pts.unshift({ x: p0.x - (p1.x - p0.x) * tail, y: p0.y - (p1.y - p0.y) * tail });
  return pts;
}

// roundSpiral: Archimedean, centre curl outward, finishing on a tail whose
// radius opens up faster than the laps, like the bottom drawing.
function roundSpiral({ turns, steps }) {
  const pts = [];
  const end = turns * 2 * Math.PI;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * end;
    const lap = a / end;
    const r = 0.06 + 0.84 * lap + 0.22 * Math.max(0, lap - 0.88) / 0.12;
    pts.push({ x: r * Math.cos(-a), y: r * Math.sin(-a) });
  }
  return pts;
}

const SHAPES = {
  // Apex up, winding in three and a bit laps to a small inner triangle.
  triangle: polygonSpiral({ sides: 3, turns: 3.34, inner: 0.2, rotation: Math.PI / 2, tail: 0.3 }),
  // Starts top-left on a tail and closes on a tight hook in the middle.
  square: polygonSpiral({ sides: 4, turns: 4.5, inner: 0.08, rotation: (3 * Math.PI) / 4, tail: 0.18 }),
  circle: roundSpiral({ turns: 3.5, steps: 320 }),
};

// Fit once, by the furthest point from the centre, so the spin can never push
// a corner off the tube and the size does not pump as it turns.
for (const pts of Object.values(SHAPES)) {
  const maxR = Math.max(...pts.map(p => Math.hypot(p.x, p.y)));
  for (const p of pts) {
    p.x *= MARGIN / maxR;
    p.y *= MARGIN / maxR;
  }
}

export const SPIRALS = Object.keys(SHAPES);

export const SPIN = 0.7; // radians per second

// How long a spiral takes to trace itself on, pen-style, before it holds
// complete. Fast on purpose: it should read as being drawn, not as a wait.
export const DRAW_SECONDS = 0.9;

// Cumulative arc length per point, so a partial spiral can be cut at a
// fraction of its real length rather than of its point count (the round
// spiral has hundreds of points, the polygons a dozen corners).
const LENGTHS = {};
for (const [name, pts] of Object.entries(SHAPES)) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  LENGTHS[name] = acc;
}

// partial: the first `progress` (0..1) of the stroke by arc length, ending on
// an interpolated point so the pen tip moves smoothly instead of hopping
// corner to corner. Never shorter than a sliver: a zero-length table is a
// single parked dot, which is the one thing a scope tube should not be shown.
function partial(name, progress) {
  const pts = SHAPES[name];
  const acc = LENGTHS[name];
  const p = Math.min(1, Math.max(0.015, progress));
  if (p >= 1) return pts;
  const target = p * acc[acc.length - 1];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (acc[i] >= target) {
      const f = (target - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f });
      return out;
    }
    out.push(pts[i]);
  }
  return out;
}

// spiralStrokes: the spiral at time t, spun about its centre, as a single
// stroke in [-1, 1] x [-1, 1]. opts.progress (default 1) draws only that much
// of it, from the end the pen started.
export function spiralStrokes(name, t, opts = {}) {
  if (!SHAPES[name]) throw new Error(`unknown spiral: ${name}`);
  const pts = partial(name, opts.progress ?? 1);
  const a = -t * SPIN;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [pts.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))];
}
