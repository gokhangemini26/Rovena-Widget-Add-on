# Rovena — AI Stylist Add-on

Embeddable, multi-tenant AI stylist for fashion brands. A brand pastes one line
into its site and gets a stylist that knows its catalog, builds outfits from it,
and hands the customer back to the brand's own product pages and cart.

```html
<script src="https://widget.rovena.ai/rovena.js" data-tenant="giovane-gentile" defer></script>
```

Derived from the ROVENA single-brand product, which is a full storefront with a
hard-coded catalog, palette and voice. **That repository is the source, not a
dependency** — nothing here imports from it, and nothing here should be merged
back into it.

---

## What is different from the source product

| | ROVENA (source) | This add-on |
|---|---|---|
| Brands | One, hard-coded | Many, one row + one JSON each |
| Catalog | TypeScript array in the repo | Brand's own XML/JSON feed |
| Surface | A whole website | An iframe on the brand's site |
| Cart | Its own | The brand's, via a bridge |
| Stock | Assumed | Assumed / feed / live endpoint |
| Metering | Per user | Per tenant, with a billing view |

Onboarding a brand must never require a code change. If it does, the difference
belongs in `src/lib/tenant/types.ts` instead.

---

## Run it

```bash
npm install
cp .env.example .env.local   # set GEMINI_API_KEY, keep ROVENA_LOCAL_TENANTS=1
npm run dev
```

Then open **http://localhost:3000/demo/giovane-gentile** — a stand-in storefront
that loads the real loader script the way a brand would.

`ROVENA_LOCAL_TENANTS=1` serves tenants and catalogs from `tenants/*.json` with
no database at all, which is the mode the widget gets demonstrated in.

```bash
npm test        # feed normalisation (29 tests)
npm run build
npm run typecheck
```

---

## Layout

```
public/rovena.js              the one line a brand pastes; dependency-free, un-built
src/app/embed/[tenant]        the framed widget
src/app/demo/[tenant]         a stand-in storefront for demos and integration testing
src/app/api/chat              streaming NDJSON conversation + tool loop
src/app/api/feed/sync         pull a brand's feed, normalise it, report on it
src/app/api/config/[tenant]   the public config the loader needs to paint
src/app/api/events            the brand-facing funnel
src/lib/tenant                Tenant type — the schema for everything brand-specific
src/lib/feed                  feed → Product normalisation (pure, tested)
src/lib/catalog               CatalogProvider seam + Supabase/memory implementations
src/lib/inventory             the stock contract
src/lib/ai                    prompt assembly and the tool surface
src/lib/metering              per-tenant usage → billing
src/lib/security              origin allowlist, rate limits
supabase/migrations           multi-tenant schema
tenants/                      one JSON per brand (local mode); production reads `tenants`
```

---

## Three things worth knowing before changing anything

**The stock contract.** Availability is never a product field, never in the
catalog projection, never in the system prompt. It reaches a conversation only
as the return value of `checkStock`, and the exact sentence the model may say
comes from `stockPhrasing()`. A brand with no stock system gets a stylist that
says "koleksiyonda listeli" and never "stokta var". This is the behaviour a
fashion brand actually buys; do not let a prompt edit weaken it.

**Static prompt vs turn context.** `buildStaticPrompt` takes no per-request
argument, so it is byte-identical for every visitor of a tenant and stays
eligible for prefix caching. The catalog is most of the prompt, so one volatile
string leaking into it multiplies the bill. Volatile facts go in
`buildTurnContext`.

**Cost and price are different numbers.** `tenant_usage.total_cost` is what the
provider charges us. `tenant_usage_monthly.conversations` is what the brand is
billed on. They live in different columns computed from different inputs, and
the cost column is service-role only — the same lesson the source product
learned the hard way.

---

## Status

Working and verified end to end: loader and iframe boundary, per-tenant theming,
streaming chat with the tool loop, catalog grounding, outfit building, product
cards, size-gated add-to-cart across all three bridge modes, the stock contract,
the department lock, origin allowlisting, rate limits, feed normalisation with a
brand-facing report, per-tenant metering, and the billing/funnel views.

Not built yet, in rough order of commercial value:

1. **Virtual try-on.** The seam is here; the pipeline and its cache are in the
   source product and need porting plus per-brand reference photography.
2. **Brand console.** The funnel and product-performance views exist in SQL with
   no UI in front of them; brands see the numbers today only if we send them.
3. **Voice.** Same shape as the source product's Live integration, gated behind
   sign-in there and needing a per-tenant equivalent here.
4. **Explicit context caching.** Implicit prefix caching applies today; the
   source product's explicit cache handling is a further cost reduction.
5. **Distributed rate limiting.** Counters are per-instance; the monthly cap in
   the database is what actually bounds spend.
