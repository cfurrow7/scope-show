// phone/mic-react.js
// Mic capture + band energy + onset detection. Same detector shape as the
// bench prototype: low-band energy flux vs 1.5x running average, 250ms
// cooldown, BPM = median of last 6 inter-onset intervals.

export function createMicReactor({ onOnset, onLevels, onEnded }) {
  let ctx = null, analyser = null, stream = null, freqData = null;
  let avgEnergy = 0, lastOnsetMs = 0, intervals = [], bpm = null;
  let starting = false;

  function stopInternal() {
    stream?.getTracks().forEach(t => t.stop());
    ctx?.close();
    ctx = analyser = stream = freqData = null;
    bpm = null;
  }

  return {
    get active() { return !!analyser; },
    get bpm() { return bpm; },

    async start() {
      // Guards a double-tap during the permission prompt: without this, a
      // second tap before getUserMedia resolves starts a second capture and
      // leaks the first MediaStream (iOS orange dot stays on after stop()).
      if (starting || analyser) return;
      starting = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0;
        src.connect(analyser);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        avgEnergy = 0; intervals = []; bpm = null; lastOnsetMs = 0;
        // Device loss (e.g. Bluetooth mic disconnects, AirPods swap) ends
        // the track without ever calling stop(); tear down and let the
        // caller update its UI.
        const track = stream.getTracks()[0];
        if (track) {
          track.onended = () => { stopInternal(); onEnded?.(); };
        }
      } finally {
        starting = false;
      }
    },

    stop() { stopInternal(); },

    poll(nowMs) {
      if (!analyser) return;
      analyser.getByteFrequencyData(freqData);
      const binHz = ctx.sampleRate / analyser.fftSize;
      const band = (lo, hi) => {
        const a = Math.max(1, Math.round(lo / binHz));
        const b = Math.min(freqData.length - 1, Math.round(hi / binHz));
        let e = 0;
        for (let i = a; i <= b; i++) e += freqData[i] * freqData[i];
        return e / (b - a + 1);
      };
      const bassE = band(40, 150);
      const highE = band(4000, 10000);
      onLevels({ bass: Math.min(1, bassE / 8000), high: Math.min(1, highE / 6000) });

      const threshold = avgEnergy * 1.5 + 400;
      avgEnergy = avgEnergy * 0.95 + bassE * 0.05;
      if (bassE > threshold && nowMs - lastOnsetMs > 250) {
        if (lastOnsetMs > 0) {
          const interval = (nowMs - lastOnsetMs) / 1000;
          if (interval > 0.25 && interval < 2) {
            intervals.push(interval);
            if (intervals.length > 6) intervals.shift();
            const sorted = [...intervals].sort((x, y) => x - y);
            bpm = Math.round(60 / sorted[Math.floor(sorted.length / 2)]);
          }
        }
        lastOnsetMs = nowMs;
        onOnset(nowMs);
      }
    },
  };
}
