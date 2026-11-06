// Pure Lissajous math. No DOM, no audio — imported by the preview canvas,
// the AudioWorklet, and (later) the video-synth generator module.
// Reference implementation: prototype/lissajous-bench.html.

const TAU = 2 * Math.PI;
const K_MAX = 12;

export function shapeWave(phase, squareness) {
  if (squareness < 0.001) return Math.sin(phase);
  const k = squareness * K_MAX;
  return Math.tanh(k * Math.sin(phase)) / Math.tanh(k);
}

export function triWave(phase) {
  const p = ((phase % TAU) + TAU) % TAU;
  const u = p / TAU;
  return u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
}

// beatEnvelope: legacy wrapped multiplier (1 + 0.35 * decaying beat pulse).
// Kept exported for compatibility; the streamed beatEnv param (Task 15) no
// longer goes through this — callers now stream the raw decaying value
// (beatAmount * exp(-6*since/period)) directly and apply the 1 + 0.35*
// wrapping (or the morph/spin alternatives) downstream, per beatTarget. See
// applyMotion/synthesizeXY below.
export function beatEnvelope(sinceSeconds, beatAmount, periodSeconds) {
  if (beatAmount <= 0) return 1;
  return 1 + beatAmount * 0.35 * Math.exp(-6 * sinceSeconds / periodSeconds);
}

// applyMotionRaw: same pipeline as applyMotion (below) minus the final
// clamp. Factored out so the echo sum (echoWrap, below synthesizeXY) can
// accumulate several unclamped taps and clamp only once, on the sum.
function applyMotionRaw(x, y, params, tSlow) {
  const dPhase = TAU * params.driftFreqHz * tSlow;
  const zoomScale = params.zoom > 0
    ? 1 - params.zoom * 0.4 * (0.5 + 0.5 * triWave(dPhase * 0.41))
    : 1;
  const beatEnv = params.beatEnv || 0;
  const beatTarget = params.beatTarget || 0;
  const beatSizeMul = beatTarget === 0 ? 1 + 0.35 * beatEnv : 1;
  const figureScale = (1 - 0.6 * params.drift) * beatSizeMul * zoomScale;
  const yOffset = params.amp * params.drift * 0.6 * triWave(dPhase);
  let xOut = x * params.amp * figureScale;
  let yOut = y * params.amp * figureScale;
  let swirlAng = params.swirl > 0 ? params.swirl * Math.PI * triWave(dPhase * 0.73) : 0;
  if (beatTarget === 2) swirlAng += beatEnv * (Math.PI / 2);
  if (swirlAng !== 0) {
    const cos = Math.cos(swirlAng), sin = Math.sin(swirlAng);
    const xr = xOut * cos - yOut * sin;
    const yr = xOut * sin + yOut * cos;
    xOut = xr;
    yOut = yr;
  }
  yOut += yOffset;
  return [xOut, yOut];
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

// applyMotion: shared modulation pipeline. Takes a raw unit-space point
// (raw oscillator output, or a resampled point off a drawn-shape wavetable)
// and applies amp/figureScale/zoomScale, swirl (+ beat spin) rotation, and
// the drift yOffset, then hard-clamps to [-1, 1] to mirror what a scope
// input does. tSlow drives the drift/swirl/zoom LFOs; see synthesizeXY below
// for why it is a separate argument from the oscillator time.
//
// beatTarget selects where the raw beatEnv value (0..1-ish, decaying) lands:
//   0 (size)  - figureScale *= 1 + 0.35 * beatEnv (the original behavior).
//   1 (morph) - handled in synthesizeXY (squareness bump), a no-op here.
//   2 (spin)  - rotate by beatEnv * (PI/2), added into the same rotation
//               step as swirl, so it applies even when swirl is 0.
// Targets 1 and 2 apply no size punch (beatSizeMul stays 1).
export function applyMotion(x, y, params, tSlow) {
  const [xOut, yOut] = applyMotionRaw(x, y, params, tSlow);
  return [clamp1(xOut), clamp1(yOut)];
}

// synthesizeRaw: the oscillator pipeline (dual shapeWave + applyMotionRaw)
// with the final clamp left off, so echoWrap (below) can sum several taps
// before clamping once. This is what synthesizeXY used to compute directly.
//
// beatTarget === 1 (morph) bumps squareness by beatEnv on both oscillator
// waves here (size/spin targets leave squareness untouched; handled in
// applyMotion instead). Note: shape-table (drawn) playback runs its own
// synthesizeShapeRaw (below) and never runs this squareness bump, so the
// morph target is a no-op for drawings — acceptable, since a drawn shape has
// no "squareness" concept to bump.
function synthesizeRaw(t, params, tSlow) {
  const dPhase = TAU * params.driftFreqHz * tSlow;
  const tumblePhase = params.tumble > 0 ? params.tumble * Math.PI * triWave(dPhase * 0.53) : 0;
  const squareness = params.beatTarget === 1
    ? Math.min(1, params.squareness + (params.beatEnv || 0))
    : params.squareness;
  const x = shapeWave(TAU * params.baseFreqHz * t, squareness);
  const y = shapeWave(TAU * params.baseFreqHz * params.ratio * t + params.phase + tumblePhase,
                      squareness);
  return applyMotionRaw(x, y, params, tSlow);
}

// echoWrap: turns a "raw" (t, tSlow) -> [x, y] pipeline into the echoed,
// clamped version (Task 16). Both the oscillator and shape-table signals are
// pure functions of (t, tSlow), so the echo is a finite weighted sum of the
// same pipeline evaluated at k*echoTime-earlier times — no delay-line state
// needed:
//
//   out(t) = ( Sum_{k=0..K} echo^k * raw(t - k*echoTime, tSlow - k*echoTime) )
//            * (1 - echo)
//
// K = 0 when echo <= 0.001 (echo effectively off — skips the loop and the
// (1 - echo) multiply entirely, so echo=0 is bit-identical to the pre-echo
// pipeline). Otherwise K = min(5, ceil(ln(0.02)/ln(echo))), i.e. enough taps
// for the geometric series to decay under 2% before the 6-tap cap. The
// (1 - echo) normalization keeps the summed worst-case amplitude bounded
// near the unechoed level; the hard clamp to [-1, 1] is applied once, on the
// final summed result, not per-tap.
function echoWrap(rawFn, t, params, tSlow) {
  const echo = params.echo || 0;
  if (echo <= 0.001) {
    const [x, y] = rawFn(t, tSlow);
    return [clamp1(x), clamp1(y)];
  }
  const echoTime = params.echoTime || 0;
  const K = Math.min(5, Math.ceil(Math.log(0.02) / Math.log(echo)));
  let sx = 0, sy = 0, mul = 1;
  for (let k = 0; k <= K; k++) {
    const [x, y] = rawFn(t - k * echoTime, tSlow - k * echoTime);
    sx += mul * x;
    sy += mul * y;
    mul *= echo;
  }
  sx *= (1 - echo);
  sy *= (1 - echo);
  return [clamp1(sx), clamp1(sy)];
}

// params: { baseFreqHz, ratio, phase, amp, squareness, drift, driftFreqHz,
//           beatEnv, beatTarget, swirl, tumble, zoom, echo, echoTime }
// t drives the oscillator phases; tSlow (defaults to t) drives the drift LFO
// separately so callers that resample a window of t at a different rate
// (e.g. a slowed-down preview) can still evolve drift in real time.
export function synthesizeXY(t, params, tSlow = t) {
  return echoWrap((tt, ts) => synthesizeRaw(tt, params, ts), t, params, tSlow);
}

// sampleShapeXY: linear-interpolated lookup into a drawn-shape wavetable
// ({ x: Float32Array, y: Float32Array }) at phase01, wrapped to [0, 1).
export function sampleShapeXY(shape, phase01) {
  const n = shape.x.length;
  const p = ((phase01 % 1) + 1) % 1;
  const idx = p * n;
  const i0 = Math.floor(idx) % n;
  const i1 = (i0 + 1) % n;
  const frac = idx - Math.floor(idx);
  const x = shape.x[i0] + (shape.x[i1] - shape.x[i0]) * frac;
  const y = shape.y[i0] + (shape.y[i1] - shape.y[i0]) * frac;
  return [x, y];
}

// lerpShapes (Task 20): point-lerp between two shape tables at the same
// table phase — the core of Story mode's slide-to-slide morph. Each table is
// sampled independently via sampleShapeXY (so a and b need not share a
// length), then the two looked-up points are lerped by m (0 = a, 1 = b).
// Both the worklet's storyPair playback and the preview's story render go
// through this (via synthesizeShapeXY's optional shapeB/mix args below) so
// they can never diverge.
export function lerpShapes(a, b, m, phase01) {
  const [ax, ay] = sampleShapeXY(a, phase01);
  const [bx, by] = sampleShapeXY(b, phase01);
  return [ax + (bx - ax) * m, ay + (by - ay) * m];
}

// synthesizeShapeRaw: shape-table counterpart to synthesizeRaw. Derives the
// table phase from t*traceFreqHz (the "retrace rate" of the drawn shape,
// same role baseFreqHz plays for the oscillator), looks up the point, and
// runs it through applyMotionRaw. Clamp left off for echoWrap.
//
// shapeB/mix (Task 20, optional): when shapeB is provided, the looked-up
// point is lerpShapes(shape, shapeB, mix, phase01) instead of a plain
// sampleShapeXY(shape, phase01) lookup — Story mode's morph between the
// current and next slide, sharing the exact same table-phase computation and
// downstream applyMotionRaw/echo/clamp pipeline a single confirmed shape
// uses, so lerped story frames render through the identical path (including
// the caller's beam-jump dimming, which just sees ordinary [x,y] samples).
function synthesizeShapeRaw(t, shape, params, tSlow, shapeB, mix) {
  const phase01 = t * params.traceFreqHz;
  const [rawX, rawY] = shapeB
    ? lerpShapes(shape, shapeB, mix, phase01)
    : sampleShapeXY(shape, phase01);
  return applyMotionRaw(rawX, rawY, params, tSlow);
}

// synthesizeShapeXY: the shape-table equivalent of synthesizeXY — table
// lookup + motion + echo sum + clamp, all in one call. The worklet's shape
// path and the preview's shape path both call this now (Task 16), replacing
// their previously separate hand-rolled lookup+applyMotion code. shapeB/mix
// (Task 20) are optional passthroughs to synthesizeShapeRaw for Story mode's
// two-table morph; omitted, behavior is identical to before Task 20.
export function synthesizeShapeXY(t, shape, params, tSlow = t, shapeB, mix) {
  return echoWrap((tt, ts) => synthesizeShapeRaw(tt, shape, params, ts, shapeB, mix), t, params, tSlow);
}

// resampleClosedPath: points is an array of {x, y} in [-1,1] space (arbitrary
// length >= 3). Closes the loop back to the first point, then resamples n
// points at uniform arc-length spacing (linear interp between input points),
// followed by one pass of wrapping 3-point moving-average smoothing.
export function resampleClosedPath(points, n) {
  const closed = points.concat([points[0]]);
  const cum = [0];
  for (let i = 1; i < closed.length; i++) {
    const dx = closed[i].x - closed[i - 1].x;
    const dy = closed[i].y - closed[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  if (total === 0) {
    xs.fill(points[0].x);
    ys.fill(points[0].y);
    return { x: xs, y: ys };
  }
  let seg = 1;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const segStart = cum[seg - 1], segEnd = cum[seg];
    const segLen = segEnd - segStart;
    const frac = segLen > 0 ? (target - segStart) / segLen : 0;
    const p0 = closed[seg - 1], p1 = closed[seg];
    xs[i] = p0.x + (p1.x - p0.x) * frac;
    ys[i] = p0.y + (p1.y - p0.y) * frac;
  }
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    sx[i] = (xs[prev] + xs[i] + xs[next]) / 3;
    sy[i] = (ys[prev] + ys[i] + ys[next]) / 3;
  }
  return { x: sx, y: sy };
}

// resampleOpenPolyline: like resampleClosedPath's arc-length resampling, but
// does NOT close the loop back to the first point. Samples span the full
// open arc length inclusive of both endpoints (i=0 lands exactly on
// points[0], i=count-1 exactly on points[points.length-1]).
function resampleOpenPolyline(points, count) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  if (total === 0) {
    xs.fill(points[0].x);
    ys.fill(points[0].y);
    return { x: xs, y: ys };
  }
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const target = count > 1 ? (i / (count - 1)) * total : 0;
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    const segStart = cum[seg - 1], segEnd = cum[seg];
    const segLen = segEnd - segStart;
    const frac = segLen > 0 ? (target - segStart) / segLen : 0;
    const p0 = points[seg - 1], p1 = points[seg];
    xs[i] = p0.x + (p1.x - p0.x) * frac;
    ys[i] = p0.y + (p1.y - p0.y) * frac;
  }
  return { x: xs, y: ys };
}

// smoothOpen: 3-point moving-average smoothing WITHOUT wrapping — endpoints
// are left untouched so a stroke's start/end don't smear into whatever
// comes before/after it once strokes are concatenated.
function smoothOpen(xs, ys) {
  const n = xs.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  if (n > 0) { sx[0] = xs[0]; sy[0] = ys[0]; }
  if (n > 1) { sx[n - 1] = xs[n - 1]; sy[n - 1] = ys[n - 1]; }
  for (let i = 1; i < n - 1; i++) {
    sx[i] = (xs[i - 1] + xs[i] + xs[i + 1]) / 3;
    sy[i] = (ys[i - 1] + ys[i] + ys[i + 1]) / 3;
  }
  return { x: sx, y: sy };
}

function arcLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

// resampleStrokes: strokes = array of point-arrays ({x,y} in [-1,1], each
// length >= 2), i.e. a multi-stroke drawing. Each stroke gets a sample count
// proportional to its own arc length (minimum `minPer` samples per stroke,
// total exactly n across all strokes via largest-remainder rounding),
// resampled as an OPEN polyline (resampleOpenPolyline, not
// resampleClosedPath — a stroke's own start/end are not connected to each
// other) and smoothed with smoothOpen (no wrap). Strokes are then
// concatenated in order; the jump from one stroke's last sample to the next
// stroke's first sample (and from the last stroke back to the first,
// closing the overall wavetable) is left as a raw beam-jump transition — no
// interpolated connector points — since that's what makes multi-stroke
// drawings render as separate strokes with a dim connector line on a real
// XY scope, rather than one continuous blob.
//
// Invariant: the returned arrays are ALWAYS exactly length n. minPer starts
// at 8, but with enough strokes 8 * strokes.length can exceed n (e.g. 129+
// strokes at n=1024); when that happens minPer is reduced to
// floor(n / strokes.length) (never below 2, since a stroke needs at least 2
// points to resample as a line). If even minPer=2 can't fit every stroke
// (more than n/2 strokes), the excess strokes are dropped — only the first
// floor(n/2) are kept — so 2 * strokes.length <= n always holds and the
// per-stroke counts can never overrun the output arrays.
export function resampleStrokes(strokes, n) {
  let minPer = 8;
  let m = strokes.length;
  let useStrokes = strokes;
  if (minPer * m > n) {
    minPer = Math.max(2, Math.floor(n / m));
    if (minPer * m > n) {
      // Still doesn't fit even at the 2-point floor: drop the excess
      // strokes so 2 * m <= n always holds.
      m = Math.floor(n / 2);
      useStrokes = strokes.slice(0, m);
      minPer = 2;
    }
  }
  const arcLens = useStrokes.map(arcLength);
  const totalLen = arcLens.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, n - minPer * m);
  const weights = totalLen > 0
    ? arcLens.map(l => l / totalLen)
    : arcLens.map(() => 1 / m);
  const rawExtra = weights.map(w => w * remaining);
  const floorExtra = rawExtra.map(Math.floor);
  const assigned = floorExtra.reduce((a, b) => a + b, 0);
  const leftover = remaining - assigned;
  const order = rawExtra
    .map((v, i) => ({ i, frac: v - floorExtra[i] }))
    .sort((a, b) => b.frac - a.frac);
  const extra = floorExtra.slice();
  for (let k = 0; k < leftover; k++) extra[order[k].i]++;
  const counts = extra.map(e => e + minPer);

  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let offset = 0;
  for (let i = 0; i < m; i++) {
    const resampled = resampleOpenPolyline(useStrokes[i], counts[i]);
    const smoothed = smoothOpen(resampled.x, resampled.y);
    xs.set(smoothed.x, offset);
    ys.set(smoothed.y, offset);
    offset += counts[i];
  }
  return { x: xs, y: ys };
}

// storyMix (Task 20): 0..1 crossfade position streamed during a Story mode
// transition (0 = holding on slide A, 1 = fully morphed to slide B). Smoothed
// like every other continuous param in the worklet's param loop.
export const PARAM_KEYS =['baseFreqHz', 'ratio', 'phase', 'amp', 'squareness', 'drift', 'driftFreqHz', 'beatEnv', 'beatTarget', 'swirl', 'tumble', 'zoom', 'traceFreqHz', 'echo', 'echoTime', 'storyMix'];

export const MACROS = [
  { name: 'Circle',   ratio: 1.0, phaseDeg: 90, squareness: 0, drift: 0 },
  { name: 'Square',   ratio: 1.0, phaseDeg: 0,  squareness: 1, drift: 0 },
  { name: 'Figure-8', ratio: 2.0, phaseDeg: 90, squareness: 0, drift: 0 },
  { name: 'Star',     ratio: 1.5, phaseDeg: 90, squareness: 1, drift: 0 },
  { name: 'Slinky',   ratio: 1.0, phaseDeg: 90, squareness: 0, drift: 0.65 },
  { name: 'Tunnel',   ratio: 1.0, phaseDeg: 90, squareness: 0, drift: 0, zoom: 0.8 },
  { name: 'Spiro',    ratio: 1.5, phaseDeg: 90, squareness: 1, drift: 0, swirl: 0.6 },
  { name: 'Tumble',   ratio: 1.0, phaseDeg: 90, squareness: 0, drift: 0, tumble: 0.8 },
];
