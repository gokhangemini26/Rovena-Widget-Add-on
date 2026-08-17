import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import { after } from "next/server";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { getCatalog } from "@/lib/catalog";
import { buildStaticPrompt, buildTurnContext } from "@/lib/ai/prompt";
import { buildToolDeclarations, READ_TOOLS, executeReadTool } from "@/lib/ai/tools";
import { logUsage } from "@/lib/metering/usage";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";
import { checkRate, clientIp } from "@/lib/security/ratelimit";
import type { Locale } from "@/lib/tenant/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/* ═══════════════════════════════════════════════════════════════════════════
   POST /api/chat → application/x-ndjson

   One JSON object per line:
     { "text": "..." }                      streamed assistant text
     { "tool": { "name": ..., "args": ...} } UI intent (showProducts/addToCart)
     { "error": "..." }                      terminal, human-readable
     { "done": true }

   NDJSON rather than SSE because the widget runs inside a third-party page
   where proxies and CDNs mangle text/event-stream far more often than they
   mangle a plain chunked POST response.
   ═══════════════════════════════════════════════════════════════════════════ */

const MODEL = "gemini-3.6-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
/** Model round-trips allowed purely to resolve read tools. Round MAX+1 is
    forced text-only so a model that keeps calling tools is always cut off and
    made to answer. */
const MAX_TOOL_ROUNDS = 3;
/** Well under the platform's hard 30s kill, which cannot be caught once it
    fires. Leaves room to always send a real closing line. */
const SOFT_DEADLINE_MS = 25_000;
const ROUND_RESERVE_MS = 3_500;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_HISTORY_TURNS = 20;

interface IncomingMessage { role: "user" | "model"; text: string }

function line(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

function errorResponse(status: number, message: string, origin: string | null, extra?: HeadersInit) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin), ...(extra ?? {}) },
  });
}

export async function OPTIONS(req: Request) {
  const origin = requestOrigin(req);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "invalid_json", origin);
  }

  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getActiveTenant(slug);
  if (!tenant) return errorResponse(404, "unknown_tenant", origin);

  // Origin check first: an unlisted site must not be able to spend this
  // brand's quota, and the answer must not depend on anything else.
  if (!isAllowedOrigin(tenant, origin)) return errorResponse(403, "origin_not_allowed", origin);

  const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 64
    ? body.sessionId
    : "anonymous";

  const verdict = checkRate({
    ip: clientIp(req),
    sessionId: `${tenant.slug}:${sessionId}`,
    requestsPerMinute: tenant.limits.requestsPerMinute,
    messagesPerSession: tenant.limits.messagesPerSession,
  });
  if (!verdict.ok) {
    return errorResponse(
      429,
      verdict.reason ?? "rate_limited",
      origin,
      verdict.retryAfterSeconds ? { "retry-after": String(verdict.retryAfterSeconds) } : undefined,
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse(503, "model_unconfigured", origin);

  const rawMessages = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : [];
  const messages = rawMessages
    .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_MESSAGE_CHARS) }));
  if (!messages.length) return errorResponse(400, "empty_conversation", origin);

  const locale: Locale = tenant.persona.locales.includes(body.locale as Locale)
    ? (body.locale as Locale)
    : tenant.persona.defaultLocale;

  const catalog = await getCatalog(tenant);
  const products = await catalog.getAll();
  if (!products.length) return errorResponse(503, "catalog_empty", origin);

  // The static half takes no per-request argument, so it is byte-identical for
  // every visitor of this tenant and stays eligible for prefix caching. Every
  // volatile fact goes in the turn context below instead — mixing them is what
  // silently multiplies the bill.
  const systemInstruction = buildStaticPrompt(tenant, products);
  // Tenant-dependent: the page-control and try-on tools only exist for brands
  // that switched them on, and their section/category enums come from that
  // brand's own configuration.
  const toolDeclarations = buildToolDeclarations(tenant);
  const turnContext = buildTurnContext({
    locale,
    currentSku: typeof body.currentSku === "string" ? body.currentSku : undefined,
    cartSkus: Array.isArray(body.cartSkus) ? (body.cartSkus as string[]).slice(0, 20) : undefined,
    shownSkus: Array.isArray(body.shownSkus) ? (body.shownSkus as string[]).slice(0, 20) : undefined,
  });

  const contents: Content[] = messages.map((m, i) => ({
    role: m.role,
    parts: [{ text: i === messages.length - 1 ? `${turnContext}\n\n${m.text}` : m.text }],
  }));

  const ai = new GoogleGenAI({ apiKey });
  const startedAt = Date.now();
  let usedModel = MODEL;
  let lastUsage: unknown = null;
  let toolCallsMade = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(line(obj));
      let sentAnyText = false;

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const outOfTime = Date.now() - startedAt > SOFT_DEADLINE_MS - ROUND_RESERVE_MS;
          // The final permitted round (and any round we no longer have budget
          // for) forbids tool calls, guaranteeing the customer gets prose.
          const forceText = round === MAX_TOOL_ROUNDS || outOfTime;

          const config = {
            systemInstruction,
            tools: [{ functionDeclarations: toolDeclarations }],
            toolConfig: forceText
              ? { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } }
              : undefined,
            temperature: 0.7,
            maxOutputTokens: 1200,
          };

          let response: AsyncGenerator<GenerateContentResponse>;
          try {
            response = await ai.models.generateContentStream({
              model: usedModel,
              contents,
              config,
            });
          } catch (e) {
            if (usedModel === MODEL) {
              // One retry on the cheaper sibling: a capacity error on the
              // primary should degrade the answer, not lose the customer.
              usedModel = FALLBACK_MODEL;
              round--;
              continue;
            }
            throw e;
          }

          const pendingCalls: { name: string; args: Record<string, unknown> }[] = [];
          // The model turn is echoed back VERBATIM rather than rebuilt from
          // chunk.functionCalls. Gemini 3 attaches a thoughtSignature to each
          // functionCall part and rejects the follow-up request outright if it
          // is missing, so reconstructing the turn from name+args — which reads
          // like the obvious thing to do — breaks every tool call.
          const modelParts: Part[] = [];
          let roundHadText = false;

          for await (const chunk of response) {
            if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;

            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
              modelParts.push(part);
              if (part.functionCall?.name) {
                pendingCalls.push({
                  name: part.functionCall.name,
                  args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                });
              }
            }

            const text = chunk.text;
            if (text) {
              roundHadText = true;
              sentAnyText = true;
              send({ text });
            }
          }

          if (!pendingCalls.length) break;

          toolCallsMade += pendingCalls.length;

          // UI intents go straight to the widget; they have no return value the
          // model needs, so they never cost another round-trip. showProducts is
          // enriched here rather than by a follow-up fetch from the widget: the
          // cards then appear in the same paint as the sentence describing them.
          const readCalls = pendingCalls.filter((c) => READ_TOOLS.has(c.name));
          for (const call of pendingCalls) {
            if (READ_TOOLS.has(call.name)) continue;
            if (call.name === "showProducts") {
              const skus = Array.isArray(call.args.skus) ? (call.args.skus as string[]).map(String) : [];
              const found = await catalog.getManyBySku(skus);
              if (!found.length) continue; // every sku hallucinated — show nothing
              send({
                tool: {
                  name: "showProducts",
                  args: {
                    title: typeof call.args.title === "string" ? call.args.title : undefined,
                    // Ordered as the model asked, so an outfit reads top-to-bottom.
                    products: skus
                      .map((sku) => found.find((p) => p.sku === sku))
                      .filter((p): p is NonNullable<typeof p> => Boolean(p))
                      .map((p) => ({
                        sku: p.sku,
                        name: p.name,
                        price: p.priceDisplay,
                        image: p.imageMain,
                        url: p.productUrl,
                        sizes: p.variants.map((v) => v.size),
                        category: p.category,
                      })),
                  },
                },
              });
              continue;
            }
            send({ tool: { name: call.name, args: call.args } });
          }

          // A round that only rendered cards and said nothing must get one more
          // turn to speak: the model routinely calls showProducts as its whole
          // reply, and breaking here leaves the customer looking at an outfit
          // with no explanation — which then trips the "didn't understand"
          // fallback below. Text plus cards is already a complete answer, so
          // that case costs no extra round-trip.
          if (!readCalls.length && roundHadText) break;

          contents.push({ role: "model", parts: modelParts });

          const results = await Promise.all(
            readCalls.map(async (call) => ({
              name: call.name,
              response: await executeReadTool(call.name, call.args, { tenant, catalog }),
            })),
          );

          contents.push({
            role: "user",
            parts: [
              ...pendingCalls
                .filter((c) => !READ_TOOLS.has(c.name))
                .map((c) => ({
                  functionResponse: { name: c.name, response: { ok: true } },
                })),
              ...results.map((r) => ({
                functionResponse: { name: r.name, response: r.response },
              })),
            ],
          });
        }

        if (!sentAnyText) {
          send({
            text:
              locale === "tr"
                ? "Kusura bakmayın, bunu tam anlayamadım. Biraz daha anlatır mısınız?"
                : "Sorry, I didn't quite catch that. Could you tell me a little more?",
          });
        }
        send({ done: true });
      } catch (e) {
        // The customer already saw whatever streamed; close with something
        // human rather than a stack trace or a dead connection.
        send({
          error:
            locale === "tr"
              ? "Bağlantıda bir sorun oldu. Tekrar dener misiniz?"
              : "Something went wrong. Please try again.",
        });
        console.error("[chat]", tenant.slug, e instanceof Error ? e.message : e);
      } finally {
        controller.close();
        // Awaiting the metering write inside the stream would delay the close
        // the customer is waiting on; `after` runs it once the response is sent.
        after(() =>
          logUsage({
            tenantSlug: tenant.slug,
            sessionId,
            kind: "chat",
            model: usedModel,
            usageMetadata: lastUsage,
            meta: { toolCalls: toolCallsMade, locale, ms: Date.now() - startedAt },
          }),
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      ...corsHeaders(origin),
    },
  });
}
