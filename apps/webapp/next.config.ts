import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
	reactStrictMode: true,
	reactCompiler: true,
	// Note: standalone output is not compatible with cacheComponents in Next.js 16
	// Using standard build with full node_modules for Docker deployment
	// Enable cache components for static dashboard shells and improved performance
	// Components using connection() will still be dynamic
	cacheComponents: true,
	experimental: {
		optimizePackageImports: [
			"@tabler/icons-react",
			"lucide-react",
			"recharts",
			"date-fns",
			"@radix-ui/react-icons",
		],
	},
	// Use Valkey for distributed caching (enabled when VALKEY_HOST is set)
	...(process.env.VALKEY_HOST
		? {
				cacheHandlers: {
					default: require.resolve("./cache-handler.ts"),
				},
				cacheMaxMemorySize: 0, // Disable in-memory cache, use Valkey only
			}
		: {}),
	devIndicators: {
		position: "bottom-right",
	},
	serverExternalPackages: [
		"@opentelemetry/api",
		"@opentelemetry/sdk-node",
		"@opentelemetry/resources",
		"@opentelemetry/semantic-conventions",
		"@opentelemetry/sdk-trace-base",
		"@opentelemetry/exporter-trace-otlp-http",
		"@opentelemetry/exporter-metrics-otlp-http",
		"@opentelemetry/auto-instrumentations-node",
		"pg",
		"ioredis",
		"bullmq",
		"pino",
		"pino-pretty",
		"pino-opentelemetry-transport",
		"sharp",
		"@img/sharp-win32-x64",
		"@img/sharp-darwin-arm64",
		"@img/sharp-darwin-x64",
		"@img/sharp-linux-x64",
		"@img/sharp-linux-arm64",
		"@tus/server",
		"@tus/s3-store",
		"@tus/file-store",
		"exceljs",
		"@react-email/render",
		"@react-email/components",
	],
};

export default withNextIntl(nextConfig);
