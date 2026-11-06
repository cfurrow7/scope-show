// phone/mirrorball.js
//
// A spinning mirror ball: the tile grid (latitude rings and longitude lines)
// of a sphere tilted slightly toward the viewer, its outline, the line it
// hangs from, and a few glints flashing off the facets. Only the front half
// of the grid is drawn, which is what makes it read as a solid ball rather
// than a wire cage. As it spins the longitude lines sweep across the face.

const R = 0.6;
const CY = -0.08;
const TILT = 0.38;          // radians the top leans toward the viewer
const RINGS = 9;            // latitude rings between the poles
const MERIDIANS = 14;
const SPIN = 0.55;          // radians per second (motion clock)
const STEP = Math.PI / 36;  // sampling along each grid line

// toScreen: a point on the unit sphere (lat, lon) after spin and tilt.
// Returns screen x, y and depth z (positive = facing the viewer).
function toScreen(lat, lon) {
  const x = Math.cos(lat) * Math.sin(lon);
  const y = Math.sin(lat);
  const z = Math.cos(lat) * Math.cos(lon);
  const c = Math.cos(TILT), s = Math.sin(TILT);
  return { x: x * R, y: (y * c - z * s) * R + CY, z: y * s + z * c };
}

// visibleRuns: sample a parametric grid line and keep only its front-facing
// runs, so a line that wraps round the back comes out as separate strokes.
function visibleRuns(sample, from, to) {
  const runs = [];
  let cur = [];
  for (let u = from; u <= to + 1e-9; u += STEP) {
    const p = sample(u);
    if (p.z > 0.02) cur.push({ x: p.x, y: p.y });
    else if (cur.length) { if (cur.length > 1) runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

export function mirrorBallStrokes(t) {
  const spin = t * SPIN;
  const strokes = [];

  // Hanging line, then the outline: the beam starts at the top of the tube.
  strokes.push([{ x: 0, y: 0.96 }, { x: 0, y: CY + R }]);
  const outline = [];
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI / 2 + (i / 48) * Math.PI * 2;
    outline.push({ x: R * Math.cos(a), y: CY + R * Math.sin(a) });
  }
  strokes.push(outline);

  // Latitude rings, top to bottom, alternating direction so each ring starts
  // near where the last one ended.
  for (let k = 1; k <= RINGS; k++) {
    const lat = Math.PI / 2 - (k * Math.PI) / (RINGS + 1);
    const runs = visibleRuns(lon => toScreen(lat, lon), -Math.PI, Math.PI);
    for (const run of runs) strokes.push(k % 2 ? run : run.reverse());
  }

  // Longitude lines, swept round by the spin.
  for (let m = 0; m < MERIDIANS; m++) {
    const lon = spin + (m * 2 * Math.PI) / MERIDIANS;
    const runs = visibleRuns(lat => toScreen(lat, lon), -Math.PI / 2, Math.PI / 2);
    for (const run of runs) strokes.push(m % 2 ? run : run.reverse());
  }

  // Glints: facets that catch the light flash as a small four-point star.
  // Each glint rides a facet round with the spin and pulses as it passes the
  // front, so they come and go rather than sitting still.
  for (const [lat0, lon0] of [[0.5, 0.3], [-0.2, 2.4], [0.15, 4.4], [-0.55, 1.2]]) {
    const p = toScreen(lat0, lon0 + spin);
    if (p.z < 0.45) continue;
    const size = 0.05 + 0.13 * (p.z - 0.45) / 0.55;
    strokes.push([{ x: p.x - size, y: p.y }, { x: p.x + size, y: p.y }]);
    strokes.push([{ x: p.x, y: p.y - size }, { x: p.x, y: p.y + size }]);
  }
  return strokes;
}
