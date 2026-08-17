// Output PCM player AudioWorkletProcessor.
// Runs in the audio rendering thread; immune to main-thread jank.
//
// Holds a ring buffer of Float32 samples at the context's sample rate (the
// parent context runs at 24 kHz, matching Gemini Live's output rate).
//
// Dual-mode jitter buffer:
//   COLD priming (350 ms): After a stop/clear. Absorbs Gemini's bursty
//       recovery delivery so we don't play a near-empty buffer.
//   HOT priming (80 ms): After a natural end-of-turn drain. The next
//       response starts with minimal latency — no perceptible gap.
//
// Message protocol from the main thread:
//   { type: 'pcm', data: ArrayBuffer (Int16 little-endian samples) }
//   { type: 'stop' }        — fade out over ~25 ms then clear buffer
//   { type: 'clear' }       — instant clear, no fade
//   { type: 'turn_ended' }  — mark that the current turn is done (buffer
//                              will drain naturally; don't report underrun)
//
// Periodically posts back:
//   { type: 'level', bufferedMs: number, isPlaying: boolean, priming: boolean }
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ring buffer sized to hold a full response. Gemini Live streams audio
    // far faster than real time, so a small buffer overflows mid-stream and
    // drops samples — heard as choppy gaps inside a sentence.
    this.bufferSize = Math.round(sampleRate * 60);
    this.buffer = new Float32Array(this.bufferSize);
    this.readIdx = 0;
    this.writeIdx = 0;
    this.fillCount = 0;

    this.coldPrebufferSamples = Math.round(sampleRate * 0.8);
    this.hotPrebufferSamples = Math.round(sampleRate * 0.6);
    this.underrunPrebufferSamples = Math.round(sampleRate * 0.25);

    this.prebufferSamples = this.coldPrebufferSamples;
    this.priming = true;

    this.turnEnded = false;
    this.wasPlaying = false;

    this.fadeOut = false;
    this.fadeFrames = 0;
    this.maxFadeFrames = Math.round(sampleRate * 0.025);

    this.framesSinceLastReport = 0;

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === "pcm" && msg.data) {
        const i16 = new Int16Array(msg.data);
        for (let i = 0; i < i16.length; i++) {
          if (this.fillCount >= this.bufferSize) break;
          this.buffer[this.writeIdx] = i16[i] / 32768;
          this.writeIdx = (this.writeIdx + 1) % this.bufferSize;
          this.fillCount++;
        }
        this.fadeOut = false;
        this.fadeFrames = 0;
        this.turnEnded = false;
      } else if (msg.type === "stop") {
        if (this.fillCount > 0 && !this.priming) {
          this.fadeOut = true;
          this.fadeFrames = 0;
        } else {
          this.readIdx = 0;
          this.writeIdx = 0;
          this.fillCount = 0;
          this.priming = true;
          this.prebufferSamples = this.coldPrebufferSamples;
        }
        this.turnEnded = false;
      } else if (msg.type === "clear") {
        this.readIdx = 0;
        this.writeIdx = 0;
        this.fillCount = 0;
        this.fadeOut = false;
        this.fadeFrames = 0;
        this.priming = true;
        this.prebufferSamples = this.coldPrebufferSamples;
        this.turnEnded = false;
      } else if (msg.type === "turn_ended") {
        this.turnEnded = true;
        this.port.postMessage({ type: "turn_ended_ack" });
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;

    if (this.priming && this.fillCount >= this.prebufferSamples) {
      this.priming = false;
      this.wasPlaying = true;
    }

    for (let i = 0; i < out.length; i++) {
      if (this.priming || this.fillCount === 0) {
        out[i] = 0;
        if (this.fillCount === 0 && !this.priming && this.wasPlaying) {
          this.priming = true;
          this.wasPlaying = false;
          if (this.turnEnded) {
            this.prebufferSamples = this.hotPrebufferSamples;
          } else {
            this.prebufferSamples = this.underrunPrebufferSamples;
          }
        }
        continue;
      }

      let sample = this.buffer[this.readIdx];
      if (this.fadeOut) {
        const t = this.fadeFrames / this.maxFadeFrames;
        if (t >= 1) {
          this.fillCount = 0;
          this.readIdx = 0;
          this.writeIdx = 0;
          this.fadeOut = false;
          this.priming = true;
          this.prebufferSamples = this.coldPrebufferSamples;
          this.wasPlaying = false;
          sample = 0;
        } else {
          sample *= 1 - t;
          this.fadeFrames++;
        }
      }
      out[i] = sample;
      this.readIdx = (this.readIdx + 1) % this.bufferSize;
      this.fillCount--;
    }

    this.framesSinceLastReport += out.length;
    if (this.framesSinceLastReport >= Math.round(sampleRate * 0.05)) {
      this.framesSinceLastReport = 0;
      const bufferedMs = (this.fillCount / sampleRate) * 1000;
      this.port.postMessage({
        type: "level",
        bufferedMs,
        isPlaying: !this.priming && this.fillCount > 0,
        priming: this.priming,
      });
    }

    return true;
  }
}

registerProcessor("pcm-player", PCMPlayerProcessor);
