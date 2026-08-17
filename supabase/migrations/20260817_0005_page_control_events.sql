-- Page control and try-on added new funnel events; the CHECK constraint from
-- 20260817_0004 would silently reject them at insert time (the events route is
-- fire-and-forget, so the rows would just never appear and the panel would
-- under-report rather than error).
--
-- `page_action_failed` is the one worth having: a stylist that scrolls to a
-- section the brand never tagged with data-rovena-section looks identical to a
-- broken AI from the outside. Counting the miss is what makes that a one-line
-- answer in a support thread instead of an argument.

alter table public.widget_events drop constraint if exists widget_events_event_check;

alter table public.widget_events add constraint widget_events_event_check
  check (event in (
    'widget_open', 'widget_close', 'message_sent', 'products_shown',
    'product_clicked', 'add_to_cart', 'cart_bridge_failed',
    'page_scrolled', 'page_navigated', 'page_action_failed',
    'cart_opened', 'cart_closed', 'try_on_rendered'
  ));

-- Page control is only worth selling if the brand can see it working. Failures
-- are separated from successes because they have different owners: a miss is
-- almost always a missing data-rovena-section on the brand's side.
create or replace view public.tenant_page_control_daily as
select
  tenant_slug,
  date_trunc('day', created_at)                          as day,
  count(*) filter (where event = 'page_scrolled')        as scrolls,
  count(*) filter (where event = 'page_navigated')       as category_opens,
  count(*) filter (where event = 'cart_opened')          as cart_opens,
  count(*) filter (where event = 'try_on_rendered')      as try_ons,
  count(*) filter (where event = 'page_action_failed')   as failed_actions
from public.widget_events
group by 1, 2;

comment on view public.tenant_page_control_daily is
  'Does the stylist actually drive the brand''s page. failed_actions is normally a missing data-rovena-section attribute on the brand''s markup, not a model error.';
