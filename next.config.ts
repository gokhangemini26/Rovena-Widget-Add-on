import type { NextConfig } from "next";

/* The widget is loaded INSIDE other companies' sites, so the frame policy is
   the inverse of a normal app's: /embed/* must be framable by an allowlisted
   brand origin, everything else must not be framable at all. X-Frame-Options
   cannot express an allowlist, so /embed/* relies on a per-tenant
   Content-Security-Policy `frame-ancestors` set at request time in
   src/middleware.ts, and only the NON-embed surface gets the blanket DENY. */
const nextConfig: NextConfig = {
  // Pin the workspace root: this repo sits under a directory tree that contains
  // other lockfiles, and Turbopack otherwise guesses one of them.
  turbopack: { root: import.meta.dirname },
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Everything except /embed and the loader script.
        source: "/:path((?!embed|rovena\\.js).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The loader is a public, cacheable, cross-origin asset by design.
        source: "/rovena.js",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
