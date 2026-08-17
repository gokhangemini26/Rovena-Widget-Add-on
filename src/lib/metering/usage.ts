import "server-only";
import { serviceClient } from "@/lib/supabase/service";

/* ═══════════════════════════════════════════════════════════════════════════
   Usage metering — the commercial spine of the add-on.

   Every model call is priced per tenant from a rate card held in the database,
   never in this file. Two reasons: the browser can only ever send token counts
   (it cannot fake a cost), and re-rating a month after a provider price change
   is an UPDATE rather than a redeploy.

   Billing reads `tenant_usage_daily`, not this table directly — see
   supabase/migrations/…_usage.sql. Metering is best-effort and never allowed
   to break a customer's conversation: a lost usage row costs us cents, a
   thrown error costs the brand a sale.
   ═══════════════════════════════════════════════════════════════════════════ */

export type UsageKind = "chat" | "image" | "voice";

export interface UsageModalities {
  input_text: number;
  input_cached: number;
  input_audio: number;
  input_image: number;
  output_text: number;
  output_audio: number;
  output_image: number;
  total_tokens: number;
}

interface TokenDetail { modality?: string; tokenCount?: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
function num(v: any): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

function byModality(details: TokenDetail[] | undefined, modality: string): number {
  if (!Array.isArray(details)) return 0;
  return details
    .filter((d) => (d?.modality || "").toUpperCase() === modality)
    .reduce((a, d) => a + num(d?.tokenCount), 0);
}

/** Normalise a Gemini usageMetadata object into flat per-modality counts.

    The reconciliation at the end matters commercially: some responses report
    tool-use prompt tokens outside the per-modality breakdown, and any gap
    between the parts and totalTokenCount is folded back into text input. The
    ledger therefore always equals what the provider bills us, which is the
    only way an invoice to a brand can be defended line by line. */
export function extractUsage(usage: any, kind: UsageKind): UsageModalities {
  const promptTotal = num(usage?.promptTokenCount);
  const candTotal = num(usage?.candidatesTokenCount);
  const cached = num(usage?.cachedContentTokenCount);
  const thoughts = num(usage?.thoughtsTokenCount);

  const promptDetails: TokenDetail[] = usage?.promptTokensDetails || [];
  const candDetails: TokenDetail[] = usage?.candidatesTokensDetails || [];

  let input_audio = byModality(promptDetails, "AUDIO");
  const input_image = byModality(promptDetails, "IMAGE");
  let input_text: number;

  if (promptDetails.length) {
    input_text = Math.max(0, promptTotal - input_audio - input_image - cached);
  } else if (kind === "voice") {
    input_audio = Math.max(0, promptTotal - cached);
    input_text = 0;
  } else {
    input_text = Math.max(0, promptTotal - cached);
  }

  let output_audio = byModality(candDetails, "AUDIO");
  let output_image = byModality(candDetails, "IMAGE");
  let output_text: number;

  if (candDetails.length) {
    output_text = Math.max(0, candTotal - output_audio - output_image) + thoughts;
  } else if (kind === "image") {
    output_image = candTotal;
    output_text = thoughts;
  } else if (kind === "voice") {
    output_audio = candTotal;
    output_text = thoughts;
  } else {
    output_text = candTotal + thoughts;
  }

  const reported = num(usage?.totalTokenCount);
  let total =
    input_text + cached + input_audio + input_image +
    output_text + output_audio + output_image;
  if (reported > total) {
    input_text += reported - total;
    total = reported;
  }

  return {
    input_text, input_cached: cached, input_audio, input_image,
    output_text, output_audio, output_image, total_tokens: total,
  };
}

export async function logUsage(opts: {
  tenantSlug: string;
  sessionId: string | null;
  kind: UsageKind;
  model: string;
  usageMetadata: unknown;
  cached?: boolean;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  if (!opts.usageMetadata && !opts.cached) return;
  const supabase = serviceClient();
  if (!supabase) return;

  const m = extractUsage(opts.usageMetadata, opts.kind);
  try {
    await supabase.rpc("log_tenant_usage", {
      p_tenant_slug: opts.tenantSlug,
      p_session_id: opts.sessionId,
      p_kind: opts.kind,
      p_model: opts.model,
      p_input_text: m.input_text,
      p_input_cached: m.input_cached,
      p_input_audio: m.input_audio,
      p_input_image: m.input_image,
      p_output_text: m.output_text,
      p_output_audio: m.output_audio,
      p_output_image: m.output_image,
      p_cached: opts.cached ?? false,
      p_meta: opts.meta ?? null,
    });
  } catch {
    /* best-effort: never break the customer's conversation to record a cent */
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
