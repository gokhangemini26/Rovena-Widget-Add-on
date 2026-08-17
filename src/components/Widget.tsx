"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale, PublicTenantConfig } from "@/lib/tenant/types";
import { ProductCards, type ProductCard } from "./ProductCards";
import { Composer } from "./Composer";

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
  // Session id identifies a conversation for metering and rate limiting. It is
  // random per widget load and never leaves this origin — no cross-site value.
  const sessionId = useMemo(
    () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random())).slice(0, 36),
    [],
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
    [blocks, config.slug, context, locale, postToHost, sessionId, streaming],
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
            <ProductCards
              key={i}
              title={block.title}
              products={block.products}
              onSelect={onProductClick}
              onAddToCart={onAddToCart}
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

      <Composer disabled={streaming} onSend={(t) => void send(t)} locale={locale} />
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
