-- ════════════════════════════════════════════════════════════════════════════
-- Usage metering and billing.
--
-- This is the commercial spine of the add-on: the only thing that makes
-- "€900/month including 1.500 conversations, then per conversation" a
-- defensible invoice rather than an estimate.
--
-- Two deliberate separations:
--
-- 1. RATES live in `ai_model_pricing`, not in application code. Provider prices
--    changed twice in the month before this was written; re-rating a period is
--    an UPDATE, and the browser can only ever send token counts — never a cost.
--
-- 2. COST (what we pay) and PRICE (what the brand pays) are different columns
--    computed from different rate cards. Conflating them is how an add-on ends
--    up quoting cost-plus to a customer who then negotiates the plus away.
--    `total_cost` is ours; `billable_units` is theirs.
-- ════════════════════════════════════════════════════════════════════════════

-- ── what the provider charges us (USD per 1,000,000 tokens) ─────────────────
create table if not exists public.ai_model_pricing (
  model        text primary key,
  label        text,
  kind         text check (kind in ('chat', 'image', 'voice')),
  text_input   numeric not null default 0,
  cached_input numeric not null default 0,
  audio_input  numeric not null default 0,
  image_input  numeric not null default 0,
  text_output  numeric not null default 0,  -- thinking tokens bill at this rate
  audio_output numeric not null default 0,
  image_output numeric not null default 0,
  version      text not null default '2026-08',
  updated_at   timestamptz default now()
);

insert into public.ai_model_pricing
  (model, label, kind, text_input, cached_input, audio_input, image_input, text_output, audio_output, image_output)
values
  ('gemini-3.6-flash',            'Gemini 3.6 Flash',            'chat',  1.50, 0.15, 0.00, 0.00,  7.50,  0.00,   0.00),
  ('gemini-3.5-flash-lite',       'Gemini 3.5 Flash-Lite',       'chat',  0.30, 0.03, 0.00, 0.00,  2.50,  0.00,   0.00),
  ('gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite',          'image', 0.25, 0.025,0.00, 0.25,  1.50,  0.00,  30.00),
  ('gemini-3.1-flash-live-preview','Gemini 3.1 Flash Live',      'voice', 0.50, 0.05, 3.00, 0.00,  2.00, 12.00,   0.00)
on conflict (model) do update set
  label = excluded.label, kind = excluded.kind,
  text_input = excluded.text_input, cached_input = excluded.cached_input,
  audio_input = excluded.audio_input, image_input = excluded.image_input,
  text_output = excluded.text_output, audio_output = excluded.audio_output,
  image_output = excluded.image_output, updated_at = now();

alter table public.ai_model_pricing enable row level security;
-- Service role only. The rate card is our cost base; it is never exposed to a
-- brand's dashboard, and per-call cost ÷ per-call tokens reconstructs it, which
-- is why tenant_usage below is service-role too.

-- ── per-call ledger ─────────────────────────────────────────────────────────
create table if not exists public.tenant_usage (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  tenant_slug    text not null references public.tenants(slug) on delete cascade,
  session_id     text,
  kind           text not null check (kind in ('chat', 'image', 'voice')),
  model          text not null,

  input_text     integer not null default 0,
  input_cached   integer not null default 0,
  input_audio    integer not null default 0,
  input_image    integer not null default 0,
  output_text    integer not null default 0,
  output_audio   integer not null default 0,
  output_image   integer not null default 0,
  total_tokens   integer not null default 0,

  -- OUR cost, USD.
  input_cost     numeric not null default 0,
  output_cost    numeric not null default 0,
  total_cost     numeric not null default 0,
  price_version  text,

  -- WHAT WE BILL: one chat turn = 1 message; a conversation is a session, and
  -- billing counts distinct sessions per month, not rows. Keeping the unit
  -- explicit here means the invoice never depends on how the code happened to
  -- batch requests.
  billable_units integer not null default 1,

  cached         boolean not null default false,
  meta           jsonb
);

create index if not exists idx_usage_tenant_time on public.tenant_usage(tenant_slug, created_at desc);
create index if not exists idx_usage_session     on public.tenant_usage(session_id);

alter table public.tenant_usage enable row level security;

-- ── logger ──────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so metering works from any server context without handing
-- the rate card to the caller. An unknown model is still LOGGED (tokens
-- visible, cost 0) — a missing rate must never lose the usage record, because
-- the record is what the invoice is built from.
create or replace function public.log_tenant_usage(
  p_tenant_slug  text,
  p_session_id   text,
  p_kind         text,
  p_model        text,
  p_input_text   integer default 0,
  p_input_cached integer default 0,
  p_input_audio  integer default 0,
  p_input_image  integer default 0,
  p_output_text  integer default 0,
  p_output_audio integer default 0,
  p_output_image integer default 0,
  p_cached       boolean default false,
  p_meta         jsonb   default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pr         public.ai_model_pricing%rowtype;
  v_in       numeric := 0;
  v_out      numeric := 0;
  v_total    integer;
  v_id       uuid;
begin
  if p_kind is null or p_kind not in ('chat', 'image', 'voice') then return null; end if;
  if p_model is null or length(p_model) = 0 then return null; end if;
  if p_tenant_slug is null then return null; end if;

  select * into pr from public.ai_model_pricing where model = p_model;

  if not coalesce(p_cached, false) and found then
    v_in := (
        coalesce(p_input_text, 0)   * pr.text_input
      + coalesce(p_input_cached, 0) * pr.cached_input
      + coalesce(p_input_audio, 0)  * pr.audio_input
      + coalesce(p_input_image, 0)  * pr.image_input
    ) / 1000000.0;
    v_out := (
        coalesce(p_output_text, 0)  * pr.text_output
      + coalesce(p_output_audio, 0) * pr.audio_output
      + coalesce(p_output_image, 0) * pr.image_output
    ) / 1000000.0;
  end if;

  v_total := coalesce(p_input_text, 0) + coalesce(p_input_cached, 0)
           + coalesce(p_input_audio, 0) + coalesce(p_input_image, 0)
           + coalesce(p_output_text, 0) + coalesce(p_output_audio, 0)
           + coalesce(p_output_image, 0);

  insert into public.tenant_usage (
    tenant_slug, session_id, kind, model,
    input_text, input_cached, input_audio, input_image,
    output_text, output_audio, output_image, total_tokens,
    input_cost, output_cost, total_cost, price_version, cached, meta
  ) values (
    p_tenant_slug, p_session_id, p_kind, p_model,
    coalesce(p_input_text, 0), coalesce(p_input_cached, 0),
    coalesce(p_input_audio, 0), coalesce(p_input_image, 0),
    coalesce(p_output_text, 0), coalesce(p_output_audio, 0),
    coalesce(p_output_image, 0), v_total,
    v_in, v_out, v_in + v_out, pr.version, coalesce(p_cached, false), p_meta
  ) returning id into v_id;

  return v_id;
end $$;

-- ── the billing view ────────────────────────────────────────────────────────
-- What an invoice is built from. Conversations are DISTINCT SESSIONS, not
-- messages: a customer who asks eight questions had one conversation, and
-- billing them for eight is the fastest way to lose the account.
create or replace view public.tenant_usage_monthly as
select
  tenant_slug,
  date_trunc('month', created_at)                        as month,
  count(distinct session_id) filter (where kind = 'chat') as conversations,
  count(*) filter (where kind = 'chat')                   as messages,
  count(*) filter (where kind = 'image' and not cached)   as images_generated,
  count(*) filter (where kind = 'image' and cached)       as images_from_cache,
  round(sum(total_cost)::numeric, 4)                      as provider_cost_usd,
  sum(total_tokens)                                       as tokens
from public.tenant_usage
group by 1, 2;

comment on view public.tenant_usage_monthly is
  'Invoice source. conversations = distinct sessions, which is the contracted unit; messages is diagnostic only. provider_cost_usd is OUR cost and must never be shown to a brand.';
