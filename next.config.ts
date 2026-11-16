import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  // UI5 Web Components ship modern ESM that Next has to transpile.
  transpilePackages: [
    "@ui5/webcomponents",
    "@ui5/webcomponents-base",
    "@ui5/webcomponents-fiori",
    "@ui5/webcomponents-icons",
    "@ui5/webcomponents-react",
    "@ui5/webcomponents-react-base",
  ],
};

export default nextConfig;
