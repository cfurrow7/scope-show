// phone/sunset.js
//
// The 80s sunset: a sun sitting on the horizon, filled with horizontal lines
// that break into widening bands across its lower half, over a floor of
// stripes rushing toward the viewer. Both scroll, so the bands slide down the
// sun and the floor keeps coming.
//
// Drawn the way a scope has to draw a fill: as a hatch. The sun is ONE stroke,
// boustrophedon (left to right, then right to left), and each line joins the
// next by following the circle's edge, so the hops between lines become the
// sun's outline instead of beam-jump streaks. Across a band gap the edge keeps
// going, which is why the gaps read as cut out of a solid disc. The floor is a
// second stroke that hops between its stripes at the edges of the tube.

const SUN = { cy: 0.12, r: 0.62 };
const HORIZON = -0.3;
const FLOOR_BOTTOM = -0.9;
const HALF_WIDTH = 0.92;
const LINE_STEP = 0.032;   // hatch spacing inside the sun
const FLOOR_LINES = 7;
const BAND_SCROLL = 0.35;  // band cycles per second down the sun
const FLOOR_SCROLL = 0.28; // floor cycles per second toward the viewer

const halfChord = y => Math.sqrt(Math.max(0, SUN.r * SUN.r - (y - SUN.cy) ** 2));

// inGap: whether height y falls in one of the cut-out bands. Bands only cut
// the lower half, start thin near the middle and widen toward the horizon,
// and the whole pattern slides down over time.
function inGap(y, t) {
  const depth = (SUN.cy - y) / SUN.r;       // 0 at the middle, 1 at the bottom
  if (depth <= 0.05) return false;
  const phase = depth * 2.6 - t * BAND_SCROLL;
  const frac = phase - Math.floor(phase);
  return frac < 0.22 + 0.6 * depth;
}

// arc: points along the right or left edge of the sun from height y0 to y1,
// so the beam hugs the circle between two hatch lines.
function arc(side, y0, y1, out) {
  const steps = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 0.02));
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    out.push({ x: side * halfChord(y), y });
  }
}

function sunStroke(t) {
  const top = SUN.cy + SUN.r;
  const out = [{ x: 0, y: top }];
  let side = 1;        // which edge the beam is on: +1 right, -1 left
  let y = top;
  for (let ly = top - LINE_STEP; ly > HORIZON; ly -= LINE_STEP) {
    arc(side, y, ly, out);
    y = ly;
    if (inGap(ly, t)) continue;   // stay on the edge, skip the line
    out.push({ x: -side * halfChord(ly), y: ly });
    side = -side;
  }
  return out;
}

function floorStroke(t) {
  const ys = [];
  for (let i = 0; i < FLOOR_LINES; i++) {
    const u = (i / FLOOR_LINES + t * FLOOR_SCROLL) % 1;
    // Squared spacing: tight at the horizon, opening up toward the viewer.
    ys.push(HORIZON - (HORIZON - FLOOR_BOTTOM) * u * u);
  }
  ys.push(HORIZON);
  ys.sort((a, b) => b - a);
  const out = [];
  let side = -1;
  for (const y of ys) {
    out.push({ x: side * HALF_WIDTH, y }, { x: -side * HALF_WIDTH, y });
    side = -side;
  }
  return out;
}

// sunsetStrokes: the scene at time t, sun first (top down), then the floor,
// which is the order writeOn() traces it in.
export function sunsetStrokes(t) {
  return [sunStroke(t), floorStroke(t)];
}
