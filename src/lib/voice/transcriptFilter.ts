/* ═══════════════════════════════════════════════════════════════════════════
   Keeping the machinery out of the transcript.

   Verified live (2026-08-17, gemini-3.1-flash-live-preview), TWO separate
   phrasings of the same failure in successive test turns:

     "…kombini tamamlayabiliriz. Nasıl, beğendiniz mi?
      Context: showProducts called successfully."

     "…klasik bir görünüm yakalayabilirsiniz. Bu kombini düşünür müsünüz?
      showProducts function ile ürünleri gösteriyorum."

   Nothing in a functionResponse payload here contains either string — the
   model paraphrases its own tool-call state into speech, a different way
   each time. A filter built from the first phrasing missed the second; the
   source product hit the identical failure class and documented the same
   lesson (system-voice.ts): matching known STRINGS loses to paraphrase.

   The fix that actually holds: match the TOOL NAME instead of the sentence
   around it. "showProducts", "addToCart" etc. are camelCase English
   identifiers that cannot occur in genuine Turkish/English/German/Italian
   customer-facing prose — any sentence containing one is machinery by
   construction, independent of the verb wrapped around it. This is the same
   "unambiguous fence" idea as SYS_FENCE there, borrowing the tool names
   themselves as the marker instead of inserting a new one.

   Still only a net under the prompt rule (src/lib/ai/prompt.ts), and still
   cannot un-speak audio the customer already heard before this ran.
   ═══════════════════════════════════════════════════════════════════════════ */

const TOOL_NAME_PATTERN = /\b(?:searchProducts|getProducts|checkStock|showProducts|addToCart)\b/i;

// Fallback net for a leak that avoids the literal tool name.
const GENERIC_LEAK = /(?:^|[.!?]\s*)(?:context\s*:\s*[^.!?]*[.!?]?|\[?(?:store|system)\s+system[^\]]*\]?\s*[^.!?]*[.!?]?)/gi;

function splitSentences(text: string): string[] {
  // Keeps the delimiter attached to the sentence it ends, so rejoining
  // preserves normal spacing/punctuation.
  return text.match(/[^.!?]+[.!?]*|[^.!?]+$/g) ?? [];
}

export function stripVoiceLeak(raw: string): string {
  if (!raw) return "";
  const kept = splitSentences(raw)
    .filter((sentence) => !TOOL_NAME_PATTERN.test(sentence))
    .join(" ");
  return kept
    .replace(GENERIC_LEAK, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
