import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // unsafe-eval: required by some deps (e.g. Supabase/Mapbox); avoid if you can remove eval usage
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.mapbox.com",
              "style-src 'self' 'unsafe-inline' https://*.mapbox.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.mapbox.com",
              "frame-src 'self'",
              "img-src 'self' data: blob: https:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
