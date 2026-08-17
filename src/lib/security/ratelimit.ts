/* ═══════════════════════════════════════════════════════════════════════════
   Rate limiting.

   Commercial, not just technical: the add-on bills per conversation, and an
   unmetered endpoint on a public page is a way for someone to spend a brand's
   monthly quota in an afternoon. Two independent windows — per IP (abuse) and
   per session (a stuck client looping) — because each catches what the other
   misses.

   In-process, so on a serverless platform each instance keeps its own counters
   and the effective limit is looser than the number configured. That is
   deliberate for v1: it stops the runaway cases that actually happen without
   putting a Redis round-trip in front of every message. The hard monthly cap
   in the database is what actually bounds the bill; this only shapes bursts.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Window { count: number; resetAt: number }

const ipWindows = new Map<string, Window>();
const sessionCounts = new Map<string, Window>();

const MINUTE_MS = 60_000;
const SESSION_TTL_MS = 6 * 60 * 60_000;

function sweep(map: Map<string, Window>, now: number): void {
  if (map.size < 5_000) return;
  for (const [key, w] of map) if (w.resetAt < now) map.delete(key);
}

export interface RateVerdict {
  ok: boolean;
  reason?: "rate_limited" | "session_exhausted";
  retryAfterSeconds?: number;
}

export function checkRate(opts: {
  ip: string;
  sessionId: string;
  requestsPerMinute: number;
  messagesPerSession: number;
}): RateVerdict {
  const now = Date.now();
  sweep(ipWindows, now);
  sweep(sessionCounts, now);

  const ipKey = opts.ip;
  const ipWindow = ipWindows.get(ipKey);
  if (!ipWindow || ipWindow.resetAt < now) {
    ipWindows.set(ipKey, { count: 1, resetAt: now + MINUTE_MS });
  } else {
    ipWindow.count += 1;
    if (ipWindow.count > opts.requestsPerMinute) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: Math.max(1, Math.ceil((ipWindow.resetAt - now) / 1000)),
      };
    }
  }

  const sessionWindow = sessionCounts.get(opts.sessionId);
  if (!sessionWindow || sessionWindow.resetAt < now) {
    sessionCounts.set(opts.sessionId, { count: 1, resetAt: now + SESSION_TTL_MS });
  } else {
    sessionWindow.count += 1;
    if (sessionWindow.count > opts.messagesPerSession) {
      return { ok: false, reason: "session_exhausted" };
    }
  }

  return { ok: true };
}

/** Client IP behind Vercel's proxy. Falls back to a constant so a missing
    header degrades to "one shared bucket" rather than "no limit at all". */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
