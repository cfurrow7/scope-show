// phone/wireframe.js
//
// Rotating 3D wireframe solids, emitted as the same multi-stroke polyline
// shape the font and the finger-draw path produce, so a solid can go through
// resampleStrokes() into an ordinary shape table. That matters more than it
// looks: a table can be point-lerped against another table (lerpShapes in
// lissajous-core.js), so text morphs INTO the cube rather than crossfading
// with it. A solid built out of oscillator parameters instead — the way the
// birthday card's figure slides are — can only ever dissolve, because the
// oscillator path and the table path are different synthesis routes and
// nothing can interpolate between them.
//
// Coordinates: right-handed, +x right, +y up, +z toward the viewer. Vertices
// are authored at roughly unit scale and the final fit-to-screen scale is
// computed once at module load (see FIT below), not per frame, so a spinning
// solid keeps a steady size instead of pumping as its bounding box changes.

// Each solid is vertices plus `paths`: vertex-index runs, one run per pen
// stroke. A run of three or more indices is a chain drawn without lifting the
// beam. Runs are chosen to cover every edge exactly once with as few pen-ups
// as possible, because a pen-up is a real beam jump on the scope and shows up
// as a faint streak across the middle of the shape.
//
// A cube cannot be drawn in one stroke at all: all eight corners have three
// edges each, and a path that never repeats an edge can only start and end at
// an odd corner, so eight odd corners force at least four separate strokes.
// Two square faces plus the four verticals is six, which is close enough and
// reads as a cube while it turns.
const CUBE = {
  vertices: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ],
  paths: [
    [0, 1, 2, 3, 0],
    [4, 5, 6, 7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ],
};

// The apex sits above a square base rather than at the centre of a bounding
// box, so the solid has an up and reads as standing on something. Both slanted
// pairs run through the apex in one stroke each, which covers all four slant
// edges with two pen-ups instead of four.
const PYRAMID = {
  vertices: [
    [-1, -0.8, -1], [1, -0.8, -1], [1, -0.8, 1], [-1, -0.8, 1],
    [0, 1.15, 0],
  ],
  paths: [
    [0, 1, 2, 3, 0],
    [0, 4, 2],
    [1, 4, 3],
  ],
};

export const SOLIDS = { cube: CUBE, pyramid: PYRAMID };

// Camera distance along +z. Small enough that the near face is visibly larger
// than the far one (which is what sells it as a solid rather than a flat
// hexagon) and large enough that a corner swinging toward the viewer does not
// balloon across the whole screen.
const DISTANCE = 4;
const MARGIN = 0.86;

export function rotate([x, y, z], ax, ay, az) {
  let cos = Math.cos(ax), sin = Math.sin(ax);
  let y1 = y * cos - z * sin, z1 = y * sin + z * cos;
  cos = Math.cos(ay); sin = Math.sin(ay);
  let x2 = x * cos + z1 * sin, z2 = -x * sin + z1 * cos;
  cos = Math.cos(az); sin = Math.sin(az);
  return [x2 * cos - y1 * sin, x2 * sin + y1 * cos, z2];
}

// project: rotate a vertex, then divide by depth. Returns unit-ish [x, y]
// before the fit scale is applied.
export function project(vertex, ax, ay, az = 0) {
  const [x, y, z] = rotate(vertex, ax, ay, az);
  const k = DISTANCE / (DISTANCE - z);
  return [x * k, y * k];
}

// fitScale: the largest projected radius the solid can reach in ANY
// orientation, sampled once over a full rotation grid. Scaling by
// MARGIN / that radius means no orientation can ever clip against the edge of
// the screen (or, on the scope, against the input's clamp), and — the reason
// it is computed here rather than per frame — that the size stays put as the
// solid turns. Normalising each frame to its own bounding box instead makes a
// cube visibly inflate every time it presents a corner.
function fitScale(solid) {
  const STEPS = 24;
  let maxR = 0;
  for (let i = 0; i < STEPS; i++) {
    for (let j = 0; j < STEPS; j++) {
      const ax = (i / STEPS) * Math.PI * 2;
      const ay = (j / STEPS) * Math.PI * 2;
      for (const v of solid.vertices) {
        const [px, py] = project(v, ax, ay);
        const r = Math.max(Math.abs(px), Math.abs(py));
        if (r > maxR) maxR = r;
      }
    }
  }
  return MARGIN / maxR;
}

const FIT = {
  cube: fitScale(CUBE),
  pyramid: fitScale(PYRAMID),
};

// solidAngles: where a solid is pointing at time t. A steady spin about the
// vertical axis with a slow tilt wobble laid over it, and the two rates are
// deliberately not a simple ratio so the tumble never settles into a loop the
// eye can predict. Exported so a caller can hold a solid still (pass its own
// angles) if it ever wants to.
export function solidAngles(t) {
  return { ax: 0.42 * Math.sin(t * 0.37), ay: t * 0.8 };
}

// wireframeStrokes: the solid at time t as strokes in [-1, 1] x [-1, 1],
// ready for resampleStrokes() exactly like textToStrokes() output. Straight
// edges need only their endpoints: resampleStrokes redistributes points along
// each stroke by arc length anyway, so adding intermediate vertices here would
// buy nothing.
export function wireframeStrokes(name, t, opts = {}) {
  const solid = SOLIDS[name];
  if (!solid) throw new Error(`unknown solid: ${name}`);
  const { ax, ay } = opts.angles ?? solidAngles(t);
  const az = opts.az ?? 0;
  const scale = FIT[name];
  const projected = solid.vertices.map(v => {
    const [px, py] = project(v, ax, ay, az);
    return { x: px * scale, y: py * scale };
  });
  return solid.paths.map(path => path.map(i => projected[i]));
}
