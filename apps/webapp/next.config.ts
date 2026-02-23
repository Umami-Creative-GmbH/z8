import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();
const configDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(configDir, "../..");

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
	turbopack: {
		root: workspaceRoot,
	},
	// Use Valkey for distributed caching (skip in CI build to reduce noisy logs)
	...(process.env.VALKEY_HOST && process.env.CI !== "true"
		? {
				cacheHandlers: {
					default: require.resolve("./cache-handler.js"),
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
