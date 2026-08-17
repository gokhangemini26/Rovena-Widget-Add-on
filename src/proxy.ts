import { NextResponse, type NextRequest } from "next/server";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { frameAncestors } from "@/lib/security/origin";

/* The widget is meant to be framed — by exactly one brand's sites and nobody
   else's. X-Frame-Options cannot express an allowlist, so /embed/<tenant> gets
   a per-tenant Content-Security-Policy built from that tenant's own origins at
   request time. next.config.ts keeps the blanket DENY on every other path.

   Proxy always runs on Node.js, which is what makes resolving the tenant here
   possible at all — it reads the database (or, in demo mode, ./tenants/*.json).
   This is also the only place a per-request response header can be attached to
   a page render.

   Route segment config is not permitted in a proxy file, so the path filter is
   an early return rather than a `matcher`: every other request must fall
   through untouched and pay nothing. */

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/embed/")) return NextResponse.next();

  const slug = pathname.split("/")[2] ?? "";
  const tenant = await getActiveTenant(slug);

  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  // The widget must not leak the brand's page URL to us or to anyone the page
  // links out to.
  res.headers.set("Referrer-Policy", "no-referrer");

  if (!tenant) {
    res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    return res;
  }

  res.headers.set("Content-Security-Policy", frameAncestors(tenant));
  return res;
}
