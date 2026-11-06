// show.js — a message paged out on an oscilloscope, one line at a time, with
// a rotating wireframe solid turning between the lines.
//
// Same engine as the phone instrument (../phone), stripped to a looping
// player: no controls over the shape, no gestures, just pages. Sibling to
// ../card, and the difference between them is worth stating, because it is
// what makes the solids work here:
//
//   The card has two kinds of slide, a stroke table (text) and a set of
//   oscillator parameters (a figure), drawn by two different synthesis paths.
//   Nothing can interpolate between those paths, so a card transition into or
//   out of a figure is a crossfade: two traces overlapping at half brightness.
//
//   Here EVERY page is a stroke table, including the solids, which are
//   rebuilt from ../phone/wireframe.js each frame as they turn. One path, so
//   every transition is a real point-lerp and the letters fly into the cube
//   and out the other side.
//
// lissajous-core.js / hershey.js / mic-react.js / scope-worklet.js /
// wireframe.js / pages.js are copies owned by ../phone — see sync-shared.sh.

import { synthesizeShapeXY, resampleStrokes, lerpShapes } from './lissajous-core.js';
import { textToStrokes } from './hershey.js';
import { wireframeStrokes } from './wireframe.js';
import { spiralStrokes, SPIRALS, DRAW_SECONDS } from './spirals.js';
import { writeOn, tilt, squash, easeOut, clip, staticBurst, warpBlend } from './vector-fx.js';
import { HENRY } from './henry.js';
import { RETRO_LOGO } from './retrospects.js';
import { sunsetStrokes } from './sunset.js';
import { mirrorBallStrokes } from './mirrorball.js';
import { waveStrokes } from './wave.js';
import { movement, moveTable } from './movement.js';
import { paginate, unsupportedChars, retroStyle, setRetroStyle } from './pages.js';
import { parseShowLink, buildShowLink, clampTiming, tapTempo, MAX_MESSAGE } from './show-link.js';
import { createMicReactor } from './mic-react.js';

// --- The message -------------------------------------------------------------
//
// One line per page. Blank lines are ignored, so they can be used to group the
// list however it reads best. The font is capitals only and has no glyph for
// brackets or ampersands; anything it cannot draw is reported in the console
// rather than silently coming out as a gap.
const MESSAGE = `
Tonight
Gabba Hey
Jims
Retrospects
Dan Druff
Double Judy
`;

// The link carries the message and the pacing, so one deploy serves any number
// of shows and tuning one is not a redeploy. Reading and writing it lives in
// show-link.js, where it can be tested without a browser.
const N = 1024;                // samples per shape table, matches the instrument
const SOLID_FPS = 60;          // how often a turning solid is rebuilt (screen rate)
const POST_FPS = 30;           // how often a new table is sent to the audio

const tuning = parseShowLink(location.hash, MESSAGE);
let message = tuning.message;
let pages = paginate(message, { hold: tuning.hold, solidHold: tuning.solidHold });

// rebuildPages: the page list is derived from the message and the two hold
// times, so every edit goes through here rather than patching pages in place.
// The play position is kept where it is when it still exists, so nudging a
// slider does not throw the show back to the first line.
function rebuildPages() {
  pages = paginate(message, { hold: tuning.hold, solidHold: tuning.solidHold });
  if (pageIndex >= pages.length) {
    pageIndex = 0;
    mix = 0;
    phase = 'hold';
    phaseStart = simT;
  }
}

// Baseline params. Nothing here is exposed; the pages and the mic are the only
// things that move them. Motion (drift, swirl, tumble) stays at zero on
// purpose: those layers displace each sample of the persistence window
// differently, which weaves a figure into a lattice but shears lettering into
// a smear. A solid gets its motion from being rebuilt as it turns instead.
const BASE = {
  baseFreqHz: 300, ratio: 1, phase: Math.PI / 2, amp: 0.86, squareness: 0,
  drift: 0, driftFreqHz: 0.5, beatEnv: 0, beatTarget: 0,
  swirl: 0, tumble: 0, zoom: 0, traceFreqHz: 150,
  echo: 0, echoTime: 0.02, storyMix: 0,
};

// --- Tables ------------------------------------------------------------------
//
// A text page is the same table forever, so it is built once and kept. A solid
// is a different table every time it is asked for, so it is rebuilt on the
// SOLID_FPS clock and cached only until the next tick — rebuilding it at the
// frame rate would be honest too, just wasted work between ticks.

// --- The look ----------------------------------------------------------------
//
// An 80s vector-display grammar, all of it done to the strokes before they
// become a table, so the scope performs it rather than just the screen:
//
//   Every line of text WRITES ON, the beam tracing the letters in order, and
//   then holds flat and face-on. Names do not swing in 3D: a tilting title
//   card reads as a template.
//   Spirals fly in from deep in the tube as they trace on, then tumble.
//   The first page POWERS ON like an old set (a bright horizontal line that
//   snaps open), and the loop ends by switching off into that same line.
//
// The morph into a page lands on that page's starting state (a pen sliver, or
// the power-on line), so pages hand over by collapsing to where the next one
// begins and drawing out from there.

const TEXT_WRITE = 1.1;     // seconds to write a line, capped at 40% of its hold
const POWER_ON = 0.32;      // seconds for the opening line to snap open
const TEXT_FIT = 0.9;
const SPIRAL_FIT = 0.86;
const SPIRAL_FAR = 0.22;    // spiral scale at the start of its fly-in

const textStrokeCache = new Map();

function baseText(text) {
  if (!textStrokeCache.has(text)) textStrokeCache.set(text, textToStrokes(text, { align: 'center' }));
  return textStrokeCache.get(text);
}

const tempoRate = () => state.bpm / MOTION_REF_BPM;

// Warp transitions twist the outgoing page straight into the next one whole,
// so in that mode nothing draws on: every page is complete from its first
// moment, including while it is being warped into.
const drawsOn = () => tuning.fx !== 'warp';
const onProgress = (entering, local, dur) => (!drawsOn() ? 1 : entering ? 0 : local / dur);

function textStrokes(page, index, local, entering) {
  const base = baseText(page.text);
  const u = entering ? 0 : local;
  let strokes;
  // Coming out of the square's dive, the line is already whole and still
  // flying at the viewer: it arrives oversized (clipped at the tube's edge)
  // and settles, so the dive reads as one continuous move into the name.
  const prev = pages[(index - 1 + pages.length) % pages.length];
  if (prev?.kind === 'solid' && DIVERS.has(prev.solid) && index !== 0) {
    const settle = 1 + 1.6 * (1 - easeOut(u / 0.7));
    return clip(tilt(base, { scale: TEXT_FIT * settle }));
  }
  if (index === 0) {
    strokes = squash(base, !drawsOn() ? 1 : entering ? 0.015 : Math.max(0.015, easeOut(u / POWER_ON)));
  } else {
    strokes = writeOn(base, onProgress(entering, u, Math.min(TEXT_WRITE, page.hold * 0.4)));
  }
  return tilt(strokes, { scale: TEXT_FIT });
}

// The square spiral is the Retrospects cover: it outlines itself, winds in,
// and then the camera dives through it, the outer laps blowing past the edge
// of the tube, still diving while the next page forms out of it. It holds its
// tumble down so the squares stay squares.
const DIVE = 0.8;           // seconds of dive before the morph starts
const DIVE_DEPTH = 6;       // how far in it gets: scale multiplier at the end

function spiralPageStrokes(page, t, local, entering) {
  // A spiral keeps winding for its whole page and reaches the centre just as
  // the page ends: it goes all the way in, then hands over. The square, which
  // dives, finishes before its dive starts.
  const windFor = page.solid === 'square' ? Math.max(DRAW_SECONDS, page.hold - DIVE) : page.hold;
  const progress = onProgress(entering, local, windFor);
  const zoom = SPIRAL_FAR + (1 - SPIRAL_FAR) * easeOut(progress);
  const square = page.solid === 'square';
  const diveU = square && !entering ? Math.max(0, (local - (page.hold - DIVE)) / (DIVE + tuning.morph)) : 0;
  const dive = 1 + DIVE_DEPTH * diveU * diveU;
  const wobble = square ? 0.35 : 1;
  const strokes = tilt(spiralStrokes(page.solid, t, { progress }), {
    ax: wobble * 0.5 * Math.sin(t * 0.61),
    ay: wobble * 0.45 * Math.sin(t * 0.43 + 1.1),
    scale: SPIRAL_FIT * zoom * dive,
  });
  return dive > 1 ? clip(strokes) : strokes;
}

// Traced artwork. Each draws on longest-line-first; `swing` hangs it in 3D
// afterwards like a line of text, `dive` gives it the square's dive into the
// next page.
const DRAWINGS = {
  henry: { strokes: HENRY, draw: 2.2, swing: true },
  // The logo's swooshes take most of its width, so fitting the whole thing
  // leaves the lettering tiny next to the other names. Centre on the
  // lettering (shift) and scale up so the letters match, letting the
  // trailing swoosh run off the edge (clipped, not clamped).
  retrospects: { strokes: RETRO_LOGO, draw: 1.6, fit: 1.45, shift: [0.28, -0.02] },
};
const DIVERS = new Set(['square']);

function drawingStrokes(page, local, entering) {
  const d = DRAWINGS[page.solid];
  const u = entering ? 0 : local;
  const drawn = writeOn(d.strokes, onProgress(entering, u, Math.min(d.draw, page.hold * 0.7)));
  if (d.dive) {
    const diveU = entering ? 0 : Math.max(0, (local - (page.hold - DIVE)) / (DIVE + tuning.morph));
    const dive = 1 + DIVE_DEPTH * diveU * diveU;
    const out = tilt(drawn, { scale: 0.98 * dive });
    return dive > 1 ? clip(out) : out;
  }
  if (d.fit) {
    const [sx, sy] = d.shift ?? [0, 0];
    return clip(tilt(drawn.map(st => st.map(p => ({ x: p.x + sx, y: p.y + sy }))), { scale: d.fit }));
  }
  const swing = d.swing ? Math.min(1, Math.max(0, (u - d.draw) / 1.2)) : 0;
  return tilt(drawn, { ay: 0.3 * swing * Math.sin((u - d.draw) * 0.9 * tempoRate()), scale: 0.98 });
}

// The sunset is a scene, not an object, so it does not tumble: it traces on
// (sun top-down, then the floor) and its bands and stripes do the moving.
const SUN_DRAW = 1.4;

function sunsetPageStrokes(page, t, local, entering) {
  const progress = onProgress(entering, local, Math.min(SUN_DRAW, page.hold * 0.6));
  return writeOn(sunsetStrokes(t), progress);
}

function pageStrokes(page, index, t, local, entering) {
  if (page.kind === 'text') return textStrokes(page, index, local, entering);
  if (page.solid === 'sun') return sunsetPageStrokes(page, t, local, entering);
  if (page.solid === 'wave') {
    const progress = onProgress(entering, local, Math.min(SUN_DRAW, page.hold * 0.6));
    return writeOn(waveStrokes(t), progress);
  }
  if (page.solid === 'mirrorball') {
    const progress = onProgress(entering, local, Math.min(SUN_DRAW, page.hold * 0.6));
    return writeOn(mirrorBallStrokes(t), progress);
  }
  if (DRAWINGS[page.solid]) return drawingStrokes(page, local, entering);
  if (SPIRALS.includes(page.solid)) return spiralPageStrokes(page, t, local, entering);
  return wireframeStrokes(page.solid, t);
}

// Every page now moves, so each one is rebuilt on the SOLID_FPS clock and
// cached only until the next tick.
const tableCache = new Map();

function tableFor(index, t, local, entering) {
  const tick = Math.floor(simT * SOLID_FPS);
  const key = `${index}:${entering ? 'in' : 'on'}`;
  const hit = tableCache.get(key);
  if (hit && hit.tick === tick && hit.page === pages[index]) return hit.table;
  const tq = t;
  const table = resampleStrokes(pageStrokes(pages[index], index, tq, local, entering), N);
  tableCache.set(key, { tick, page: pages[index], table });
  return table;
}

// blend: the page-to-page morph. Point-lerp at matching table phase, which is
// what makes a line of text collapse into a cube rather than fade behind one.
// Both inputs are length N, so the phases line up one for one.
const blendX = new Float32Array(N);
const blendY = new Float32Array(N);
const blended = { x: blendX, y: blendY };
const moved = { x: new Float32Array(N), y: new Float32Array(N) };

function blend(a, b, m) {
  for (let i = 0; i < N; i++) {
    const [x, y] = lerpShapes(a, b, m, i / N);
    blendX[i] = x;
    blendY[i] = y;
  }
  return blended;
}

// --- Live state --------------------------------------------------------------

const state = {
  bpm: tuning.bpm, lastBeatAt: -10, beat: 0.35,
  bassBoost: 0, shimmer: 0, reactive: false,
};

let simT = 0;
// The motion clock: spins, tumbles, scrolling stripes and swings run on this,
// and it runs at bpm / 96 of real time, so tapping a tempo speeds the whole
// show's movement up or down with the music. Integrated rather than computed
// as simT * rate, so changing the tempo never makes anything jump.
const MOTION_REF_BPM = 96;
let motionT = 0;
let lastFrame = performance.now();
let pageIndex = 0;
let mix = 0;     // 0..1 morph into the next page
let phase = 'hold';
let phaseStart = 0;

function params() {
  const period = 60 / state.bpm;
  const beatEnv = state.beat * Math.exp(-6 * (simT - state.lastBeatAt) / period);
  return {
    ...BASE,
    traceFreqHz: tuning.rate,
    amp: BASE.amp * (1 + 0.22 * state.bassBoost),
    squareness: Math.min(1, BASE.squareness + state.shimmer),
    beatEnv,
  };
}

function advance() {
  const elapsed = simT - phaseStart;
  if (phase === 'hold') {
    mix = 0;
    if (elapsed >= pages[pageIndex].hold) {
      phase = 'morph';
      phaseStart = simT;
    }
  } else {
    mix = Math.min(1, elapsed / tuning.morph);
    if (elapsed >= tuning.morph) {
      pageIndex = (pageIndex + 1) % pages.length;
      mix = 0;
      phase = 'hold';
      phaseStart = simT;
    }
  }
}

// currentTable: what is on the tube this instant, morph included. The worklet
// is handed this same table, so the sound is never a frame behind the picture
// and cannot be showing a different page from the screen.
function currentTable() {
  // Page-local time, quantised to the rebuild clock and kept running through
  // the morph out, so anything moving keeps moving while it collapses.
  const elapsed = simT - phaseStart;
  const raw = phase === 'hold' ? elapsed : pages[pageIndex].hold + elapsed;
  const local = Math.floor(raw * SOLID_FPS) / SOLID_FPS;
  const a = tableFor(pageIndex, motionT, local, false);
  if (mix === 0) return a;
  const b = tableFor((pageIndex + 1) % pages.length, motionT, 0, true);
  // A dive owns its own exit (the next page flies out of it), so static only
  // replaces the plain morph.
  const page = pages[pageIndex];
  const diving = page.kind === 'solid' && DIVERS.has(page.solid);
  if (tuning.fx === 'static' && !diving) return staticBurst(a, b, mix, blended);
  if (tuning.fx === 'warp' && !diving) return warpBlend(a, b, mix, blended);
  return blend(a, b, mix);
}

// --- Audio -------------------------------------------------------------------

let audioCtx = null;
let workletNode = null;
let outputGain = null;
let toneOn = false;
let channelCount = 0;
let audioRate = 0;

// The table only has to reach the worklet when it actually changes: a text
// page holding still is one message, a turning solid is SOLID_FPS of them.
// Posting every frame regardless would copy 8 KB of Float32Array 60 times a
// second to say nothing new.
let lastPosted = null;
let lastPostedAt = -1;

function pushTable(table, live) {
  if (!workletNode) return;
  if (!live && table === lastPosted) return;
  if (live && simT - lastPostedAt < 1 / POST_FPS) return;
  workletNode.port.postMessage({ type: 'shape', x: table.x, y: table.y });
  lastPosted = table;
  lastPostedAt = simT;
}

async function startTone() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    await audioCtx.audioWorklet.addModule('scope-worklet.js');
    workletNode = new AudioWorkletNode(audioCtx, 'scope-synth', { outputChannelCount: [2] });
    outputGain = audioCtx.createGain();
    outputGain.gain.value = 0;
    workletNode.connect(outputGain);
    outputGain.connect(audioCtx.destination);
    // iOS can hand back a mono output despite outputChannelCount [2], and the
    // worklet's fallback then copies X into both channels. On screen that is
    // invisible; on a scope it is a 45-degree diagonal line that looks exactly
    // like a wiring fault, so the page has to say so out loud.
    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'channels') {
        channelCount = e.data.count;
        audioRate = e.data.sampleRate;
        updateMonoWarning();
      }
    };
    lastPosted = null;
  }
  if (audioCtx.state !== 'running') await audioCtx.resume();
  toneOn = true;
  // Short ramp instead of a hard gate: a raw XY signal switched on at full
  // amplitude clicks hard.
  outputGain.gain.cancelScheduledValues(audioCtx.currentTime);
  outputGain.gain.setValueAtTime(outputGain.gain.value, audioCtx.currentTime);
  outputGain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.35);
}

function stopTone() {
  toneOn = false;
  if (!outputGain) return;
  outputGain.gain.cancelScheduledValues(audioCtx.currentTime);
  outputGain.gain.setValueAtTime(outputGain.gain.value, audioCtx.currentTime);
  outputGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.25);
}

function updateMonoWarning() {
  const el = document.getElementById('mono-warn');
  const readout = document.getElementById('audio-readout');
  if (!el) return;
  const mono = channelCount === 1;
  el.hidden = !mono;
  if (readout) {
    readout.textContent = channelCount
      ? `${audioRate} Hz, ${channelCount} channel${channelCount === 1 ? '' : 's'}`
      : 'not started';
    readout.classList.toggle('bad', mono);
  }
}

// --- Mic ---------------------------------------------------------------------

const mic = createMicReactor({
  onOnset: () => { state.lastBeatAt = simT; },
  onLevels: ({ bass, high }) => {
    state.bassBoost = bass;
    state.shimmer = high * 0.22;
  },
  onEnded: () => setListening(false),
});

async function setListening(on) {
  if (on) {
    try {
      await mic.start();
    } catch {
      // Permission refused or no input device. The show still runs silently,
      // so say so on the button rather than throwing up an error dialog.
      listenBtn.textContent = 'No mic access';
      listenBtn.classList.remove('active');
      state.reactive = false;
      return;
    }
    state.reactive = true;
  } else {
    mic.stop();
    state.reactive = false;
    state.bassBoost = 0;
    state.shimmer = 0;
  }
  listenBtn.textContent = state.reactive ? 'Mic on' : 'Turn on mic';
  // Switching into record mode is what collapses the output to mono, and the
  // worklet reports it a beat later, so re-check shortly after the toggle.
  setTimeout(updateMonoWarning, 400);
  listenBtn.classList.toggle('active', state.reactive);
}

// --- Render ------------------------------------------------------------------

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const overlay = document.getElementById('open-overlay');
const toneBtn = document.getElementById('tone-btn');
const listenBtn = document.getElementById('listen-btn');
const aboutBtn = document.getElementById('about-btn');
const about = document.getElementById('about');
const bar = document.getElementById('bar');

const SAMPLES = 1600;
const PERSISTENCE_SECONDS = 0.8;   // simulated phosphor trail
const JUMP_THRESHOLD = 0.12;       // beam-jump between strokes, drawn dim
const JUMP_ALPHA = 0.22;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);

function geometry() {
  const w = innerWidth;
  const h = innerHeight;
  // Measured, not hardcoded, and measured again every frame: the button bar
  // wraps to two rows on a narrow phone, and an open panel takes most of the
  // screen. Whatever is covering the bottom right now is what the picture has
  // to sit above, or tuning the timing means tuning something you cannot see.
  let bottom = bar.getBoundingClientRect().height || 84;
  for (const panel of [tune, about]) {
    if (!panel.hidden) bottom = Math.max(bottom, panel.getBoundingClientRect().height);
  }
  const cy = (h - bottom) / 2;
  const r = Math.min(w, h - bottom) * 0.40;
  return { w, h, cy, r };
}

// jumpThreshold: what counts as a beam jump for THIS table. A fixed distance
// cannot work: resampling spreads every table over the same point count, so
// the step along a stroke shrinks as the picture gets shorter, and a fixed
// 0.12 waved through the short hops between letters as solid baseline ink.
// That ink is not on the real tube, where a one-sample hop is too fast to
// glow. A hop several times the typical step is a jump.
const jumpCache = new WeakMap();
function jumpThreshold(table) {
  if (jumpCache.has(table) && table !== blended && table !== moved) return jumpCache.get(table);
  const steps = [];
  for (let i = 1; i < table.x.length; i += 3) {
    steps.push(Math.hypot(table.x[i] - table.x[i - 1], table.y[i] - table.y[i - 1]));
  }
  steps.sort((a, b) => a - b);
  const t = Math.min(JUMP_THRESHOLD, Math.max(0.012, steps[steps.length >> 1] * 3.5));
  jumpCache.set(table, t);
  return t;
}

// drawTable: one lap of the table, which draws the page exactly once. The
// stroke boundaries inside it (letter to letter, edge to edge) are real beam
// jumps on hardware and are drawn as faint streaks here so the screen shows
// what the tube would.
function drawTable(table, p, w, cy, r) {
  const path = new Path2D();
  // All the jumps go into one path and are stroked once. Stroked one by one,
  // each paid its own glow blur, and a static burst (hundreds of jumps) put
  // 700+ blurred strokes in a single frame: the stutter at every transition.
  const jumps = new Path2D();
  let prevX = 0, prevY = 0, prevPx = 0, prevPy = 0;
  const windowSeconds = 1 / p.traceFreqHz;
  const jump = jumpThreshold(table);

  for (let i = 0; i <= SAMPLES; i++) {
    const frac = i / SAMPLES;
    const tt = frac * windowSeconds;
    const tSlow = simT - (1 - frac) * PERSISTENCE_SECONDS;
    const [x, y] = synthesizeShapeXY(tt, table, p, tSlow);
    const px = w / 2 + x * r;
    const py = cy - y * r;

    if (i === 0) {
      path.moveTo(px, py);
    } else if (Math.hypot(x - prevX, y - prevY) > jump) {
      jumps.moveTo(prevPx, prevPy);
      jumps.lineTo(px, py);
      path.moveTo(px, py);
    } else {
      path.lineTo(px, py);
    }
    prevX = x; prevY = y; prevPx = px; prevPy = py;
  }
  ctx.save();
  ctx.globalAlpha *= JUMP_ALPHA;
  ctx.stroke(jumps);
  ctx.restore();
  ctx.stroke(path);
}

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  simT += dt;
  motionT += dt * state.bpm / MOTION_REF_BPM;

  mic.poll(now);
  if (state.reactive && mic.bpm) state.bpm = Math.min(240, Math.max(30, mic.bpm));
  if (!state.reactive && simT - state.lastBeatAt >= 60 / state.bpm) state.lastBeatAt = simT;

  advance();

  // Movement preset: computed once per frame and applied to the table before
  // it goes to the audio, so the scope moves exactly as the screen does.
  const mv = movement(tuning.move, tuning.intensity / 100, {
    beats: motionT * MOTION_REF_BPM / 60,
    t: simT,
  });
  state.beat = mv.beat;
  const p = params();
  const still = currentTable();
  const table = mv.dx || mv.dy || mv.scale !== 1 ? moveTable(still, mv, moved) : still;
  // A morph, or a page that is a turning solid, changes the table every frame;
  // a text page holding still does not.
  // Every page is in motion now, so the table always counts as live.
  pushTable(table, true);
  if (toneOn) workletNode?.port.postMessage({ type: 'params', value: p });

  const { w, h, cy, r } = geometry();
  ctx.fillStyle = '#030f09';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#6cffb3';
  ctx.shadowColor = '#6cffb3';
  // Transitions draw in the thinnest line: it thins almost at once when a
  // page starts to go, and widens back over the first moment of the next
  // page. Same shapes, finer trace, which is far easier on the eyes than a
  // full-weight burst.
  const into = phase === 'morph' ? Math.min(1, mix / 0.12) : Math.max(0, 1 - (simT - phaseStart) / 0.3);
  const thin = into * into * (3 - 2 * into);
  ctx.lineWidth = 1.6 - 1.0 * thin;
  ctx.shadowBlur = 8 - 6 * thin;
  ctx.globalAlpha = mv.alpha;
  drawTable(table, p, w, cy, r);
  ctx.globalAlpha = 1;

  requestAnimationFrame(frame);
}

// --- Wiring ------------------------------------------------------------------

document.getElementById('open-btn').addEventListener('click', async () => {
  overlay.hidden = true;
  stage.hidden = false;
  resize();
  phaseStart = simT;
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  // The opening tap is a user gesture, which is the one reliable moment to
  // build the AudioContext. Built silent; "Hear it" only ramps the gain up.
  try {
    await startTone();
    stopTone();
  } catch { /* no audio available; the show still runs on screen */ }
});

toneBtn.addEventListener('click', async () => {
  if (toneOn) {
    stopTone();
  } else {
    try { await startTone(); } catch { return; }
  }
  toneBtn.textContent = toneOn ? 'Mute it' : 'Hear it';
  toneBtn.classList.toggle('active', toneOn);
});

listenBtn.addEventListener('click', () => setListening(!state.reactive));

aboutBtn.addEventListener('click', () => {
  about.hidden = !about.hidden;
  aboutBtn.classList.toggle('active', !about.hidden);
  if (!about.hidden) showTune(false);
});

// --- Timing panel ------------------------------------------------------------
//
// Three numbers and the message, and the URL is where they live: every change
// is written back into the hash, so "Copy link" is just copying the address
// bar and there is no save step to forget. Opening a copied link restores
// exactly what the sender was looking at.

const tuneBtn = document.getElementById('tune-btn');
const tune = document.getElementById('tune');
const copyBtn = document.getElementById('copy-btn');
const msgInput = document.getElementById('msg-input');
const msgWarn = document.getElementById('msg-warn');

const SLIDERS = [
  { key: 'hold', input: document.getElementById('hold-slider'), out: document.getElementById('hold-out') },
  { key: 'solidHold', input: document.getElementById('solid-slider'), out: document.getElementById('solid-out') },
  { key: 'morph', input: document.getElementById('morph-slider'), out: document.getElementById('morph-out') },
];

function showTune(on) {
  tune.hidden = !on;
  tuneBtn.classList.toggle('active', on);
  if (on) {
    about.hidden = true;
    aboutBtn.classList.remove('active');
  }
}

function syncTuneUi() {
  for (const { key, input, out } of SLIDERS) {
    const value = tuning[key];
    input.value = value;
    out.textContent = `${value.toFixed(key === 'morph' ? 2 : 1)}s`;
  }
  msgInput.value = message.trim();
  const retro = retroStyle(message);
  retroRow.hidden = retro === null;
  if (retro) retroSelect.value = retro;
  const missing = unsupportedChars(message);
  msgWarn.hidden = missing.length === 0;
  msgWarn.textContent = missing.length
    ? `No glyph for ${missing.join(' ')} — the font is capitals, digits and . , ! ? ' - + = only, and anything else comes out as a gap.`
    : '';
}

// writeUrl: the hash is written with replaceState rather than by assigning
// location.hash, which would stack a history entry per slider nudge and leave
// the back button walking through every value the slider passed through.
function writeUrl() {
  history.replaceState(null, '', buildShowLink({ ...tuning, message }));
}

tuneBtn.addEventListener('click', () => showTune(tune.hidden));

for (const { key, input, out } of SLIDERS) {
  input.addEventListener('input', () => {
    const value = clampTiming(key, input.value);
    tuning[key] = value;
    out.textContent = `${value.toFixed(key === 'morph' ? 2 : 1)}s`;
    // A hold change has to reach the page list; a transition change does not,
    // since the morph clock reads tuning.morph directly every frame.
    if (key !== 'morph') rebuildPages();
  });
  // Dragging fires input continuously, so the URL is only rewritten once the
  // slider is let go.
  input.addEventListener('change', writeUrl);
}

function setMessage(next) {
  message = next;
  tuning.custom = true;
  pageIndex = 0;
  mix = 0;
  phase = 'hold';
  phaseStart = simT;
  rebuildPages();
  syncTuneUi();
  writeUrl();
}

msgInput.addEventListener('change', () => {
  const next = msgInput.value.slice(0, MAX_MESSAGE);
  if (!next.trim()) {
    syncTuneUi();
    return;
  }
  setMessage(next);
});

// Tap tempo: sets the BPM the beat pulse and all the motion run at. Taps go
// through tapTempo() so a pause starts a fresh count, and the BPM lands in the
// link once the tapping stops.
const tapBtn = document.getElementById('tap-btn');
const bpmOut = document.getElementById('bpm-out');
let taps = [];
let tapSave = 0;
const showBpm = () => { bpmOut.value = Math.round(state.bpm); };
// Typed tempo: same path as a tap, so the pulse, the motion and the link all
// follow. Applied on change (enter or leaving the box), clamped to 40-200.
bpmOut.addEventListener('change', () => {
  const bpm = clampTiming('bpm', bpmOut.value);
  state.bpm = bpm;
  tuning.bpm = bpm;
  state.lastBeatAt = simT;
  showBpm();
  writeUrl();
});
tapBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const now = performance.now();
  taps = taps.filter(t => now - t < 8000).concat(now);
  const bpm = tapTempo(taps);
  if (bpm) {
    state.bpm = bpm;
    tuning.bpm = bpm;
    state.lastBeatAt = simT;   // the tap IS the beat: land the pulse on it
    showBpm();
    clearTimeout(tapSave);
    tapSave = setTimeout(writeUrl, 1200);
  }
  tapBtn.classList.add('hit');
  setTimeout(() => tapBtn.classList.remove('hit'), 90);
});
showBpm();

// Retrospects: album art or plain text. Only shown when the message has them.
const moveSelect = document.getElementById('move-style');
const moveAmt = document.getElementById('move-amt');
const moveOut = document.getElementById('move-out');
moveSelect.value = tuning.move;
moveAmt.value = tuning.intensity;
moveOut.textContent = `${tuning.intensity}%`;
moveSelect.addEventListener('change', () => {
  tuning.move = moveSelect.value;
  writeUrl();
});
moveAmt.addEventListener('input', () => {
  tuning.intensity = Number(moveAmt.value);
  moveOut.textContent = `${tuning.intensity}%`;
});
moveAmt.addEventListener('change', writeUrl);

const rateSelect = document.getElementById('trace-rate');
rateSelect.value = String(tuning.rate);
if (rateSelect.value !== String(tuning.rate)) {
  rateSelect.add(new Option(`${tuning.rate} Hz`, String(tuning.rate)));
  rateSelect.value = String(tuning.rate);
}
rateSelect.addEventListener('change', () => {
  tuning.rate = clampTiming('rate', rateSelect.value);
  writeUrl();
});

const fxSelect = document.getElementById('fx-style');
fxSelect.value = tuning.fx;
fxSelect.addEventListener('change', () => {
  tuning.fx = fxSelect.value;
  writeUrl();
});

const retroRow = document.getElementById('retro-row');
const retroSelect = document.getElementById('retro-style');
retroSelect.addEventListener('change', () => {
  setMessage(setRetroStyle(message, retroSelect.value));
});

copyBtn.addEventListener('click', async () => {
  writeUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    copyBtn.textContent = 'Copied';
  } catch {
    // Clipboard access is refused outside a secure context, and on a plain
    // http LAN address that is most of the time. Select the URL instead so it
    // can still be copied by hand.
    copyBtn.textContent = 'Copy from the address bar';
  }
  setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2200);
});

syncTuneUi();

// The scope setup steps are shown in two places (the intro, and the ? panel
// once the intro is gone) and are authored once in a <template>, so the two
// cannot drift apart as the wording gets tweaked.
const scopeSteps = document.getElementById('scope-steps');
for (const mount of document.querySelectorAll('[data-scope-steps]')) {
  mount.append(scopeSteps.content.cloneNode(true));
}

resize();
