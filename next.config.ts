import type { NextConfig } from "next";

/**
 * Space-separated list of origins allowed to iframe this app (for the thecue.work
 * embed). Defaults to the production and www hosts; override via env for staging.
 */
function frameAncestors(): string {
  const extra = (process.env.EMBED_ALLOWED_ORIGINS || "").trim();
  const defaults = ["'self'", "https://thecue.work", "https://www.thecue.work"];
  const origins = extra ? extra.split(/\s+/).filter(Boolean) : [];
  return [...defaults, ...origins].join(" ");
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors()}`,
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/spaces/cue-dallas",
        destination: "/spaces/arts-district-m1",
        permanent: false,
      },
      {
        source: "/spaces/cue-downtown-boardroom",
        destination: "/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
