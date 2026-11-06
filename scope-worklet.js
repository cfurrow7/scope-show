import { synthesizeXY, synthesizeShapeXY, PARAM_KEYS } from './lissajous-core.js';

class ScopeSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0;
    this.params = {
      baseFreqHz: 300, ratio: 1, phase: Math.PI / 2, amp: 0.8,
      squareness: 0, drift: 0, driftFreqHz: 0.5, beatEnv: 0, beatTarget: 0,
      swirl: 0, tumble: 0, zoom: 0, traceFreqHz: 150,
      // Echo (Task 16): feedback amount (0-0.85) and per-tap delay in
      // seconds. Both plain continuous params — smoothed like everything
      // else below, no special-casing needed (unlike beatTarget).
      echo: 0, echoTime: 0.02,
      // Story mode (Task 20): 0..1 crossfade toward storyPair.b. NOT
      // smoothed like echo/echoTime above (see the process() loop below,
      // review I1) — app.js already streams a continuous per-frame linear
      // ramp for this, so one-pole smoothing it too just adds lag.
      storyMix: 0,
    };
    this.smoothed = { ...this.params };
    // Drawn-shape wavetable (Task 13): { x: Float32Array, y: Float32Array },
    // set via a 'shape' port message. Phase for the shape lookup is derived
    // from this.t * traceFreqHz inside synthesizeShapeXY (Task 16), so there
    // is no separate shapePhase accumulator to track here anymore.
    this.shape = null;
    // A new table waits here until the beam finishes its current lap. Swapped
    // mid-lap, the tube shows half of one table and half of the next, and at
    // 30 table updates a second that tear is a constant visible glitch on a
    // real scope (the canvas preview never shows it).
    this.pendingShape = undefined;
    this.lap = 0;
    // Story mode pair (Task 20): { a, b } shape tables set via a 'storyPair'
    // port message; while set, takes priority over this.shape (app.js never
    // sends both at once, but preferring storyPair keeps the process() loop
    // unambiguous). { type: 'storyPair', clear: true } clears it, falling
    // back to this.shape or the oscillator exactly as before Story mode.
    this.storyPair = null;
    // Help panel diagnostic (Task 21): iOS can hand the worklet a mono
    // output even though app.js asked for outputChannelCount [2], which
    // silently makes the scope draw a 45-degree line instead of a figure
    // (right falls back to left below). Report the real count up so the
    // Help panel can show it; there is no console on the phone.
    this.reportedChannels = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'params') {
        for (const key of PARAM_KEYS) {
          if (key in e.data.value) this.params[key] = e.data.value[key];
        }
      } else if (e.data.type === 'shape') {
        const next = e.data.clear ? null : { x: e.data.x, y: e.data.y };
        if (this.shape) this.pendingShape = next;
        else this.shape = next;
      } else if (e.data.type === 'storyPair') {
        this.storyPair = e.data.clear ? null : { a: e.data.a, b: e.data.b };
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    if (out.length !== this.reportedChannels) {
      this.reportedChannels = out.length;
      this.port.postMessage({ type: 'channels', count: out.length, sampleRate });
    }
    const dt = 1 / sampleRate;
    // One-pole smoothing per block start avoids zipper noise on param jumps
    // while keeping per-sample cost at plain synthesis. beatTarget is a
    // discrete selector (0/1/2) — smoothing it would produce nonsense
    // mid-values (e.g. half-size-half-morph), so it's copied straight
    // through instead of eased.
    //
    // storyMix (review I1) is copied straight through too, for a different
    // reason: app.js already streams a continuous per-frame linear ramp for
    // it (0 through the hold, 0->1 across MORPH_SECONDS) and resets it to 0
    // in the same tick it swaps the storyPair, so it needs no smoothing of
    // its own — easing it here on top just adds lag. Left smoothed, the
    // eased value would still sit near 1 (fully morphed to the old "b")
    // right after a pair swap reset the target to 0 for the new pair,
    // producing a brief reverse-morph flash in audio while it caught up;
    // the preview already renders storyMix raw (no smoothing), so this
    // makes the worklet match it exactly.
    for (const key of PARAM_KEYS) {
      if (key === 'beatTarget' || key === 'storyMix') {
        this.smoothed[key] = this.params[key];
        continue;
      }
      this.smoothed[key] += (this.params[key] - this.smoothed[key]) * 0.2;
    }
    for (let i = 0; i < left.length; i++) {
      let x, y;
      if (this.storyPair) {
        [x, y] = synthesizeShapeXY(this.t, this.storyPair.a, this.smoothed, this.t,
          this.storyPair.b, this.smoothed.storyMix);
      } else if (this.shape) {
        const lap = Math.floor(this.t * this.smoothed.traceFreqHz);
        if (lap !== this.lap && this.pendingShape !== undefined) {
          this.shape = this.pendingShape;
          this.pendingShape = undefined;
        }
        this.lap = lap;
        if (!this.shape) { left[i] = 0; right[i] = 0; this.t += dt; continue; }
        [x, y] = synthesizeShapeXY(this.t, this.shape, this.smoothed, this.t);
      } else {
        [x, y] = synthesizeXY(this.t, this.smoothed);
      }
      left[i] = x;
      right[i] = y;
      this.t += dt;
    }
    return true;
  }
}

registerProcessor('scope-synth', ScopeSynth);
