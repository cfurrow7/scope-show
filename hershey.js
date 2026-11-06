// phone/hershey.js
//
// Single-stroke vector font for Text mode (Task 19): each glyph is a list of
// open polylines ("pen up" between them) in a shared design space, x roughly
// [0..10], y = [0..12] with baseline at y=0 and cap-height at y=12 (a few
// glyphs dip slightly below baseline: comma, Q's tail). This is the same
// "skeleton outline" idea as the classic public-domain Hershey Simplex face
// (single center-line strokes, no fill, meant to be traced by a pen/beam)
// and follows its general proportions, but the coordinates below are
// hand-authored for this file rather than a transcription of Hershey's
// original vertex table — there's no network access in this environment to
// pull the canonical table from, and retyping ~2000 numbers from memory
// risks silently-broken glyphs that only a visual check would catch. Curve
// glyphs (O, C, D, ...) are built from an elliptical-arc helper (arc, below)
// computed once at module load, so the file stays short and every curve is
// provably smooth rather than a long hand-typed point list.
//
// textToStrokes() (below) turns text into strokes in [-1, 1] x [-1, 1],
// ready for resampleStrokes() same as a finger drawing.

// P: turns a compact [x, y] tuple list into the {x, y} point-object shape
// strokes use everywhere else in this codebase (resampleStrokes etc).
const P = (pts) => pts.map(([x, y]) => ({ x, y }));

// arc: points along an elliptical arc centered at (cx, cy), sampled at
// `steps + 1` evenly-spaced angles from startDeg to endDeg (standard math
// convention: 0deg = +x, 90deg = +y/up; angles interpolate linearly so
// endDeg can be less than startDeg, or past 360 for a full loop that starts
// and ends at the same point, e.g. O's full ellipse or 6's bottom loop).
function arc(cx, cy, rx, ry, startDeg, endDeg, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const deg = startDeg + (endDeg - startDeg) * (i / steps);
    const rad = deg * Math.PI / 180;
    pts.push({ x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) });
  }
  return pts;
}

// FONT: char -> { strokes: [[{x,y},...], ...], w: advance width }.
// w is the glyph's own ink-ish width in design units; textToStrokes adds
// LETTER_SPACING between glyphs on top of it.
const FONT = {
  ' ': { strokes: [], w: 6 },

  // --- Letters ---------------------------------------------------------
  A: { strokes: [P([[0, 0], [4, 12], [8, 0]]), P([[2, 4], [6, 4]])], w: 8 },
  B: { strokes: [P([[0, 0], [0, 12]]), arc(0, 9, 5, 3, 90, -90, 10), arc(0, 3, 5, 3, 90, -90, 10)], w: 8 },
  C: { strokes: [arc(4, 6, 4, 6, 50, 310, 16)], w: 8 },
  D: { strokes: [P([[0, 0], [0, 12]]), arc(0, 6, 6, 6, 90, -90, 16)], w: 8 },
  E: { strokes: [P([[6, 12], [0, 12], [0, 0], [6, 0]]), P([[0, 6], [5, 6]])], w: 8 },
  F: { strokes: [P([[0, 0], [0, 12], [6, 12]]), P([[0, 6], [5, 6]])], w: 8 },
  G: { strokes: [arc(4, 6, 4, 6, 50, 310, 16), P([[7, 4], [7, 1.5], [4, 1.5]])], w: 8 },
  H: { strokes: [P([[0, 0], [0, 12]]), P([[8, 0], [8, 12]]), P([[0, 6], [8, 6]])], w: 8 },
  I: { strokes: [P([[3, 0], [3, 12]])], w: 6 },
  J: { strokes: [P([[5, 12], [5, 3], [4.5, 1], [3, 0], [1, 0.3], [0, 1.5]])], w: 6 },
  K: { strokes: [P([[0, 0], [0, 12]]), P([[7, 12], [0, 6], [7, 0]])], w: 8 },
  L: { strokes: [P([[0, 12], [0, 0], [6, 0]])], w: 7 },
  M: { strokes: [P([[0, 0], [0, 12], [5, 4], [10, 12], [10, 0]])], w: 10 },
  N: { strokes: [P([[0, 0], [0, 12], [8, 0], [8, 12]])], w: 8 },
  O: { strokes: [arc(4, 6, 4, 6, 0, 360, 20)], w: 8 },
  P: { strokes: [P([[0, 0], [0, 12]]), arc(0, 9, 6, 3, 90, -90, 12)], w: 8 },
  Q: { strokes: [arc(4, 6, 4, 6, 0, 360, 20), P([[4, 3], [8, -2]])], w: 8 },
  R: { strokes: [P([[0, 0], [0, 12]]), arc(0, 9, 6, 3, 90, -90, 12), P([[0, 6], [7, 0]])], w: 8 },
  S: { strokes: [P([[7, 10.5], [5, 12], [2, 11], [1, 9.5], [3, 7.5], [5, 6.5], [7, 5], [7, 2], [5, 0], [2, 0.3], [1, 1.5]])], w: 8 },
  T: { strokes: [P([[0, 12], [8, 12]]), P([[4, 12], [4, 0]])], w: 8 },
  U: { strokes: [[{ x: 0, y: 12 }, ...arc(4, 4, 4, 4, 180, 360, 12), { x: 8, y: 12 }]], w: 8 },
  V: { strokes: [P([[0, 12], [4, 0], [8, 12]])], w: 8 },
  W: { strokes: [P([[0, 12], [2.5, 0], [5, 8], [7.5, 0], [10, 12]])], w: 10 },
  X: { strokes: [P([[0, 12], [8, 0]]), P([[0, 0], [8, 12]])], w: 8 },
  Y: { strokes: [P([[0, 12], [4, 6], [8, 12]]), P([[4, 6], [4, 0]])], w: 8 },
  Z: { strokes: [P([[0, 12], [8, 12], [0, 0], [8, 0]])], w: 8 },

  // --- Digits ------------------------------------------------------------
  0: { strokes: [arc(4, 6, 3.5, 6, 0, 360, 20)], w: 8 },
  1: { strokes: [P([[1, 9], [3, 12], [3, 0]]), P([[1, 0], [5, 0]])], w: 6 },
  2: { strokes: [[...arc(4, 9, 3.5, 3, 200, -20, 10), { x: 0, y: 0 }, { x: 7, y: 0 }]], w: 8 },
  3: { strokes: [P([[1, 11], [4, 12], [6, 10], [6, 8], [4, 6.3], [2, 6]]), P([[2, 6], [4, 5.7], [6, 4], [6, 2], [4, 0.3], [1, 1]])], w: 8 },
  4: { strokes: [P([[5, 12], [0, 4], [7, 4]]), P([[5, 12], [5, 0]])], w: 8 },
  5: { strokes: [P([[7, 12], [1, 12], [1, 6.5]]), arc(1, 3.25, 3.75, 3.25, 90, -90, 10)], w: 8 },
  6: { strokes: [P([[6, 11], [4, 12], [2, 11], [1, 8], [1, 5]]), arc(4, 4, 3.5, 3.5, 149, 509, 16)], w: 8 },
  7: { strokes: [P([[0, 12], [8, 12], [2, 0]])], w: 8 },
  8: { strokes: [arc(4, 9, 3, 3, 0, 360, 12), arc(4, 3, 3.3, 3, 0, 360, 12)], w: 8 },
  9: { strokes: [arc(4, 8, 3.5, 3.5, 0, 360, 14), P([[6.8, 6], [7, 3], [5.5, 0.5], [3.5, 0]])], w: 8 },

  // --- Punctuation ---------------------------------------------------------
  '.': { strokes: [P([[2, 0], [2, 1]])], w: 4 },
  ',': { strokes: [P([[2, 1], [1, -1.5]])], w: 4 },
  '!': { strokes: [P([[2, 4], [2, 12]]), P([[2, 0], [2, 1]])], w: 4 },
  '?': { strokes: [P([[1, 10], [1, 11], [2, 12], [5, 12], [6, 11], [6, 9], [4, 7], [4, 5]]), P([[4, 0], [4, 1]])], w: 7 },
  "'": { strokes: [P([[2, 9], [2, 12]])], w: 4 },
  '-': { strokes: [P([[1, 6], [7, 6]])], w: 8 },
  '+': { strokes: [P([[1, 6], [7, 6]]), P([[4, 3], [4, 9]])], w: 8 },
  '=': { strokes: [P([[1, 4], [7, 4]]), P([[1, 8], [7, 8]])], w: 8 },
};

// SUPPORTED_CHARS: every char with a real (non-fallback) glyph, for UI
// hinting/validation. Numeric keys (digits) come back as strings via
// Object.keys.
export const SUPPORTED_CHARS = Object.keys(FONT).join('');

const SPACE = FONT[' '];
const LINE_HEIGHT = 12 * 1.6; // ~1.6em, em = cap-height (12)
const MARGIN = 0.9;

// AVG_WIDTH: mean stored width across every *drawable* glyph (space
// excluded — it gets its own fixed-fraction advance below), computed once
// at module load so BASE_SPACING/GAP/SPACE_ADVANCE all scale with the font
// as a whole rather than hand-picked constants.
const AVG_WIDTH = Object.values(FONT)
  .filter(g => g !== SPACE)
  .reduce((sum, g, _i, arr) => sum + g.w / arr.length, 0);

// BASE_SPACING: the normal letter-spacing added after every glyph's own
// stored width — this is what gives normal text its usual air between
// letters (glyph.w is deliberately snug to each glyph's ink, sometimes
// exactly equal to it, e.g. N/O/Q/U/M/W all end flush with their own
// width).
const BASE_SPACING = 2;

// GAP: a *safety-net* margin (~15-20% of the font's average glyph width),
// used only as a floor under BASE_SPACING (see glyphAdvance below) — for a
// glyph whose curves happen to reach further right than its nominal `w`
// was authored for (arc rounding, eyeballing error, etc.), trusting
// `w + BASE_SPACING` alone let that overshoot advance the pen less than
// the glyph's own ink needed, so the next glyph's strokes started inside
// the previous glyph's ink instead of after it.
const GAP = AVG_WIDTH * 0.18;

// SPACE_ADVANCE: fixed advance for the space glyph, and for any
// unsupported character (which falls back to it) — there is no ink to
// measure, so unlike every other glyph it does not use the max()-with-ink
// formula below. Sized as a fraction of the average glyph width so it
// reads as a normal word-gap regardless of exact font metrics.
const SPACE_ADVANCE = AVG_WIDTH * 0.6;

// glyphMaxX: the rightmost x any of glyph's stroke points reaches, in its
// own local (un-offset) design-space coordinates. 0 for glyphs with no
// strokes (the space glyph).
function glyphMaxX(glyph) {
  let max = 0;
  for (const stroke of glyph.strokes) {
    for (const pt of stroke) if (pt.x > max) max = pt.x;
  }
  return max;
}

// glyphAdvance: how far the pen moves after drawing `glyph`. The space
// glyph (ch === ' ', or any unsupported character falling back to it via
// `FONT[ch] || SPACE`) always advances by the fixed SPACE_ADVANCE. Every
// other glyph advances by whichever is larger: its normal stored-width
// advance (glyph.w + BASE_SPACING — what every glyph uses in the common
// case), or its *measured* ink extent plus GAP — so consecutive glyphs'
// stroke x-ranges are always disjoint by at least GAP, never trusting the
// stored width alone (see GAP's comment for why that trust broke down).
function glyphAdvance(glyph) {
  if (glyph === SPACE) return SPACE_ADVANCE;
  return Math.max(glyph.w + BASE_SPACING, glyphMaxX(glyph) + GAP);
}

// orderStrokesGreedily: reorders a line's strokes to reduce total connector
// ("beam-jump") travel — the shape-table preview/worklet path plays strokes
// back concatenated, so the gap between one stroke's last point and the
// next stroke's first point is a real jump the beam has to make (dimmed in
// the preview, but still travel). Left-to-right glyph/stroke authoring
// order is not distance-optimized at all (e.g. H's two vertical strokes
// end up separated by its crossbar instead of adjacent). This applies a
// simple nearest-neighbor greedy heuristic instead: starting from the
// first stroke, repeatedly pick whichever *remaining* stroke has an
// endpoint (start OR end — reversing a stroke draws the same ink, so the
// end is a valid attachment point too) closest to the current stroke's
// last point, reverse it if its end was the closer endpoint, and append it.
// Not globally optimal (that's the NP-hard open TSP path problem), but
// always at least as good as authoring order in practice, and cheap
// (O(strokes^2), and a line's stroke count is always small).
function orderStrokesGreedily(strokes) {
  if (strokes.length <= 1) return strokes;
  const remaining = strokes.slice(1);
  const ordered = [strokes[0]];
  while (remaining.length > 0) {
    const cur = ordered[ordered.length - 1];
    const end = cur[cur.length - 1];
    let bestIdx = 0, bestReversed = false, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const dStart = Math.hypot(s[0].x - end.x, s[0].y - end.y);
      const dEnd = Math.hypot(s[s.length - 1].x - end.x, s[s.length - 1].y - end.y);
      if (dStart < bestDist) { bestDist = dStart; bestIdx = i; bestReversed = false; }
      if (dEnd < bestDist) { bestDist = dEnd; bestIdx = i; bestReversed = true; }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    ordered.push(bestReversed ? chosen.slice().reverse() : chosen);
  }
  return ordered;
}

// textToStrokes: lays out `text` left-to-right (uppercased; unsupported
// chars fall back to the space glyph, still consuming their advance so
// layout doesn't collapse around them), supports '\n' for multiple lines
// (each line shifted down by LINE_HEIGHT, first line on top; stroke
// reordering — see orderStrokesGreedily — is scoped to within each line,
// never crossing a line break, so a caller partitioning the result by line
// still sees each line's own strokes as a contiguous block), then centers
// the whole block on (0,0) and uniformly scales it (preserving aspect) so
// its longest axis fits within [-MARGIN, MARGIN]. Returns [] if the text
// carries no ink at all (empty string, whitespace-only, or entirely
// unsupported characters).
//
// opts.reorder (default true) can be set false to keep each line's strokes
// in plain left-to-right authoring order — mainly for tests/tools that want
// to compare against the un-optimized baseline.
// opts.align (default 'left') controls how multiple lines sit relative to
// each other. Every line lays out from a pen at x = 0, so on its own the
// block is ragged-right: a short second line hangs off the left edge under a
// long first one. The block-centering at the end of this function centers the
// *whole* block, which does not fix that. 'center' centers each line on the
// block's axis instead, which is what stacked text normally wants.
//
// Default stays 'left' so the phone app's existing Text and Story slides keep
// laying out exactly as they were authored on the scope.
export function textToStrokes(text, opts = {}) {
  const lineHeight = opts.lineHeight ?? LINE_HEIGHT;
  const margin = opts.margin ?? MARGIN;
  const reorder = opts.reorder ?? true;
  const align = opts.align ?? 'left';

  const lines = String(text).toUpperCase().split('\n');
  const strokes = [];

  lines.forEach((line, li) => {
    let penX = 0;
    const lineY = -li * lineHeight;
    const lineStrokes = [];
    for (const ch of line) {
      const glyph = FONT[ch] || SPACE;
      for (const stroke of glyph.strokes) {
        lineStrokes.push(stroke.map(pt => ({ x: pt.x + penX, y: pt.y + lineY })));
      }
      penX += glyphAdvance(glyph);
    }
    // Center this line on x = 0 before it joins the block. Measured from the
    // line's actual ink rather than from penX, because penX includes the last
    // glyph's trailing advance and a trailing space, either of which would
    // pull the line visibly off-center.
    let placed = reorder ? orderStrokesGreedily(lineStrokes) : lineStrokes;
    if (align === 'center' && placed.length > 0) {
      let minX = Infinity, maxX = -Infinity;
      for (const stroke of placed) {
        for (const pt of stroke) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
        }
      }
      const shift = -(minX + maxX) / 2;
      placed = placed.map(stroke => stroke.map(pt => ({ x: pt.x + shift, y: pt.y })));
    }
    strokes.push(...placed);
  });

  if (strokes.length === 0) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    for (const pt of stroke) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  const scale = margin / Math.max(halfW, halfH, 1e-6);

  return strokes.map(stroke => stroke.map(pt => ({
    x: (pt.x - cx) * scale,
    y: (pt.y - cy) * scale,
  })));
}
