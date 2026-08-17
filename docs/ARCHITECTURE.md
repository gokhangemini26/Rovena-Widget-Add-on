# Architecture

Written for whoever changes this next. It records the decisions and the reasons,
not the file tree — the file tree is in the README.

---

## The one constraint everything else follows from

**Onboarding a brand must not require a code change.**

The source product (ROVENA) is a single-brand storefront: the catalog is a
TypeScript array, the palette is in a CSS file, the persona is in a prompt
literal. Every one of those is a place a second brand would need a developer.
So each became a field of `Tenant` (`src/lib/tenant/types.ts`), and that type is
the schema for the whole product. When a brand needs something we cannot
express, the fix is a new field there — not a branch in a route.

The database mirrors this: `tenants` has columns only for what must be
queryable (slug, status, origins) and everything else lives in `config` jsonb.
Adding a knob is an UPDATE, not a migration plus a deploy.

---

## The iframe boundary

The widget runs in an iframe on the brand's site, and the loader
(`public/rovena.js`) is the only thing that touches their page.

This costs real ergonomics — every interaction between the two sides is a
postMessage — and buys the thing that makes the product installable:

- We cannot read their DOM, cookies, session or checkout.
- They cannot read the conversation.
- Neither side's CSS can break the other's.
- No `allow-top-navigation`: the widget cannot move their customer off their site.

A brand's security review looks at one `<script>` tag and one iframe. Without
the boundary it would look at everything we ship, forever, on every release.

The loader is deliberately dependency-free, un-built ES5. A strict CSP, an old
bundler and a nervous reviewer all cope with one plain file.

### Origins are the real boundary

`tenant.allowedOrigins` decides who may frame the widget (CSP `frame-ancestors`,
set per request in `src/proxy.ts`), whose fetches get CORS headers, and — since
usage is billed per tenant — who can spend a brand's quota. Exact match on
scheme+host+port; no wildcards, because `*.example.com` includes whatever
subdomain someone can get pointed at that zone.

`src/lib/security/origin.ts` is the single implementation. The proxy, the API
routes and the embed page's postMessage target all call into it, so they cannot
drift apart.

---

## The stock contract

The highest-severity failure mode for a fashion brand is a stylist that promises
stock it does not have. One prompt rule does not prevent it, so this is
structural:

1. **Data.** Availability is never a `Product` field, never in the catalog
   projection sent to the model, never in the system prompt. The only path in is
   the `checkStock` tool's return value.
2. **Phrasing.** `stockPhrasing()` owns the exact sentence permitted for each
   status, and the tool tells the model to repeat it without strengthening it.
   A prompt edit cannot invent a stronger claim than the data supports.
3. **Failure.** `unknown` is never treated as available. A timed-out endpoint
   produces "teyit edip döneyim", not a sale the brand cannot fulfil.

Verified behaviour with `mode: "assumed"` — asked "52 beden stokta var mı,
bugün alabilir miyim?", the stylist answered "koleksiyonda listeli; stok
teyidini mağazadan almak gerekiyor" and none of the banned phrases appeared.

The source product also has a lagging detector that logs unbacked availability
claims. Porting it is worthwhile; it converts an invisible failure into a
measured one.

---

## Prompt structure and unit cost

`buildStaticPrompt(tenant, products)` takes **no per-request argument**. It is
byte-identical for every visitor of a tenant, which is what keeps it eligible
for prefix caching — and since the catalog is most of the prompt, that is the
single biggest lever on cost per conversation.

`buildTurnContext()` carries everything volatile: locale, the product the
customer is viewing, the cart, what the suggestion panel is showing.

Mixing them is the classic mistake. One weather string or timestamp in the
static half drops the cache hit rate to zero and multiplies the bill silently —
nothing breaks, the invoice just grows.

`shownSkus` exists for a specific observed failure: without it the model denies
having recommended the outfit currently on the customer's screen.

---

## The tool loop

`POST /api/chat` streams NDJSON — one JSON object per line — rather than SSE,
because the widget runs inside third-party pages where proxies and CDNs mangle
`text/event-stream` far more often than a chunked POST response.

Read tools (`searchProducts`, `getProducts`, `checkStock`) resolve server-side
and loop back into the model. UI tools (`showProducts`, `addToCart`) stream
straight to the widget as intents.

Three things in that loop are load-bearing and easy to break:

**Echo the model turn verbatim.** Gemini 3 attaches a `thoughtSignature` to each
`functionCall` part and rejects the follow-up request outright if it is missing.
Rebuilding the turn from `name` + `args` — which reads like the obvious thing to
do — breaks every tool call with a 400. The raw `candidates[0].content.parts`
are accumulated and pushed back unchanged.

**Let a card-only round speak.** The model routinely calls `showProducts` as its
entire reply. Breaking out of the loop there leaves the customer looking at an
outfit with no explanation and trips the "didn't understand" fallback. So a
round that produced cards but no text gets one more turn; a round that produced
both is already complete and costs no extra round-trip.

**Always end in prose.** The last permitted round — and any round we no longer
have time budget for — forces `functionCallingConfig: NONE`. A model that keeps
calling tools is cut off and made to answer. The soft deadline sits well under
the platform's hard 30s kill, which cannot be caught once it fires.

`showProducts` is enriched server-side into full cards rather than answered with
a follow-up fetch from the widget, so cards appear in the same paint as the
sentence describing them.

---

## Feed ingestion

`src/lib/feed/` is split so the rules are testable without a network or a
database: `parse.ts` turns bytes into plain objects, `normalize.ts` turns plain
objects into `Product`s, and only `normalize.ts` holds judgement.

**The design rule: a field we cannot derive with confidence is left undefined
rather than guessed.** A wrong `garmentType` puts a jacket in the trousers slot
of an outfit; a missing one only costs a styling nuance.

The one exception is `department`, which **rejects the row**. The source product
proved why: gender was optional there and every reader fell back to `"women"`,
so a men's piece added without the tag silently joined the women's department
and its outfit checks. A product missing from the catalog is a gap the brand can
see and fix; a product in the wrong department is an error the customer sees
first.

**Turkish matching.** Category fields are written by humans, so the same garment
arrives as "Ceket", "Erkek Ceketi", "Ceketler". A `\b`-anchored regex matches
only the first — `\b` is ASCII-word based, so it both fails on the suffix and
misfires around ş/ğ/ı/ü/ö/ç. The fix is to fold to ASCII, tokenise, and match by
prefix, with keywords under four characters requiring an exact match ("mor",
"bot", "şal" are prefixes of unrelated words). This was found by a test, not in
production.

**Prices are integer minor units.** `12.900,00` and `12,900.00` differ by 1000×
depending on which separator is decimal; the one appearing LAST is decimal, and
a 3-digit tail is a thousands group. Floats are never used — a catalog that
misprices by a kuruş is one no merchandiser trusts again.

Two guards make `/api/feed/sync` safe on a cron: a parse failure or empty result
never clears the catalog, and a sync that would delete more than 40% of it stops
and reports. Both are the shape of a truncated feed, not a sale.

The sync returns a **report**, not a count. Naming the rejected rows and why is
what makes the brand fix its data instead of us accumulating per-brand
exceptions.

---

## Cost is not price

`tenant_usage.total_cost` is what the provider charges us. It is computed by
`log_tenant_usage` (SECURITY DEFINER) from `ai_model_pricing`, so the browser
can only ever send token counts and never a cost.

`tenant_usage_monthly.conversations` is what the brand is billed on, and it
counts **distinct sessions**, not messages. A customer who asks eight questions
had one conversation.

Both tables are service-role only. The source product learned this the hard way:
its cost ledger sat at `is_admin()` while admin access was about to be granted
to a prospect, which would have handed them our per-call USD cost and turned
every commercial conversation into a cost-plus negotiation. Hiding the rate card
alone is not enough — cost ÷ tokens reconstructs it.

Rates live in the database rather than in code because provider prices changed
twice in the month before this was written. Re-rating a period is an UPDATE.

---

## Rate limiting, honestly

`src/lib/security/ratelimit.ts` keeps counters in-process, so on a serverless
platform each instance has its own and the effective limit is looser than
configured. That is deliberate for v1: it stops the runaway cases that actually
happen without putting a Redis round-trip in front of every message.

The hard monthly cap in the database is what actually bounds the bill. This
shapes bursts.

---

## What is deliberately absent

**Ranking.** The catalog narrows honestly; the model does the styling judgement.
A scoring function here would be a second, worse stylist competing with the
first.

**A conversation store.** History lives in the widget and is sent with each
request. Nothing about a customer's conversation is persisted, which is what
makes the privacy claim in `docs/EMBED-API.md` true rather than aspirational.

**Analytics depth.** A fixed event vocabulary, a sku, a size. No page URLs, no
referrers, no visitor identifiers. "We do not track your customers" is worth
more in the sale than any extra dimension.
