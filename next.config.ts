import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
