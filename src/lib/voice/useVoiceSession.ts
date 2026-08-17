"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startVoiceAudio, type VoiceAudioHandle } from "./audio";
import { GeminiLiveClient, type FunctionCall } from "./GeminiLiveClient";
import { READ_TOOLS, UI_TOOLS } from "@/lib/ai/toolSchema";
import { stripVoiceLeak } from "./transcriptFilter";

export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

export interface VoiceSessionCallbacks {
  tenant: string;
  sessionId: string;
  locale: string;
  currentSku?: string;
  cartSkus?: string[];
  onTranscript: (role: "user" | "assistant", text: string) => void;
  onShowProducts: (skus: string[], title?: string) => void;
  onAddToCart: (args: { sku: string; size: string; quantity?: number }) => void;
  onError: (message: string) => void;
}

/* Orchestrates one voice session: mints a token, connects GeminiLiveClient,
   wires audio in/out, and resolves tool calls — read tools via /api/voice/tool,
   UI tools by calling straight into the widget's existing handlers (the same
   ones text chat uses), so a customer who switches from typing to talking
   mid-conversation sees identical behaviour either way. */
export function useVoiceSession(cb: VoiceSessionCallbacks) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const audioRef = useRef<VoiceAudioHandle | null>(null);
  const cbRef = useRef(cb);
  // Refs can't be written during render (React flags it — the write has no
  // effect on this render and only matters for callbacks that fire later),
  // so the "keep the latest closure" update happens here instead.
  useEffect(() => {
    cbRef.current = cb;
  });
  // Accumulates streamed transcript deltas per speaker turn; Gemini sends
  // transcription in small fragments rather than one block per turn.
  const partialRef = useRef<{ user: string; assistant: string }>({ user: "", assistant: "" });

  // Fallback for a real, observed Live-API behaviour: the model reliably
  // calls read tools (searchProducts/getProducts) to ground what it says, but
  // frequently skips the FOLLOW-UP showProducts call that would put those
  // same items on screen — even with an explicit prompt rule demanding it
  // (verified against gemini-3.1-flash-live-preview, 2026-08). Function-
  // calling reliability inside one continuous audio turn is evidently lower
  // than the text route's multi-round tool loop. Rather than keep tuning the
  // prompt against a model behaviour, this tracks every sku a read tool
  // returned during the turn and — if the model's own turn ends without ever
  // calling showProducts — shows them anyway. A customer who heard the
  // stylist name a product and then saw nothing on screen is a worse failure
  // than the (rare) card the model didn't explicitly ask for.
  const turnSkusRef = useRef<Set<string>>(new Set());
  const turnShowedRef = useRef(false);
  // The user's transcript otherwise never appears until the whole session
  // ends (inputTranscription only stops streaming once the user's turn is
  // over, and nothing else in the message stream marks that boundary
  // directly). The assistant's FIRST audio byte of a turn is the earliest
  // available signal that the user's turn just ended, so it doubles as the
  // trigger to flush what they said.
  const assistantTurnStartedRef = useRef(false);

  const flushPartial = useCallback((role: "user" | "assistant") => {
    // Filtering only the DISPLAYED text, never the audio: the customer has
    // already heard whatever leaked by the time this runs. See
    // transcriptFilter.ts for why the prompt rule alone wasn't enough.
    const text = stripVoiceLeak(partialRef.current[role]);
    if (text) cbRef.current.onTranscript(role, text);
    partialRef.current[role] = "";
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.stop();
    audioRef.current = null;
    clientRef.current?.close();
    clientRef.current = null;
    flushPartial("user");
    flushPartial("assistant");
    setStatus("idle");
  }, [flushPartial]);

  const start = useCallback(async () => {
    if (status !== "idle" && status !== "error") return;
    setStatus("connecting");

    let audio: VoiceAudioHandle;
    try {
      audio = await startVoiceAudio();
    } catch (e) {
      // Almost always a mic-permission denial or a non-secure context; both
      // need the customer's action, not a retry.
      cbRef.current.onError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Mikrofon izni verilmedi."
          : "Mikrofon başlatılamadı.",
      );
      setStatus("error");
      return;
    }
    audioRef.current = audio;

    let tokenData: { token: string; model: string };
    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant: cbRef.current.tenant,
          sessionId: cbRef.current.sessionId,
          locale: cbRef.current.locale,
          currentSku: cbRef.current.currentSku,
          cartSkus: cbRef.current.cartSkus,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `http_${res.status}`);
      }
      tokenData = await res.json();
    } catch {
      audio.stop();
      audioRef.current = null;
      cbRef.current.onError("Sesli danışman şu anda başlatılamadı.");
      setStatus("error");
      return;
    }

    const client = new GeminiLiveClient(tokenData.token, {
      model: tokenData.model,
      onOpen: () => {
        setStatus("listening");
        client.triggerGreeting();
      },
      onAudioData: (b64) => {
        if (!assistantTurnStartedRef.current) {
          assistantTurnStartedRef.current = true;
          flushPartial("user");
        }
        audioRef.current?.playChunk(b64);
        setStatus("speaking");
      },
      onTurnComplete: () => {
        audioRef.current?.markTurnEnded();
        flushPartial("assistant");
        assistantTurnStartedRef.current = false;
        setStatus("listening");
        if (!turnShowedRef.current && turnSkusRef.current.size) {
          cbRef.current.onShowProducts([...turnSkusRef.current]);
        }
        turnSkusRef.current = new Set();
        turnShowedRef.current = false;
      },
      onTranscription: (text, isUser) => {
        if (!isUser && !assistantTurnStartedRef.current) {
          // Transcription can arrive in the same or an earlier message than
          // the first audio byte — this covers the ordering onAudioData
          // above assumes without depending on it.
          assistantTurnStartedRef.current = true;
          flushPartial("user");
        }
        partialRef.current[isUser ? "user" : "assistant"] += text;
      },
      onToolCall: async (calls: FunctionCall[]) => {
        const responses: { id?: string; name: string; response: Record<string, unknown> }[] = [];
        for (const call of calls) {
          if (UI_TOOLS.has(call.name)) {
            if (call.name === "showProducts") {
              const skus = Array.isArray(call.args.skus) ? (call.args.skus as string[]).map(String) : [];
              cbRef.current.onShowProducts(skus, typeof call.args.title === "string" ? call.args.title : undefined);
              turnShowedRef.current = true;
              turnSkusRef.current = new Set();
            } else if (call.name === "addToCart") {
              cbRef.current.onAddToCart({
                sku: String(call.args.sku ?? ""),
                size: String(call.args.size ?? ""),
                quantity: typeof call.args.quantity === "number" ? call.args.quantity : undefined,
              });
            }
            responses.push({ id: call.id, name: call.name, response: { ok: true } });
            continue;
          }
          if (READ_TOOLS.has(call.name)) {
            try {
              const res = await fetch("/api/voice/tool", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ tenant: cbRef.current.tenant, name: call.name, args: call.args }),
              });
              const result = await res.json();
              responses.push({ id: call.id, name: call.name, response: result });
              // Feed the showProducts fallback: only searchProducts/getProducts
              // return a `products` array (checkStock does not), and only a
              // small, specific result should auto-surface — a broad search
              // ("kaç ceket var") returning a dozen items is browsing, not a
              // recommendation, and showing all of it unasked would be noise.
              const products = Array.isArray((result as { products?: unknown }).products)
                ? ((result as { products: { sku?: string }[] }).products)
                : [];
              if (products.length && products.length <= 4) {
                for (const p of products) if (p.sku) turnSkusRef.current.add(p.sku);
              }
            } catch {
              responses.push({ id: call.id, name: call.name, response: { error: "tool_failed" } });
            }
            continue;
          }
          responses.push({ id: call.id, name: call.name, response: { error: "unknown_tool" } });
        }
        clientRef.current?.sendToolResponse(responses);
      },
      onError: () => {
        cbRef.current.onError("Bağlantıda bir sorun oldu.");
        setStatus("error");
      },
      onClose: () => {
        if (audioRef.current) setStatus("idle");
      },
      onUsage: (usage) => {
        // Fire-and-forget on every update; the endpoint only keeps the last
        // one it receives per session, and this guarantees a value survives
        // even an ungraceful tab close (sendBeacon-style semantics via a
        // plain fetch with keepalive).
        void fetch("/api/voice/usage", {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenant: cbRef.current.tenant, sessionId: cbRef.current.sessionId, usageMetadata: usage }),
        }).catch(() => {});
      },
    });

    try {
      await client.connect();
    } catch {
      audio.stop();
      audioRef.current = null;
      cbRef.current.onError("Sesli oturum kurulamadı.");
      setStatus("error");
      return;
    }
    clientRef.current = client;
    audio.onMicFrame((b64) => clientRef.current?.sendAudio(b64));
  }, [status, flushPartial]);

  return { status, start, stop };
}
