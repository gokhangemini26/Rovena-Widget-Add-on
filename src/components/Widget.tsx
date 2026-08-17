"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale, PublicTenantConfig } from "@/lib/tenant/types";
import type { UserStyleDna } from "@/lib/memory/types";
import { ProductCards, type ProductCard } from "./ProductCards";
import { Composer } from "./Composer";
import { StyleMemoryBar } from "./StyleMemoryBar";
import { KvkkModal } from "./KvkkModal";
import { TryOnModal } from "./TryOnModal";
import { GeminiLiveSession, type FunctionCall } from "@/lib/live/gemini-live";

/* ══════════════════════════════════════════════════════════════════════════
   The widget itself. Runs inside the iframe on the brand's page.

   It owns the conversation and nothing else: it never touches the host page's
   DOM or cart directly, it asks the loader to do it via postMessage. That is
   what keeps the security boundary real rather than decorative.
   ══════════════════════════════════════════════════════════════════════════ */

type Block =
  | { kind: "text"; role: "user" | "assistant"; text: string }
  | { kind: "products"; title?: string; products: ProductCard[] };

interface HostContext { sku: string | null; cart: string[] }

const HOST_MESSAGE_SOURCE = "rovena-host";

export function Widget({ config, hostOrigin }: { config: PublicTenantConfig; hostOrigin: string }) {
  const locale = config.persona.defaultLocale;
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [context, setContext] = useState<HostContext>({ sku: null, cart: [] });

  // Virtual Try-On State
  const [tryOnProducts, setTryOnProducts] = useState<ProductCard[] | null>(null);

  // Gemini Live Multimodal Voice State
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState<boolean>(false);
  const liveSessionRef = useRef<GeminiLiveSession | null>(null);

  // KVKK & Style Memory State
  const [userEmail, setUserEmail] = useState<string>("");
  const [consentGiven, setConsentGiven] = useState<boolean>(false);
  const [styleDna, setStyleDna] = useState<UserStyleDna | null>(null);
  const [isKvkkModalOpen, setIsKvkkModalOpen] = useState<boolean>(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Session id identifies a conversation for metering and rate limiting. It is
  // random per widget load and never leaves this origin — no cross-site value.
  const sessionId = useMemo(
    () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random())).slice(0, 36),
    [],
  );

  // Load saved KVKK memory preferences from localStorage
  useEffect(() => {
    try {
      const storedEmail = localStorage.getItem(`rovena_email_${config.slug}`) || "";
      const storedConsent = localStorage.getItem(`rovena_consent_${config.slug}`) === "true";
      if (storedEmail && storedConsent) {
        setUserEmail(storedEmail);
        setConsentGiven(true);
        // Fetch style DNA from API
        fetch(`/api/memory?tenant=${encodeURIComponent(config.slug)}&email=${encodeURIComponent(storedEmail)}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.active && data.styleDna) {
              setStyleDna(data.styleDna);
            }
          })
          .catch(() => {});
      }
    } catch {
      // LocalStorage not available or restricted in iframe sandbox
    }
  }, [config.slug]);

  const defaultGreeting = config.persona.greeting[locale] ?? "Merhaba. Size nasıl yardımcı olabilirim?";
  const greeting = useMemo(() => {
    if (consentGiven && styleDna) {
      if (styleDna.purchasedItems?.length) {
        const lastItem = styleDna.purchasedItems[styleDna.purchasedItems.length - 1];
        return locale === "tr"
          ? `Tekrar hoş geldiniz! Gardırobunuzdaki ${lastItem.name} ve stil tercihlerinize uygun yeni sezon kombinleri hazırlamaya hazırım. Bugün nasıl bir kombin arıyorsunuz?`
          : `Welcome back! Ready to curate outfits matching your ${lastItem.name} and saved style preferences. What are you looking for today?`;
      }
      return locale === "tr"
        ? "Tekrar hoş geldiniz! Kayıtlı beden ölçülerinize ve stil tercihlerinize göre size özel kombinler hazırlayabilirim."
        : "Welcome back! Ready with your personal style preferences and sizes.";
    }
    return defaultGreeting;
  }, [consentGiven, defaultGreeting, locale, styleDna]);

  /* ── host bridge ──────────────────────────────────────────────────────── */

  const postToHost = useCallback(
    (type: string, payload?: unknown) => {
      if (window.parent === window) return;
      window.parent.postMessage({ source: "rovena", type, payload }, hostOrigin || "*");
    },
    [hostOrigin],
  );

  const stopLiveVoice = useCallback(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
    }
    setIsLiveActive(false);
    setIsLiveConnecting(false);
  }, []);

  const startLiveVoice = useCallback(async () => {
    if (isLiveActive) {
      stopLiveVoice();
      return;
    }

    try {
      setIsLiveConnecting(true);
      const res = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: config.slug }),
      });
      const data = await res.json();
      if (!res.ok && !data.fallback) {
        throw new Error(data.error || "Token mint failed");
      }

      const session = new GeminiLiveSession({
        model: data.model || "gemini-3.1-flash-live-preview",
        apiKey: data.apiKey,
        token: data.token,
        systemInstruction: data.systemInstruction,
        onOpen: () => {
          setIsLiveConnecting(false);
          setIsLiveActive(true);
        },
        onClose: () => {
          stopLiveVoice();
        },
        onError: (err) => {
          console.error("[Live Voice Error]", err);
          stopLiveVoice();
        },
        onTranscription: (text, isUser) => {
          if (!text.trim()) return;
          setBlocks((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.kind === "text" && last.role === (isUser ? "user" : "assistant")) {
              return [...prev.slice(0, -1), { kind: "text", role: isUser ? "user" : "assistant", text: last.text + text }];
            }
            return [...prev, { kind: "text", role: isUser ? "user" : "assistant", text }];
          });
        },
        onToolCall: async (calls) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const responses: any[] = [];
          for (const call of calls) {
            if (call.name === "showProducts") {
              const skus = Array.isArray(call.args.skus) ? (call.args.skus as string[]) : [];
              if (skus.length) {
                postToHost("event", { event: "products_shown" });
                try {
                  const res = await fetch(`/api/products?tenant=${config.slug}&skus=${skus.join(",")}`);
                  if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.products) && data.products.length > 0) {
                      setBlocks((prev) => [
                        ...prev,
                        { kind: "products", title: (call.args.title as string) || "Önerilen Parçalar", products: data.products },
                      ]);
                    }
                  }
                } catch {}
              }
              responses.push({
                id: call.id,
                name: call.name,
                response: { output: { ok: true, count: skus.length } },
              });
            } else if (call.name === "addToCart") {
              postToHost("add-to-cart", call.args);
              responses.push({
                id: call.id,
                name: call.name,
                response: { output: { ok: true, added: true } },
              });
            } else if (call.name === "show_on_model") {
              responses.push({
                id: call.id,
                name: call.name,
                response: { output: { ok: true, dressing: true } },
              });
            } else {
              responses.push({
                id: call.id,
                name: call.name,
                response: { output: { ok: true } },
              });
            }
          }
          session.sendToolResponse(responses);
        },
      });

      liveSessionRef.current = session;
      await session.start();
    } catch (e) {
      console.error("[Start Live Voice Error]", e);
      setIsLiveConnecting(false);
      setIsLiveActive(false);
    }
  }, [config.slug, isLiveActive, postToHost, stopLiveVoice]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
    };
  }, []);

  const suggestions = useMemo(() => {
    const list = config.persona.suggestions[locale] ?? [];
    return ["✨ Kombin Öner & Mankende Giydir", ...list];
  }, [config.persona.suggestions, locale]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only the page that framed us may drive us.
      if (hostOrigin && event.origin !== hostOrigin) return;
      const data = event.data;
      if (!data || data.source !== HOST_MESSAGE_SOURCE) return;

      if (data.type === "context" && data.payload) {
        setContext({
          sku: data.payload.sku ?? null,
          cart: Array.isArray(data.payload.cart) ? data.payload.cart : [],
        });
      }
      if (data.type === "ask" && data.payload?.text) {
        void send(String(data.payload.text));
      }
    }
    window.addEventListener("message", onMessage);
    postToHost("ready");
    return () => window.removeEventListener("message", onMessage);
    // `send` is stable enough for this purpose and re-subscribing on every
    // conversation change would drop messages mid-stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostOrigin, postToHost]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [blocks, streaming]);

  /* ── conversation ─────────────────────────────────────────────────────── */

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = blocks
        .filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text")
        .map((b) => ({ role: b.role === "user" ? "user" : "model", text: b.text }));

      setBlocks((prev) => [...prev, { kind: "text", role: "user", text: trimmed }]);
      setStreaming(true);
      setFatal(null);
      postToHost("event", { event: "message_sent" });

      const shownSkus = blocks
        .filter((b): b is Extract<Block, { kind: "products" }> => b.kind === "products")
        .flatMap((b) => b.products.map((p) => p.sku))
        .slice(-12);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            tenant: config.slug,
            sessionId,
            locale,
            messages: [...history, { role: "user", text: trimmed }],
            currentSku: context.sku ?? undefined,
            cartSkus: context.cart,
            shownSkus,
            userEmail: consentGiven ? userEmail : undefined,
            consentGiven,
          }),
        });

        if (!res.ok || !res.body) {
          setFatal(errorText(res.status, locale));
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantIndex = -1;

        const appendText = (chunk: string) => {
          setBlocks((prev) => {
            const next = [...prev];
            if (assistantIndex === -1 || next[assistantIndex]?.kind !== "text") {
              next.push({ kind: "text", role: "assistant", text: chunk });
              assistantIndex = next.length - 1;
            } else {
              const current = next[assistantIndex] as Extract<Block, { kind: "text" }>;
              next[assistantIndex] = { ...current, text: current.text + chunk };
            }
            return next;
          });
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const raw of lines) {
            if (!raw.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw);
            } catch {
              continue; // a partial line survives in `buffer`; never guess at it
            }

            if (typeof event.text === "string") appendText(event.text);

            if (event.tool && typeof event.tool === "object") {
              const tool = event.tool as { name: string; args: Record<string, unknown> };
              if (tool.name === "showProducts") {
                const products = (tool.args.products ?? []) as ProductCard[];
                if (products.length) {
                  setBlocks((prev) => [
                    ...prev,
                    { kind: "products", title: tool.args.title as string | undefined, products },
                  ]);
                  // A new products block ends the current assistant bubble, so
                  // any text after it starts a fresh one below the cards.
                  assistantIndex = -1;
                  postToHost("event", { event: "products_shown" });
                }
              }
              if (tool.name === "addToCart") {
                postToHost("add-to-cart", tool.args);
              }
            }

            if (typeof event.error === "string") setFatal(event.error);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFatal(errorText(0, locale));
      } finally {
        setStreaming(false);
      }
    },
    [blocks, config.slug, consentGiven, context, locale, postToHost, sessionId, streaming, userEmail],
  );

  const onProductClick = useCallback(
    (product: ProductCard) => postToHost("navigate", { url: product.url, sku: product.sku }),
    [postToHost],
  );

  const onAddToCart = useCallback(
    (product: ProductCard, size: string) =>
      postToHost("add-to-cart", {
        sku: product.sku, size, quantity: 1, url: product.url,
      }),
    [postToHost],
  );

  const handleConsentChange = (email: string, consent: boolean, dna?: UserStyleDna | null) => {
    setUserEmail(email);
    setConsentGiven(consent);
    setStyleDna(dna ?? null);

    try {
      if (consent) {
        localStorage.setItem(`rovena_email_${config.slug}`, email);
        localStorage.setItem(`rovena_consent_${config.slug}`, "true");
      } else {
        localStorage.removeItem(`rovena_email_${config.slug}`);
        localStorage.setItem(`rovena_consent_${config.slug}`, "false");
      }
    } catch {}
  };

  const handleClearMemory = () => {
    setUserEmail("");
    setConsentGiven(false);
    setStyleDna(null);
    try {
      localStorage.removeItem(`rovena_email_${config.slug}`);
      localStorage.removeItem(`rovena_consent_${config.slug}`);
    } catch {}
  };

  return (
    <div className="rovena-root">
      <header className="rv-header">
        <div className="rv-header-branding">
          <span className="rv-title">{config.persona.displayName}</span>
          <span className="rv-badge-ai">AI</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className={`rv-voice-toggle ${isLiveActive ? "rv-mic-active" : ""}`}
            onClick={startLiveVoice}
            disabled={isLiveConnecting}
            title={isLiveActive ? "Canlı Sesli Görüşmeyi Kapat" : "Gemini Live Sesli Asistanı Başlat"}
            aria-label="Canlı Sesli Asistan"
            style={{
              background: isLiveActive ? "#ffebee" : "none",
              border: 0,
              cursor: "pointer",
              fontSize: 16,
              opacity: isLiveConnecting ? 0.5 : 1,
              padding: "4px 6px",
              borderRadius: "50%",
            }}
          >
            {isLiveActive ? "🔴" : isLiveConnecting ? "⏳" : "🎙️"}
          </button>
          <button
            type="button"
            className="rv-close"
            aria-label="Kapat"
            onClick={() => postToHost("close")}
          >
            ✕
          </button>
        </div>
      </header>

      {/* KVKK & Style Memory Bar */}
      <StyleMemoryBar
        tenantSlug={config.slug}
        tenantName={config.name}
        styleDna={styleDna}
        userEmail={userEmail}
        consentGiven={consentGiven}
        onConsentChange={handleConsentChange}
        onClearMemory={handleClearMemory}
        onOpenKvkkModal={() => setIsKvkkModalOpen(true)}
      />

      <div className="rv-scroll" ref={scrollRef}>
        <div className="rv-bubble rv-assistant">{greeting}</div>

        {blocks.map((block, i) =>
          block.kind === "text" ? (
            <div
              key={i}
              className={`rv-bubble ${block.role === "user" ? "rv-user" : "rv-assistant"}`}
            >
              {block.text}
            </div>
          ) : (
            <ProductCards
              key={i}
              title={block.title}
              products={block.products}
              onSelect={onProductClick}
              onAddToCart={onAddToCart}
              onTryOn={(prods) => setTryOnProducts(prods)}
            />
          ),
        )}

        {streaming && blocks[blocks.length - 1]?.kind === "text" &&
          (blocks[blocks.length - 1] as Extract<Block, { kind: "text" }>).role === "user" && (
            <div className="rv-bubble rv-assistant rv-typing" aria-live="polite">
              <span /><span /><span />
            </div>
          )}

        {fatal && <div className="rv-error" role="alert">{fatal}</div>}
      </div>

      {!blocks.length && suggestions.length > 0 && (
        <div className="rv-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="rv-chip" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <Composer
        disabled={streaming}
        onSend={(t) => void send(t)}
        locale={locale}
        isLiveActive={isLiveActive}
        onVoiceToggle={startLiveVoice}
      />

      {/* Virtual Try-On Modal */}
      {tryOnProducts && (
        <TryOnModal
          tenantSlug={config.slug}
          products={tryOnProducts}
          onClose={() => setTryOnProducts(null)}
          onAddToCart={onAddToCart}
        />
      )}

      {/* KVKK Aydınlatma Metni Modal */}
      <KvkkModal
        isOpen={isKvkkModalOpen}
        onClose={() => setIsKvkkModalOpen(false)}
        tenantName={config.name}
      />
    </div>
  );
}

function errorText(status: number, locale: Locale): string {
  if (status === 429) {
    return locale === "tr"
      ? "Biraz hızlı gittik. Birkaç saniye sonra tekrar deneyin."
      : "That was a bit fast. Please try again in a few seconds.";
  }
  if (status === 403) {
    return locale === "tr"
      ? "Bu site için danışman etkin değil."
      : "The stylist is not enabled for this site.";
  }
  return locale === "tr"
    ? "Bağlantıda bir sorun oldu. Tekrar dener misiniz?"
    : "Something went wrong. Please try again.";
}
