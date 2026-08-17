-- ════════════════════════════════════════════════════════════════════════════
-- Normalised catalog, one row per product per tenant.
--
-- Written only by the feed sync route (service role). Read only by the server.
-- The browser never sees this table: the widget receives the handful of fields
-- it needs, already filtered, in the chat stream.
--
-- `active` rather than DELETE: a sku that drops out of one feed run and returns
-- in the next keeps its identity, and a bad sync is reversible with an UPDATE.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_products (
  tenant_slug   text not null references public.tenants(slug) on delete cascade,
  sku           text not null,

  name          text not null,
  name_en       text,
  department    text not null check (department in ('women', 'men', 'unisex')),
  category      text not null default '',
  garment_type  text not null default 'unknown',

  color         text,
  color_family  text,
  composition   text,
  fabrics       jsonb not null default '[]'::jsonb,
  seasons       text[] not null default '{}',

  -- Integer minor units. Never numeric-from-float: a catalog that misprices by
  -- a kuruş is one no merchandiser trusts again.
  price_minor   bigint not null check (price_minor >= 0),
  currency      text   not null default 'TRY',
  price_display text   not null,

  size_system   text,
  variants      jsonb not null default '[]'::jsonb,

  image_main    text not null,
  image_detail  text,
  image_model   text,
  product_url   text not null,
  description   text,
  care          text,
  related_skus  text[] not null default '{}',

  active        boolean not null default true,
  synced_at     timestamptz not null default now(),

  primary key (tenant_slug, sku)
);

create index if not exists idx_products_tenant_active
  on public.tenant_products(tenant_slug) where active;
create index if not exists idx_products_department
  on public.tenant_products(tenant_slug, department) where active;
create index if not exists idx_products_garment
  on public.tenant_products(tenant_slug, garment_type) where active;

alter table public.tenant_products enable row level security;
-- Service role only. See tenants.sql.

-- ── feed runs ───────────────────────────────────────────────────────────────
-- The audit trail that makes "your feed is missing colour on 400 products" a
-- conversation with evidence rather than an opinion.
create table if not exists public.feed_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_slug text not null references public.tenants(slug) on delete cascade,
  ok          boolean not null,
  fetched     integer not null default 0,
  imported    integer not null default 0,
  rejected    integer not null default 0,
  removed     integer not null default 0,
  issues      jsonb   not null default '[]'::jsonb,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_feed_runs_tenant
  on public.feed_runs(tenant_slug, created_at desc);

alter table public.feed_runs enable row level security;
