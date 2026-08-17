"use client";

import { GoogleGenAI } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";

/* ═══════════════════════════════════════════════════════════════════════════
   Gemini Live client — real-time voice + function calling, browser-side.

   The session authenticates with a short-lived EPHEMERAL TOKEN minted by
   /api/voice/token. The system prompt, voice and modalities are locked into
   that token server-side and never reach the browser; only the tool schema
   (public — tool names and skus are already public) is supplied here.

   Ported from the source product's proven Live client. NOT ported: the
   Silero VAD-based local barge-in and echo-suppression layer (~450 lines
   across two files there). This client instead mutes the mic outgoing stream
   while the player is producing audio (see src/lib/voice/audio.ts) and relies
   on Gemini's own server-side automatic activity detection for turn-taking.
   That trades barge-in (the customer cannot interrupt mid-sentence — the
   source's NO_INTERRUPTION setting already made this the intended behaviour
   even there) for not needing an ML VAD model and its asset files. Worth
   revisiting once a customer explicitly asks to interrupt the stylist.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiLiveConfig {
  model: string;
  /** Tool surface for THIS tenant — page control and try-on only exist for
      brands that switched them on, so the schema cannot be a module constant. */
  toolDeclarations: FunctionDeclaration[];
  onAudioData?: (base64Pcm: string) => void;
  onTranscription?: (text: string, isUser: boolean) => void;
  onToolCall?: (calls: FunctionCall[]) => void;
  onTurnComplete?: () => void;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: (info?: { code?: number; reason?: string }) => void;
  onUsage?: (usage: unknown) => void;
}

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private config: GeminiLiveConfig;

  /** `token` is the ephemeral auth token name (`auth_tokens/…`) from
      /api/voice/token — never the real API key. */
  constructor(token: string, config: GeminiLiveConfig) {
    this.ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
    this.config = config;
  }

  async connect() {
    // `callbacks.onopen` is the SDK's own WebSocket-open signal and can fire
    // BEFORE this `await` resolves and assigns `this.session` — a real race
    // observed here: the socket opened, setupComplete arrived, but
    // triggerGreeting()'s `this.session?.sendClientContent(...)` was a silent
    // no-op because `this.session` was still null at that instant. Firing
    // `config.onOpen` only after `this.session` is guaranteed assigned (i.e.
    // after this method itself returns) closes that window.
    this.session = await this.ai.live.connect({
      model: this.config.model,
      config: {
        tools: [{ functionDeclarations: this.config.toolDeclarations }],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        // Effectively unlimited session length — without it the Live server
        // terminates once the context window fills (a few minutes of audio
        // in practice) and drops the socket mid-conversation.
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => this.handleMessage(message),
        onclose: (ev?: { code?: number; reason?: string }) =>
          this.config.onClose?.({ code: ev?.code, reason: ev?.reason }),
        onerror: (err: unknown) => this.config.onError?.(err),
      },
    });
    this.config.onOpen?.();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleMessage(message: any) {
    const parts = message?.serverContent?.modelTurn?.parts;
    if (parts?.length) {
      for (const part of parts) {
        if (part.inlineData?.data) this.config.onAudioData?.(part.inlineData.data);
        // In an audio-only session, part.text here is stray internal text
        // (mode tokens, tool echoes) — never spoken words. Drop it rather
        // than surfacing it as a transcript line.
      }
    }

    const outT =
      message?.serverContent?.outputTranscription?.text ||
      message?.serverContent?.outputAudioTranscription?.text;
    if (outT) this.config.onTranscription?.(outT, false);

    const inT =
      message?.serverContent?.inputTranscription?.text ||
      message?.serverContent?.inputAudioTranscription?.text;
    if (inT) this.config.onTranscription?.(inT, true);

    if (message?.toolCall?.functionCalls?.length) {
      this.config.onToolCall?.(message.toolCall.functionCalls);
    }

    if (message?.usageMetadata) this.config.onUsage?.(message.usageMetadata);

    if (message?.serverContent?.turnComplete) this.config.onTurnComplete?.();
  }

  sendAudio(base64Pcm16: string) {
    this.session?.sendRealtimeInput({ audio: { data: base64Pcm16, mimeType: "audio/pcm;rate=16000" } });
  }

  sendText(text: string) {
    this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
  }

  triggerGreeting(prompt = "Briefly greet the customer and ask how you can help, in one short sentence.") {
    this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true });
  }

  sendToolResponse(functionResponses: { id?: string; name: string; response: Record<string, unknown> }[]) {
    this.session?.sendToolResponse({ functionResponses });
  }

  close() {
    this.session?.close();
    this.session = null;
  }
}
