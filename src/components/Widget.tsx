"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale, PublicTenantConfig } from "@/lib/tenant/types";
import { ProductCards, type ProductCard } from "./ProductCards";
import { Composer } from "./Composer";
import { TryOnModal } from "./TryOnModal";
import { useVoiceSession } from "@/lib/voice/useVoiceSession";
import { buildPageTools, PAGE_TOOLS, TOOL_DECLARATIONS } from "@/lib/ai/toolSchema";

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blocksRef = useRef<Block[]>(blocks);
  // Writing a ref during render has no effect on that render and React flags
  // it; the mirror exists for callbacks that fire later, so it is updated here.
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  // Session id identifies a conversation for metering and rate limiting. It is
  // random per widget load and never leaves this origin — no cross-site value.
  const sessionId = useMemo(
    () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random())).slice(0, 36),
    [],
  );

  // The outfit the mannequin view will dress: whatever the last products block
  // put on screen. Mirrors the source product's rule that show_on_model dresses
  // "the outfit CURRENTLY IN THE SUGGESTIONS PANEL" rather than taking a list —
  // the model cannot then promise a piece the customer never saw.
  const [tryOnProducts, setTryOnProducts] = useState<ProductCard[] | null>(null);

  const toolDeclarations = useMemo(
    () => [...TOOL_DECLARATIONS, ...buildPageTools(config)],
    [config],
  );

  const greeting = config.persona.greeting[locale] ?? "Merhaba. Size nasıl yardımcı olabilirim?";
  const suggestions = config.persona.suggestions[locale] ?? [];

  /* ── host bridge ──────────────────────────────────────────────────────── */

  const postToHost = useCallback(
    (type: string, payload?: unknown) => {
      if (window.parent === window) return;
      window.parent.postMessage({ source: "rovena", type, payload }, hostOrigin || "*");
    },
    [hostOrigin],
  );

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

  /* ── shared: resolve a sku the assistant names to whatever the widget has
     already shown, so a proactive addToCart (voice or text) can still send
     the host a redirect URL even though the tool schema itself never carries
     one — the model should never have to know URLs. ─────────────────────── */
  const findShownProduct = useCallback((sku: string): ProductCard | undefined => {
    for (let i = blocksRef.current.length - 1; i >= 0; i--) {
      const b = blocksRef.current[i];
      if (b.kind === "products") {
        const hit = b.products.find((p) => p.sku === sku);
        if (hit) return hit;
      }
    }
    return undefined;
  }, []);

  /* ── page control ───────────────────────────────────────────────────────
     The widget cannot scroll, route or open anything on the brand's page — it
     is sandboxed in an iframe on a different origin. Every page action is a
     REQUEST to the loader, which carries it out on the host side. The model is
     told (in the prompt) to phrase these in the present tense for exactly this
     reason: we ask, and we never learn whether it landed. */
  const runPageAction = useCallback(
    (name: string, args: Record<string, unknown>) => {
      if (!config.pageControl?.enabled || !PAGE_TOOLS.has(name)) return;
      if (name === "openCategory") {
        // The model names a category id; the URL is ours to resolve, so a
        // hallucinated id simply finds nothing rather than navigating the
        // customer somewhere arbitrary.
        const category = config.pageControl.categories.find((c) => c.id === String(args.category));
        if (!category) return;
        postToHost("page-action", { action: "open-category", id: category.id, url: category.url });
        return;
      }
      if (name === "showProduct") {
        const sku = String(args.sku ?? "");
        if (!sku) return;
        postToHost("page-action", {
          action: "show-product",
          sku,
          url: findShownProduct(sku)?.url,
        });
        return;
      }
      if (name === "scrollToSection") {
        const section = config.pageControl.sections.find((s) => s.id === String(args.section));
        if (!section) return;
        postToHost("page-action", { action: "scroll-to-section", id: section.id });
        return;
      }
      if (name === "openCart" || name === "closeCart") {
        postToHost("page-action", { action: name === "openCart" ? "open-cart" : "close-cart" });
      }
    },
    [config.pageControl, postToHost, findShownProduct],
  );

  /* ── mannequin ──────────────────────────────────────────────────────────
     Dresses the outfit currently on screen. Refuses (rather than rendering
     something arbitrary) when nothing is on screen yet — the model is
     instructed to call showProducts first, and an empty render would be a
     picture of clothes the customer never chose. */
  const openTryOn = useCallback(() => {
    if (!config.tryOn?.enabled) return;
    for (let i = blocksRef.current.length - 1; i >= 0; i--) {
      const b = blocksRef.current[i];
      if (b.kind === "products" && b.products.length) {
        setTryOnProducts(b.products);
        postToHost("event", { event: "products_shown" });
        return;
      }
    }
  }, [config.tryOn, postToHost]);

  /* ── conversation (text) ──────────────────────────────────────────────── */

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
                const sku = String(tool.args.sku ?? "");
                const shown = findShownProduct(sku);
                postToHost("add-to-cart", { ...tool.args, url: shown?.url });
              }
              if (PAGE_TOOLS.has(tool.name)) runPageAction(tool.name, tool.args);
              // Deferred a tick: showOnModel arrives in the same stream as the
              // showProducts that precedes it, and the outfit is read from
              // state that has not committed yet at this point.
              if (tool.name === "showOnModel") setTimeout(openTryOn, 0);
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
    [
      blocks, config.slug, context, locale, postToHost, sessionId, streaming,
      findShownProduct, runPageAction, openTryOn,
    ],
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

  /* ── conversation (voice) ─────────────────────────────────────────────── */

  const voiceEnabled = config.voice.enabled;
  const [voiceFatal, setVoiceFatal] = useState<string | null>(null);

  const voice = useVoiceSession({
    tenant: config.slug,
    sessionId,
    locale,
    currentSku: context.sku ?? undefined,
    cartSkus: context.cart,
    onTranscript: (role, text) => {
      setBlocks((prev) => [...prev, { kind: "text", role: role === "user" ? "user" : "assistant", text }]);
    },
    toolDeclarations,
    onShowProducts: (skus, title) => {
      // Voice tool calls carry skus only — the text route enriches
      // showProducts server-side before streaming, but the Live socket cannot.
      // /api/cards returns the display fields (image, url, sizes) that the
      // model-facing projection deliberately omits.
      void fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant: config.slug, skus }),
      })
        .then((r) => r.json())
        .then((data: { products?: ProductCard[] }) => {
          const products = data.products ?? [];
          if (products.length) {
            setBlocks((prev) => [...prev, { kind: "products", title, products }]);
            postToHost("event", { event: "products_shown" });
          }
        })
        .catch(() => {});
    },
    onAddToCart: (args) => {
      const shown = findShownProduct(args.sku);
      postToHost("add-to-cart", { ...args, url: shown?.url });
    },
    onPageAction: runPageAction,
    // Deferred a tick for the same reason as the text path: showOnModel often
    // arrives alongside the showProducts whose cards it means to dress, and
    // that state has not committed yet.
    onShowOnModel: () => setTimeout(openTryOn, 0),
    onError: (message) => setVoiceFatal(message),
  });

  const toggleVoice = useCallback(() => {
    setVoiceFatal(null);
    if (voice.status === "idle" || voice.status === "error") void voice.start();
    else voice.stop();
  }, [voice]);

  // Voice owns the turn while active; a stray text send would open a second,
  // unrelated conversation context against /api/chat.
  const voiceActive = voice.status !== "idle" && voice.status !== "error";

  return (
    <div className="rovena-root">
      <header className="rv-header">
        <span className="rv-title">{config.persona.displayName}</span>
        <button
          type="button"
          className="rv-close"
          aria-label="Kapat"
          onClick={() => postToHost("close")}
        >
          ✕
        </button>
      </header>

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
            <div key={i}>
              <ProductCards
                title={block.title}
                products={block.products}
                onSelect={onProductClick}
                onAddToCart={onAddToCart}
              />
              {config.tryOn?.enabled && (
                // Offered on every outfit, not just when the stylist thinks to
                // suggest it: the customer asking for it themselves is the
                // clearest possible consent, and the model routinely forgets
                // to offer (the same reliability gap showProducts has).
                <button
                  type="button"
                  className="rv-tryon-cta"
                  onClick={() => setTryOnProducts(block.products)}
                >
                  Mankende gör
                </button>
              )}
            </div>
          ),
        )}

        {streaming && blocks[blocks.length - 1]?.kind === "text" &&
          (blocks[blocks.length - 1] as Extract<Block, { kind: "text" }>).role === "user" && (
            <div className="rv-bubble rv-assistant rv-typing" aria-live="polite">
              <span /><span /><span />
            </div>
          )}

        {fatal && <div className="rv-error" role="alert">{fatal}</div>}
        {voiceFatal && <div className="rv-error" role="alert">{voiceFatal}</div>}
      </div>

      {!blocks.length && !voiceActive && suggestions.length > 0 && (
        <div className="rv-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="rv-chip" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="rv-composer-row">
        <Composer disabled={streaming || voiceActive} onSend={(t) => void send(t)} locale={locale} />
        {voiceEnabled && (
          <button
            type="button"
            className={`rv-mic ${voiceActive ? "rv-mic-on" : ""}`}
            aria-label={voiceActive ? "Sesli görüşmeyi kapat" : "Sesli danışmanı aç"}
            aria-pressed={voiceActive}
            onClick={toggleVoice}
          >
            <span className={`rv-mic-dot rv-mic-${voice.status}`} />
            {voiceStatusLabel(voice.status, locale)}
          </button>
        )}
      </div>

      {tryOnProducts && (
        <TryOnModal
          tenantSlug={config.slug}
          sessionId={sessionId}
          products={tryOnProducts}
          onClose={() => setTryOnProducts(null)}
          onSelect={onProductClick}
          onAddToCart={onAddToCart}
        />
      )}
    </div>
  );
}

function voiceStatusLabel(status: string, locale: Locale): string {
  if (status === "idle" || status === "error") return locale === "tr" ? "Sesli" : "Voice";
  if (status === "connecting") return locale === "tr" ? "Bağlanıyor…" : "Connecting…";
  if (status === "speaking") return locale === "tr" ? "Konuşuyor…" : "Speaking…";
  return locale === "tr" ? "Dinliyor…" : "Listening…";
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
