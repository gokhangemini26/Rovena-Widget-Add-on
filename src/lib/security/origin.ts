import type { Tenant } from "@/lib/tenant/types";

/* ═══════════════════════════════════════════════════════════════════════════
   Origin allowlisting.

   The widget is served cross-origin by design, so "same-origin" protects
   nothing here. The tenant's `allowedOrigins` list IS the boundary: it decides
   who may frame the widget (CSP frame-ancestors), whose fetches get CORS
   headers, and — because usage is billed per tenant — who can spend a brand's
   quota. An unlisted origin is refused rather than silently served.

   Matching is exact on scheme+host+port. Wildcards are not supported on
   purpose: `*.example.com` includes whatever subdomain an attacker can get
   pointed at that zone.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Any localhost port, but only outside production. Pinning a port here means a
    dev server started on 3030 instead of 3000 looks like a permissions bug. */
function isLocalOrigin(origin: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedOrigin(tenant: Tenant, origin: string | null): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  // Own-origin demo pages (/demo/<tenant>) must always work — that is the page
  // the widget is sold from.
  const self = normalizeOrigin(process.env.NEXT_PUBLIC_WIDGET_ORIGIN);
  if (self && normalized === self) return true;
  if (isLocalOrigin(normalized)) return true;
  return tenant.allowedOrigins.some((o) => normalizeOrigin(o) === normalized);
}

/** The Origin header is absent on same-origin navigations; Referer is the
    fallback the browser still sends when a page is framed. */
export function requestOrigin(req: Request): string | null {
  return (
    normalizeOrigin(req.headers.get("origin")) ??
    normalizeOrigin(req.headers.get("referer"))
  );
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Every origin permitted to frame this tenant's widget, or to be addressed by
    its postMessage calls. One list, so the CSP header and the embed page's
    host-origin check can never disagree. */
export function allowedFrameOrigins(tenant: Tenant): string[] {
  const list = [
    ...tenant.allowedOrigins.map(normalizeOrigin),
    normalizeOrigin(process.env.NEXT_PUBLIC_WIDGET_ORIGIN),
  ].filter((o): o is string => Boolean(o));
  return [...new Set(list)];
}

/** CSP value that lets exactly the tenant's own sites frame the widget. */
export function frameAncestors(tenant: Tenant): string {
  const list = allowedFrameOrigins(tenant);
  if (process.env.NODE_ENV !== "production") list.push("http://localhost:*", "http://127.0.0.1:*");
  return `frame-ancestors 'self' ${list.join(" ")}`.trim();
}
