"use client";

import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";

export interface FunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiLiveConfig {
  model: string;
  apiKey?: string;
  token?: string;
  systemInstruction?: string;
  greetingPrompt?: string;
  onAudioChunk?: (pcmBytes: ArrayBuffer) => void;
  onTranscription?: (text: string, isUser: boolean) => void;
  onToolCall?: (calls: FunctionCall[]) => void;
  onTurnComplete?: () => void;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

const GREETING_PROMPT =
  "Open by saying, word for word: Merhaba, hoş geldiniz, size Kadın ya da Erkek reyonundan hangisi ile yardımcı olmamı istersiniz? " +
  "Do NOT mention any brand name at the opening. Use the formal 'siz' form, calm, courteous and professional.";

export class GeminiLiveSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private config: GeminiLiveConfig;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private playerNode: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private isConnected = false;
  private isSpeaking = false;
  private hasGreeted = false;

  constructor(config: GeminiLiveConfig) {
    this.config = config;
    const key = config.apiKey || config.token || "";
    this.ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: { apiVersion: "v1alpha" },
    });
  }

  async start() {
    try {
      // 1. Setup AudioContext (24 kHz for Gemini Live audio playback)
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      this.outputCtx = new AudioCtx({ sampleRate: 24000 });
      if (this.outputCtx.state === "suspended") {
        await this.outputCtx.resume();
      }

      // Add PCM player AudioWorklet
      try {
        await this.outputCtx.audioWorklet.addModule("/pcm-player-processor.js");
      } catch (err) {
        console.warn("[AudioWorklet module load]", err);
      }

      this.playerNode = new AudioWorkletNode(this.outputCtx, "pcm-player", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      this.playerNode.port.onmessage = (ev) => {
        const msg = ev.data;
        if (msg && msg.type === "level") {
          this.isSpeaking = msg.isPlaying;
        }
      };

      this.playerNode.connect(this.outputCtx.destination);

      // 2. Setup Mic Input Context (16 kHz)
      this.inputCtx = new AudioCtx({ sampleRate: 16000 });
      if (this.inputCtx.state === "suspended") {
        await this.inputCtx.resume();
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 3. Connect to Gemini Live WebSocket
      this.session = await this.ai.live.connect({
        model: this.config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede",
              },
            },
          },
          systemInstruction: this.config.systemInstruction
            ? { parts: [{ text: this.config.systemInstruction }] }
            : undefined,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "showProducts",
                  description: "Müşteriye ürün kartlarını gösterir. Bir kombin sunduğunda mutlaka çağır.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      skus: { type: Type.ARRAY, items: { type: Type.STRING } },
                      title: { type: Type.STRING },
                    },
                    required: ["skus"],
                  },
                },
                {
                  name: "addToCart",
                  description: "Ürünü müşterinin sepetine ekler.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      sku: { type: Type.STRING },
                      size: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                    },
                    required: ["sku"],
                  },
                },
                {
                  name: "show_on_model",
                  description: "Kombini manken üzerinde giydirir ve görselini oluşturur.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
              ],
            },
          ],
        },
        callbacks: {
          onopen: () => {
            this.isConnected = true;
            this.config.onOpen?.();
            this.startMicCapture();

            if (!this.hasGreeted) {
              this.hasGreeted = true;
              this.triggerGreeting(this.config.greetingPrompt || GREETING_PROMPT);
            }
          },
          onmessage: (msg: LiveServerMessage) => {
            this.handleServerMessage(msg);
          },
          onclose: () => {
            this.isConnected = false;
            this.config.onClose?.();
          },
          onerror: (err) => {
            console.error("[Gemini Live Error]", err);
            this.config.onError?.(err);
          },
        },
      });
    } catch (e) {
      console.error("[Gemini Live Start Failed]", e);
      this.config.onError?.(e);
      this.stop();
      throw e;
    }
  }

  private startMicCapture() {
    if (!this.inputCtx || !this.micStream) return;
    const source = this.inputCtx.createMediaStreamSource(this.micStream);
    const processor = this.inputCtx.createScriptProcessor(2048, 1, 1);
    this.micProcessor = processor;

    processor.onaudioprocess = (e) => {
      // Mute/drop mic audio while the AI is speaking to prevent self-interruption and stuttering!
      if (!this.isConnected || !this.session || this.isSpeaking) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      let binary = "";
      const bytes = new Uint8Array(pcm16.buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);

      this.session.sendRealtimeInput({
        audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
      });
    };

    source.connect(processor);
    processor.connect(this.inputCtx.destination);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleServerMessage(msg: any) {
    const parts = msg?.serverContent?.modelTurn?.parts;
    if (parts?.length) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          const b64 = part.inlineData.data;
          const binary = atob(b64);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          if (this.playerNode) {
            this.playerNode.port.postMessage({ type: "pcm", data: bytes.buffer }, [bytes.buffer]);
          }
        }
      }
    }

    if (msg?.serverContent?.interrupted) {
      if (this.playerNode) {
        this.playerNode.port.postMessage({ type: "stop" });
      }
    }

    const outT =
      msg?.serverContent?.outputTranscription?.text ||
      msg?.serverContent?.outputAudioTranscription?.text;
    if (outT) {
      this.config.onTranscription?.(outT, false);
    }

    const inT =
      msg?.serverContent?.inputTranscription?.text ||
      msg?.serverContent?.inputAudioTranscription?.text;
    if (inT) {
      this.config.onTranscription?.(inT, true);
    }

    if (msg?.toolCall?.functionCalls?.length) {
      this.config.onToolCall?.(msg.toolCall.functionCalls);
    }

    if (msg?.serverContent?.turnComplete) {
      if (this.playerNode) {
        this.playerNode.port.postMessage({ type: "turn_ended" });
      }
      this.config.onTurnComplete?.();
    }
  }

  triggerGreeting(prompt = GREETING_PROMPT) {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: prompt }] }],
      turnComplete: true,
    });
  }

  sendText(text: string) {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendToolResponse(functionResponses: any[]) {
    if (!this.session) return;
    this.session.sendToolResponse({ functionResponses });
  }

  stop() {
    this.isConnected = false;
    this.hasGreeted = false;
    this.isSpeaking = false;
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.inputCtx) {
      this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.playerNode) {
      this.playerNode.port.postMessage({ type: "clear" });
      this.playerNode.disconnect();
      this.playerNode = null;
    }
    if (this.outputCtx) {
      this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}
