// phone/vector-fx.js
//
// Vector-display moves for stroke lists: write-on, 3D tilt with perspective,
// and the CRT power-on squash. All of them act on the strokes BEFORE they are
// resampled into a table, which is what makes them real on a scope: the table
// is the audio, so these are effects the beam actually performs, not a filter
// laid over a screen preview.
//
// Every transform here is rigid across the whole picture for a given instant.
// That is the difference from the instrument's swirl/tumble layers, which move
// each sample of the persistence window differently and so smear lettering.

const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export function strokesLength(strokes) {
  let total = 0;
  for (const s of strokes) for (let i = 1; i < s.length; i++) total += len(s[i - 1], s[i]);
  return total;
}

// writeOn: the first `progress` (0..1) of the picture by ink length, strokes
// taken in their drawing order, the last one cut on an interpolated point so
// the pen tip glides. Never shorter than `minFrac` of the total: an empty or
// zero-length table parks the beam on one bright dot, which a tube should not
// be shown.
export function writeOn(strokes, progress, minFrac = 0.015) {
  const p = Math.min(1, Math.max(minFrac, progress));
  if (p >= 1) return strokes;
  let left = p * strokesLength(strokes);
  const out = [];
  for (const s of strokes) {
    const cut = [s[0]];
    for (let i = 1; i < s.length; i++) {
      const d = len(s[i - 1], s[i]);
      if (d >= left) {
        const f = d > 0 ? left / d : 0;
        cut.push({ x: s[i - 1].x + (s[i].x - s[i - 1].x) * f, y: s[i - 1].y + (s[i].y - s[i - 1].y) * f });
        out.push(cut);
        return out;
      }
      left -= d;
      cut.push(s[i]);
    }
    out.push(cut);
  }
  return out;
}

// tilt: the flat picture turned in 3D (ax about the horizontal axis, ay about
// the vertical, az in-plane), then perspective-divided. Lines stay lines under
// perspective, so polygon strokes need no extra points. `scale` is applied
// after projection; callers pick it so the near edge never swings off the tube.
export function tilt(strokes, { ax = 0, ay = 0, az = 0, scale = 1, distance = 3.2 } = {}) {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  return strokes.map(s => s.map(({ x, y }) => {
    const x0 = x * cz - y * sz;
    const y0 = x * sz + y * cz;
    const y1 = y0 * cx;
    const z1 = y0 * sx;
    const x2 = x0 * cy + z1 * sy;
    const z2 = -x0 * sy + z1 * cy;
    const k = (distance / (distance - z2)) * scale;
    return { x: x2 * k, y: y1 * k };
  }));
}

// squash: vertical scale only, the CRT power-on/off. At k near 0 the picture
// is a single bright horizontal line, which is exactly what an old set does
// as it warms up or switches off.
export function squash(strokes, k) {
  return strokes.map(s => s.map(({ x, y }) => ({ x, y: y * k })));
}

// easeOut: fast start, soft landing. Used for anything that should feel like
// it snaps into place rather than slides.
export function easeOut(u) {
  const c = Math.min(1, Math.max(0, u));
  return 1 - (1 - c) ** 3;
}

// clip: cut strokes to the square |x|, |y| <= lim, splitting a stroke where
// it leaves and re-enters. Anything zoomed past the edge of the tube has to be
// removed rather than left to the input's clamp, which would pile it up into
// bright lines along the border.
export function clip(strokes, lim = 0.96) {
  const inside = p => Math.abs(p.x) <= lim && Math.abs(p.y) <= lim;
  const out = [];
  for (const s of strokes) {
    let cur = [];
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      if (i === 0) { if (inside(p)) cur.push(p); continue; }
      const seg = clipSegment(s[i - 1], p, lim);
      if (!seg) { if (cur.length > 1) out.push(cur); cur = []; continue; }
      const [a, b] = seg;
      if (cur.length === 0 || a !== s[i - 1]) {
        if (cur.length > 1) out.push(cur);
        cur = [a];
      }
      cur.push(b);
      if (b !== p) { out.push(cur); cur = []; }
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

// Liang-Barsky. Returns the visible part of segment a-b, reusing the original
// endpoint objects where they survive so the caller can tell a cut from a
// continuation.
function clipSegment(a, b, lim) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x + lim], [dx, lim - a.x], [-dy, a.y + lim], [dy, lim - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  const at = t => ({ x: a.x + dx * t, y: a.y + dy * t });
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}


// staticBurst: the outgoing table `a` blowing apart into static on its way to
// `b`. Points fly outward from the centre and pick up fresh random jitter
// every frame (the fuzz), spreading thinner and so dimmer as they go: on a
// tube, a beam spread over more area is literally fainter, so the spread IS
// the fade. A point that leaves the tube is gone, and the last stretch
// settles everything onto `b`.
// `out` is reused to avoid allocating per frame; `rand` is injectable for tests.
export function staticBurst(a, b, m, out, rand = Math.random) {
  const n = a.x.length;
  const e = m * m;
  const spread = 1 + 1.9 * e;
  // Two parts to the break-up: random fuzz (static), and a sine ripple that
  // runs along the trace and travels as the burst goes, which reads as the
  // signal warping rather than shattering. Fuzz was cut by a third and the
  // sine added at a third of the old fuzz, for a subtler, wavier burst.
  const fuzz = (0.015 + 0.32 * e) * 0.67;
  const sine = (0.015 + 0.32 * e) * 0.33;
  const phase = m * 18;
  const settle = m < 0.72 ? 0 : (m - 0.72) / 0.28;
  const w = settle * settle * (3 - 2 * settle);
  // A speck that flies off the tube is gone: it sits on the last speck still
  // on screen rather than jumping anywhere, because the beam draws a line to
  // wherever a point goes and a jump would streak across the burst.
  let lastX = a.x[0], lastY = a.y[0];
  for (let i = 0; i < n; i++) {
    const u = (i / n) * Math.PI * 2 * 7 + phase;
    let x = a.x[i] * spread + fuzz * (rand() * 2 - 1) + sine * Math.sin(u);
    let y = a.y[i] * spread + fuzz * (rand() * 2 - 1) + sine * Math.cos(u * 1.3);
    if (Math.abs(x) > 0.98 || Math.abs(y) > 0.98) { x = lastX; y = lastY; }
    else { lastX = x; lastY = y; }
    out.x[i] = x + (b.x[i] - x) * w;
    out.y[i] = y + (b.y[i] - y) * w;
  }
  return out;
}

// warpBlend: `a` reshaping into `b` through a vortex. The two are blended
// point for point (eased), and the in-between picture is twisted round the
// centre by an angle that peaks halfway and is strongest near the middle,
// with a slight bulge, so the outgoing page swirls down into the incoming one
// and unwinds as it lands. Zero twist at both ends, so it starts exactly on
// `a` and lands exactly on `b`.
export function warpBlend(a, b, m, out) {
  const n = a.x.length;
  const w = m * m * (3 - 2 * m);
  const peak = Math.sin(Math.PI * m);
  const twist = 2.6 * peak;
  const bulge = 1 + 0.18 * peak;
  for (let i = 0; i < n; i++) {
    const x = a.x[i] + (b.x[i] - a.x[i]) * w;
    const y = a.y[i] + (b.y[i] - a.y[i]) * w;
    const r = Math.hypot(x, y);
    const th = twist * Math.max(0, 1 - r / 1.2);
    const c = Math.cos(th), s = Math.sin(th);
    out.x[i] = Math.max(-1, Math.min(1, (x * c - y * s) * bulge));
    out.y[i] = Math.max(-1, Math.min(1, (x * s + y * c) * bulge));
  }
  return out;
}
