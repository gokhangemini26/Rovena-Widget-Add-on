// Input PCM recorder AudioWorkletProcessor.
//
// Runs on the audio rendering thread, reads the mic's native 128-sample
// quantum, and batches it into ~20ms frames before handing off to the main
// thread — one postMessage per quantum would be ~125/s for no benefit.
//
// Deliberately does NOT do speech detection. The widget relies on Gemini
// Live's own server-side automatic activity detection for turn-taking, and
// the main thread gates whether a frame is forwarded at all (muted while the
// assistant is speaking, to avoid feeding its own voice back in as an echo —
// see src/lib/voice/audio.ts). This processor's only job is: mic in, batched
// Float32 frames out.
class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = Math.round(sampleRate * 0.02); // ~20ms
    this.buffer = new Float32Array(this.frameSize);
    this.writeIdx = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    // Silent output, always: this node exists to READ the mic, not to route
    // it anywhere audible. It is kept connected to destination through a
    // zero-gain node purely to stop the browser from pausing an unconnected
    // worklet — the silence here is a second, independent guarantee against
    // ever hearing the customer's own mic played back.
    const out = outputs[0] && outputs[0][0];
    if (out) out.fill(0);
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this.buffer[this.writeIdx++] = input[i];
      if (this.writeIdx >= this.frameSize) {
        const chunk = this.buffer.slice(0);
        this.port.postMessage({ type: "frame", data: chunk.buffer }, [chunk.buffer]);
        this.writeIdx = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-recorder", PCMRecorderProcessor);
