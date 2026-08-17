import { notFound } from "next/navigation";
import { getActiveTenant } from "@/lib/tenant/resolve";
import { toPublicConfig } from "@/lib/tenant/types";
import { isAllowedOrigin, normalizeOrigin } from "@/lib/security/origin";
import { Widget } from "@/components/Widget";
import "@/components/widget.css";

export const dynamic = "force-dynamic";

/* The framed surface. Resolves the tenant server-side and hands the widget a
   config that has already been stripped to the public subset — the browser
   never receives a feed URL or a stock credential even for a moment. */

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ host?: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await getActiveTenant(slug);
  if (!tenant) notFound();

  const { host } = await searchParams;
  // The loader tells us who framed it. We only echo it back as a postMessage
  // target after checking it is one of this tenant's own origins, so a rogue
  // framer cannot make the widget address messages to itself. Reusing
  // isAllowedOrigin keeps this identical to the check the API routes apply.
  const claimed = normalizeOrigin(host);
  const hostOrigin = claimed && isAllowedOrigin(tenant, claimed) ? claimed : "";

  const t = tenant.theme;
  const vars = [
    `--rv-accent:${t.accent}`,
    `--rv-accent-ink:${t.accentInk}`,
    `--rv-surface:${t.surface}`,
    `--rv-ink:${t.ink}`,
    `--rv-muted:${t.muted}`,
    `--rv-line:${t.line}`,
    `--rv-radius:${t.radius}`,
    `--rv-font-display:${t.fontDisplay}`,
    `--rv-font-body:${t.fontBody}`,
    // Derived, not configured: brands consistently pick two colours and stop,
    // and asking for a third produces worse results than deriving one.
    `--rv-assistant-bg:color-mix(in srgb, ${t.ink} 6%, ${t.surface})`,
  ].join(";");

  return (
    <>
      {t.fontUrl && <link rel="stylesheet" href={t.fontUrl} />}
      <style>{`html,body,#rv-shell{height:100%} :root{${vars}}`}</style>
      <div id="rv-shell">
        <Widget config={toPublicConfig(tenant)} hostOrigin={hostOrigin} />
      </div>
    </>
  );
}
