import { after } from "next/server";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { serviceClient } from "@/lib/supabase/service";
import { corsHeaders, isAllowedOrigin, requestOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";

/* POST /api/events — the brand-facing funnel.

   Deliberately narrow: a fixed set of event names, a sku, and a size. No free
   text, no page URLs, no identifiers. What a brand needs (does the widget sell
   anything) is answered by counts; anything more would make this a tracker the
   brand has to disclose, and turn a selling point into a legal review. */

const ALLOWED_EVENTS = new Set([
  "widget_open",
  "widget_close",
  "message_sent",
  "products_shown",
  "product_clicked",
  "add_to_cart",
  "cart_bridge_failed",
  // Page control. `page_action_failed` is the one that earns its place: a
  // stylist scrolling to a section the brand never tagged is indistinguishable
  // from a broken AI unless the miss is counted.
  "page_scrolled",
  "page_navigated",
  "page_action_failed",
  "cart_opened",
  "cart_closed",
  "try_on_rendered",
]);

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin(req)) });
}

export async function POST(req: Request) {
  const origin = requestOrigin(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const slug = typeof body.tenant === "string" ? body.tenant : "";
  const tenant = await getActiveTenant(slug);
  if (!tenant) return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (!isAllowedOrigin(tenant, origin)) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const name = typeof body.event === "string" ? body.event : "";
  if (!ALLOWED_EVENTS.has(name)) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  const sku = typeof body.sku === "string" ? body.sku.slice(0, 64) : null;
  const size = typeof body.size === "string" ? body.size.slice(0, 16) : null;

  after(async () => {
    const supabase = serviceClient();
    if (!supabase) return;
    await supabase.from("widget_events").insert({
      tenant_slug: slug, session_id: sessionId, event: name, sku, size,
    });
  });

  // 204 with no body: this is fire-and-forget from a page we do not own, and
  // nothing the widget does should wait on analytics.
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
