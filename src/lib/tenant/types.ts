/* ═══════════════════════════════════════════════════════════════════════════
   Tenant — one brand running Rovena on its own site.

   Everything that differs between brands lives here and NOWHERE else. If a
   second brand needs a code change to onboard, that difference belongs in this
   type instead. That rule is the whole reason the add-on exists: the source
   product (the ROVENA site) hard-codes one brand's catalog, palette and voice,
   which is exactly what makes it unsellable as an add-on.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Locale = "tr" | "en" | "de" | "it";

/** Brand-facing visual configuration. Rendered as CSS custom properties. */
export interface TenantTheme {
  /** Primary brand colour — buttons, the launcher, active states. */
  accent: string;
  /** Text colour used ON the accent. Declared, not derived, so a brand with a
      pale accent can keep legible contrast without us guessing. */
  accentInk: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  /** CSS font-family stacks. The host page's own webfonts are NOT reachable
      from inside the iframe, so a tenant using a custom face must also list a
      `fontUrl`. */
  fontDisplay: string;
  fontBody: string;
  fontUrl?: string;
  radius: number;
  /** Launcher position on the host page. */
  position: "bottom-right" | "bottom-left";
  /** Logo shown in the widget header (absolute URL). */
  logoUrl?: string;
}

/** How the brand's voice and styling rules differ. */
export interface TenantPersona {
  /** What the consultant calls itself to the customer. */
  displayName: string;
  /** One paragraph, in the brand's own words, describing who it is talking to
      and how. Injected verbatim into the system prompt. */
  brief: string;
  /** Hard styling rules the brand insists on ("never pair brown shoes with a
      black suit"). Injected as numbered rules. */
  stylingRules: string[];
  /** Opening line per locale. */
  greeting: Partial<Record<Locale, string>>;
  /** Conversation starters shown as chips before the first message. */
  suggestions: Partial<Record<Locale, string[]>>;
  defaultLocale: Locale;
  locales: Locale[];
}

/** Where the catalog comes from and how its fields are named. */
export interface TenantFeed {
  /** Absolute URL of the brand's product feed. */
  url: string | null;
  format: "xml" | "json";
  /** For XML: the repeating element that represents one product
      (e.g. "Urunler.Urun" or "channel.item"). For JSON: the dotted path to the
      product array (e.g. "products" or "data.items"). */
  itemPath: string;
  /** Source-field → Rovena-field mapping. Values are dotted paths relative to
      one product node. This is what makes "send us the feed you already have"
      true rather than a slogan. */
  map: Record<string, string>;
  /** Static values applied to every product when the feed simply lacks a field
      (a menswear-only brand can set department here instead of editing rows). */
  defaults?: Record<string, string>;
  /** Value translation per field, e.g. { department: { "E": "men" } }. */
  valueMap?: Record<string, Record<string, string>>;
  /** How often we expect the feed to change. Informational; the actual cadence
      is whoever calls /api/feed/sync. */
  refreshHours: number;
}

/** How stock is answered. See docs/ARCHITECTURE.md §"The stock contract". */
export interface TenantInventory {
  mode: "assumed" | "feed" | "endpoint";
  /** mode==="endpoint": URL called with ?sku=&size=, expected to return
      { available: boolean, quantity?: number }. */
  endpointUrl?: string;
  /** Header name/value used to authenticate to endpointUrl. The value is read
      from an env var named here, never stored in the tenant row. */
  endpointAuthHeader?: string;
  endpointAuthEnvVar?: string;
  /** Below this quantity we say "az kaldı" instead of a bare yes. */
  lowStockThreshold: number;
}

/** Real-time voice, on top of the same catalog and tool surface as text chat.
    Off by default: a brand opts in per tenant rather than every deployment
    paying for the (much more expensive) audio tokens by accident. */
export interface TenantVoice {
  enabled: boolean;
  /** Greeting spoken first, per locale. Falls back to persona.greeting. */
  greeting?: Partial<Record<Locale, string>>;
}

/** How the widget talks back to the host page. */
export interface TenantCart {
  /** "redirect" needs zero work from the brand; "callback" calls a global
      function the brand already has; "api" posts to the brand's cart endpoint. */
  mode: "redirect" | "callback" | "api";
  /** mode==="callback": name of the global on the host page,
      e.g. "GG.addToCart". Called as fn({ sku, size, quantity }). */
  callbackName?: string;
  /** mode==="api": absolute URL of the brand's add-to-cart endpoint. */
  apiUrl?: string;
}

/** What the stylist is allowed to do to the brand's PAGE.

    The source product drives its own page directly. This widget lives in an
    iframe on someone else's site and cannot touch their DOM at all — every
    page action is a request the loader carries out on the host side. That is
    the whole reason the security boundary is worth anything, so it is not a
    limitation to work around.

    Everything the model may target is enumerated here and injected into the
    tool schema as an enum. A brand that lists no sections gets a stylist that
    cannot invent one, which is the same discipline as the sku contract. */
export interface TenantPageControl {
  enabled: boolean;
  /** Scrollable anchors on the brand's page. `id` must match a
      `data-rovena-section="<id>"` attribute (or an element id) on their site. */
  sections: { id: string; label: string }[];
  /** Category/landing pages the stylist may send the customer to. */
  categories: { id: string; label: string; url: string }[];
  /** True when the host exposes a cart drawer the stylist may open/close. */
  cart: boolean;
}

/** Virtual try-on: dress the outfit currently on screen on a model. */
export interface TenantTryOn {
  enabled: boolean;
  /** Reference model photo per department, absolute URL or a path under
      /public. Without one the render is a generic person in the brand's
      styling rather than a consistent house model. */
  models?: { women?: string; men?: string };
}

export interface Tenant {
  slug: string;
  name: string;
  status: "active" | "paused" | "trial";
  /** Origins allowed to embed the widget. Exact scheme+host+port, no
      wildcards — this is the only thing standing between the brand's paid
      widget and anyone else framing it. */
  allowedOrigins: string[];
  theme: TenantTheme;
  persona: TenantPersona;
  feed: TenantFeed;
  inventory: TenantInventory;
  cart: TenantCart;
  voice: TenantVoice;
  pageControl: TenantPageControl;
  tryOn: TenantTryOn;
  limits: {
    /** Messages per visitor session before the widget asks them to start over.
        Abuse ceiling, not a product decision — see docs/ARCHITECTURE.md. */
    messagesPerSession: number;
    /** Requests per minute per IP. */
    requestsPerMinute: number;
    /** Hard monthly conversation cap; 0 = uncapped (trust the contract). */
    conversationsPerMonth: number;
  };
}

/** The subset of a tenant that is safe to send to the browser. Anything not
    listed here (feed URLs, endpoint auth, limits) stays server-side. */
export interface PublicTenantConfig {
  slug: string;
  name: string;
  theme: TenantTheme;
  persona: Pick<
    TenantPersona,
    "displayName" | "greeting" | "suggestions" | "defaultLocale" | "locales"
  >;
  cart: { mode: TenantCart["mode"]; callbackName?: string };
  voice: { enabled: boolean };
  /** The widget needs these client-side to know which buttons to render and
      which host actions to attempt; the section/category ids are already
      visible in the brand's own markup, so nothing is disclosed by sending
      them. */
  pageControl: TenantPageControl;
  tryOn: { enabled: boolean };
}

export function toPublicConfig(t: Tenant): PublicTenantConfig {
  return {
    slug: t.slug,
    name: t.name,
    theme: t.theme,
    persona: {
      displayName: t.persona.displayName,
      greeting: t.persona.greeting,
      suggestions: t.persona.suggestions,
      defaultLocale: t.persona.defaultLocale,
      locales: t.persona.locales,
    },
    cart: { mode: t.cart.mode, callbackName: t.cart.callbackName },
    voice: { enabled: t.voice?.enabled ?? false },
    pageControl: t.pageControl ?? { enabled: false, sections: [], categories: [], cart: false },
    tryOn: { enabled: t.tryOn?.enabled ?? false },
  };
}
