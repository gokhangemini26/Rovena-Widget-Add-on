-- ════════════════════════════════════════════════════════════════════════════
-- Widget funnel.
--
-- Deliberately thin. A fixed event vocabulary, a sku, a size, a random session
-- id — no page URLs, no referrers, no visitor identifiers, nothing that follows
-- a person between sites. That is a product decision as much as a legal one:
-- a brand's counsel signs off on this in one reading, and "we do not track your
-- customers" is a sentence worth more in the sale than any extra dimension.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.widget_events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  tenant_slug text not null references public.tenants(slug) on delete cascade,
  session_id  text,
  event       text not null check (event in (
                'widget_open', 'widget_close', 'message_sent', 'products_shown',
                'product_clicked', 'add_to_cart', 'cart_bridge_failed'
              )),
  sku         text,
  size        text
);

create index if not exists idx_events_tenant_time on public.widget_events(tenant_slug, created_at desc);
create index if not exists idx_events_name        on public.widget_events(tenant_slug, event);
create index if not exists idx_events_sku         on public.widget_events(tenant_slug, sku) where sku is not null;

alter table public.widget_events enable row level security;

-- ── the two views a brand actually asks for ─────────────────────────────────

create or replace view public.tenant_funnel_daily as
select
  tenant_slug,
  date_trunc('day', created_at) as day,
  count(distinct session_id) filter (where event = 'widget_open')     as opened,
  count(distinct session_id) filter (where event = 'message_sent')    as engaged,
  count(distinct session_id) filter (where event = 'products_shown')  as saw_products,
  count(distinct session_id) filter (where event = 'product_clicked') as clicked,
  count(distinct session_id) filter (where event = 'add_to_cart')     as added_to_cart,
  -- A brand's own cart function throwing looks identical to "the AI is bad"
  -- from the outside. Surfacing it as its own number is what turns a support
  -- argument into a one-line answer.
  count(*) filter (where event = 'cart_bridge_failed')                as cart_failures
from public.widget_events
group by 1, 2;

create or replace view public.tenant_product_performance as
select
  tenant_slug,
  sku,
  count(*) filter (where event = 'products_shown')  as times_shown,
  count(*) filter (where event = 'product_clicked') as times_clicked,
  count(*) filter (where event = 'add_to_cart')     as times_added,
  count(*) filter (where event = 'add_to_cart')::numeric
    / nullif(count(*) filter (where event = 'products_shown'), 0) as add_rate
from public.widget_events
where sku is not null
group by 1, 2;

comment on view public.tenant_product_performance is
  'Which pieces the stylist actually converts. The merchandising signal a brand cannot get from its own analytics, and the reason the panel is worth showing in a renewal conversation.';
