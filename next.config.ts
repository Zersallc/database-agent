import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // html2canvas v1 throws on modern CSS color functions ("unsupported color
      // function lab"), which Tailwind v4's oklch-based theme produces. The
      // -pro fork is a drop-in replacement that parses them. Aliasing here also
      // fixes react-to-pdf, which imports html2canvas internally.
      html2canvas: "html2canvas-pro",
    },
  },
};

export default nextConfig;
