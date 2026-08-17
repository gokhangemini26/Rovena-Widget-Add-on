-- ════════════════════════════════════════════════════════════════════════════
-- Tenants — one row per brand running the add-on.
--
-- Columns hold what has to be QUERYABLE (slug lookup, status filtering, origin
-- checks). Everything else lives in `config` jsonb, so onboarding a brand with
-- a new knob is an UPDATE rather than a migration + deploy. The typed shape of
-- `config` is src/lib/tenant/types.ts; that file is the schema.
--
-- RLS: nothing here is reachable with the anon key. The widget never queries
-- this table from the browser — the server resolves the tenant and hands the
-- browser a stripped public subset. A brand's feed URL and stock credentials
-- are in `config`, and one permissive policy would leak every brand's.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists public.tenants (
  slug             text primary key
                   check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name             text not null,
  status           text not null default 'trial'
                   check (status in ('active', 'paused', 'trial')),
  allowed_origins  text[] not null default '{}',
  config           jsonb  not null default '{}'::jsonb,
  -- Commercial fields, read by billing rather than by the widget.
  plan             text default 'atelier',
  contract_start   date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_tenants_status on public.tenants(status);

alter table public.tenants enable row level security;
-- No policies, by design: service-role only. Adding a policy here should be a
-- deliberate decision with a comment explaining who is being let in.

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_tenants_touch on public.tenants;
create trigger trg_tenants_touch before update on public.tenants
  for each row execute function public.touch_updated_at();

comment on column public.tenants.allowed_origins is
  'Exact scheme+host+port origins allowed to embed and call the API. No wildcards: this list is the only boundary between a brand''s paid widget and anyone else framing it.';
comment on column public.tenants.config is
  'Theme, persona, feed mapping, inventory mode, cart bridge, limits. Typed by src/lib/tenant/types.ts.';
