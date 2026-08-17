"use client";

/* ═══════════════════════════════════════════════════════════════════════════
   Browser audio plumbing for voice mode: mic capture in, PCM playback out.

   Two AudioWorkletProcessors do the real-time work (public/pcm-recorder-
   processor.js, public/pcm-player-processor.js); this module owns the two
   AudioContexts, wires the worklets into the graph, and does the format
   conversion (Float32 ↔ PCM16 ↔ base64) at the edges.

   Echo gating lives here, not in the caller: `onMicFrame` only fires while
   the player is NOT producing audio, plus a short drain tail afterwards.
   That is a deliberately simple half-duplex strategy — no ML voice-activity
   model, no barge-in detection — traded for not needing to ship and tune one.
   See GeminiLiveClient.ts for the fuller reasoning.
   ═══════════════════════════════════════════════════════════════════════════ */

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
/** How long after the assistant stops sounding before the mic resumes
    sending real audio. Covers the room/speaker's own reverberant tail. */
const ECHO_DRAIN_TAIL_MS = 400;

export interface VoiceAudioHandle {
  /** Fires with a base64 PCM16@16kHz frame — already muted during playback. */
  onMicFrame: (cb: (base64: string) => void) => void;
  /** True while the assistant's audio is actually sounding (post-priming). */
  isSpeaking: () => boolean;
  /** Queue a base64 PCM16@24kHz chunk from Gemini for playback. */
  playChunk: (base64: string) => void;
  /** Mark the current turn's audio as fully delivered (enables hot restart
      priming and lets the level watcher tell a natural drain from underrun). */
  markTurnEnded: () => void;
  /** Instantly clear anything queued for playback (used on session stop). */
  clearPlayback: () => void;
  /** Releases the mic, disconnects the graph, closes both AudioContexts. */
  stop: () => void;
}

function resamplePCM16(oldSamples: Int16Array, oldSR: number, newSR: number): Int16Array {
  if (oldSR === newSR) return oldSamples;
  const ratio = oldSR / newSR;
  const out = new Int16Array(Math.round(oldSamples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const idx = i * ratio;
    const low = Math.floor(idx);
    const high = Math.min(low + 1, oldSamples.length - 1);
    const w = idx - low;
    out[i] = Math.round(oldSamples[low] * (1 - w) + oldSamples[high] * w);
  }
  return out;
}

function float32ToPCM16Base64(frame: Float32Array): string {
  const pcm = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToPCM16(base64: string): Int16Array {
  const bin = atob(base64);
  const out = new Int16Array(bin.length / 2);
  for (let i = 0; i < bin.length; i += 2) {
    out[i / 2] = (bin.charCodeAt(i + 1) << 8) | bin.charCodeAt(i);
  }
  return out;
}

/** Requests the mic and stands up the full playback + capture graph. Must be
    called from within a user gesture (the mic button's click handler) — a
    bare page-load getUserMedia call is rejected by every major browser. */
export async function startVoiceAudio(): Promise<VoiceAudioHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
  const outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  if (outputCtx.state === "suspended") await outputCtx.resume().catch(() => {});
  if (inputCtx.state === "suspended") await inputCtx.resume().catch(() => {});

  await outputCtx.audioWorklet.addModule("/pcm-player-processor.js");
  await inputCtx.audioWorklet.addModule("/pcm-recorder-processor.js");

  const playerNode = new AudioWorkletNode(outputCtx, "pcm-player", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  playerNode.connect(outputCtx.destination);

  const recorderNode = new AudioWorkletNode(inputCtx, "pcm-recorder", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const sourceNode = inputCtx.createMediaStreamSource(stream);
  const silentSink = inputCtx.createGain();
  silentSink.gain.value = 0;
  sourceNode.connect(recorderNode);
  // Keeps the worklet actively pulled by the graph without ever reaching the
  // speakers — see the comment in pcm-recorder-processor.js.
  recorderNode.connect(silentSink).connect(inputCtx.destination);

  let speaking = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let micFrameCb: ((b64: string) => void) | null = null;

  playerNode.port.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg?.type !== "level") return;
    if (msg.isPlaying && !speaking) {
      speaking = true;
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
    } else if (!msg.isPlaying && speaking) {
      // Don't flip to "not speaking" the instant the buffer empties — give
      // the room's own echo tail time to die down before the mic resumes.
      if (!drainTimer) {
        drainTimer = setTimeout(() => {
          speaking = false;
          drainTimer = null;
        }, ECHO_DRAIN_TAIL_MS);
      }
    }
  };

  recorderNode.port.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg?.type !== "frame" || !micFrameCb) return;
    if (speaking) return; // half-duplex: drop mic frames while the assistant talks
    const frame = new Float32Array(msg.data);
    micFrameCb(float32ToPCM16Base64(frame));
  };

  return {
    onMicFrame(cb) {
      micFrameCb = cb;
    },
    isSpeaking() {
      return speaking;
    },
    playChunk(base64) {
      const pcm = base64ToPCM16(base64);
      // Gemini sends a handful of near-empty header chunks per turn.
      if (pcm.length < 4) return;
      const resampled = resamplePCM16(pcm, OUTPUT_SAMPLE_RATE, outputCtx.sampleRate);
      const buf = resampled.buffer.slice(0);
      playerNode.port.postMessage({ type: "pcm", data: buf }, [buf]);
    },
    markTurnEnded() {
      playerNode.port.postMessage({ type: "turn_ended" });
    },
    clearPlayback() {
      playerNode.port.postMessage({ type: "clear" });
    },
    stop() {
      for (const track of stream.getTracks()) track.stop();
      try {
        sourceNode.disconnect();
        recorderNode.disconnect();
        silentSink.disconnect();
        playerNode.disconnect();
      } catch {
        /* already torn down */
      }
      if (drainTimer) clearTimeout(drainTimer);
      inputCtx.close().catch(() => {});
      outputCtx.close().catch(() => {});
    },
  };
}
