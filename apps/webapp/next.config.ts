import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  cacheComponents: true,
  experimental: {
    viewTransition: true,
  },
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/resources",
    "@opentelemetry/semantic-conventions",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/exporter-metrics-otlp-http",
    "@opentelemetry/auto-instrumentations-node",
    "sharp",
    "@img/sharp-win32-x64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-darwin-x64",
    "@img/sharp-linux-x64",
    "@img/sharp-linux-arm64",
    "detect-libc",
    "@tus/server",
    "@tus/s3-store",
    "@tus/file-store",
  ],
};

export default withNextIntl(nextConfig);
