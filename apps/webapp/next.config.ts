import { execFileSync } from "node:child_process";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { REPORT_SHARE_REQUEST_PATH, SETUP_REQUEST_PATH } from "./src/lib/setup/telemetry";

// Initialize before Next.js starts build or server workers.
process.env.TZ ||= "UTC";

const withNextIntl = createNextIntlPlugin();
const configDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(configDir, "../..");
// Test artifacts are isolated from both the developer server and shipping builds.
const isInstantNavigationTest = process.env.Z8_INSTANT_NAV_TEST === "1";

function getBuildHash() {
	const providedHash =
		process.env.NEXT_DEPLOYMENT_ID ||
		process.env.BUILD_HASH ||
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.GITHUB_SHA ||
		process.env.CI_COMMIT_SHA;

	if (providedHash) {
		return providedHash.slice(0, 7);
	}

	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: workspaceRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		if (process.env.NODE_ENV === "production") {
			throw new Error(
				"Missing deployment/build hash. Set NEXT_DEPLOYMENT_ID or BUILD_HASH during next build.",
			);
		}

		return "dev";
	}
}

const buildHash = getBuildHash();

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const hasPostHogSourcemapConfig =
	!!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && !!POSTHOG_API_KEY && !!POSTHOG_PROJECT_ID;

const nextConfig: NextConfig = {
	reactStrictMode: true,
	allowedDevOrigins: ["z8.localhost", "*.z8.localhost"],
	logging: {
		incomingRequests: {
			ignore: [SETUP_REQUEST_PATH, REPORT_SHARE_REQUEST_PATH],
		},
	},
	async rewrites() {
		return [
			{
				source: "/ingest/static/:path*",
				destination: `${POSTHOG_HOST}/static/:path*`,
			},
			{
				source: "/ingest/:path*",
				destination: `${POSTHOG_HOST}/:path*`,
			},
		];
	},
	skipTrailingSlashRedirect: true,
	deploymentId: buildHash,
	reactCompiler: true,
	env: {
		NEXT_PUBLIC_BUILD_HASH: buildHash,
	},
	// Dedicated navigation tests use next start; shipping images use the traced server.
	output: isInstantNavigationTest ? undefined : "standalone",
	outputFileTracingRoot: workspaceRoot,
	...(isInstantNavigationTest ? { distDir: ".next-instant-nav" } : {}),
	// Request-dependent content streams behind each route's loading boundaries.
	cacheComponents: true,
	partialPrefetching: true,
	experimental: {
		...(isInstantNavigationTest ? { exposeTestingApiInProductionBuild: true } : {}),
		// Each prerender worker loads the full server graph for 3,000+ localized pages.
		// Bound concurrency on large hosts; respect smaller container CPU allocations.
		cpus: Math.max(1, Math.min(4, availableParallelism() - 1)),
		// Transfer large prerender result batches without JSON IPC string limits.
		workerThreads: true,
		agentUpgrade: "latest",
		// Build-mount persistence is opt-in until warm-build memory/time is qualified.
		turbopackFileSystemCacheForBuild: false,
	},
	turbopack: {
		root: workspaceRoot,
	},
	devIndicators: {
		position: "bottom-right",
	},
	serverExternalPackages: [
		"@opentelemetry/api",
		"@opentelemetry/sdk-node",
		"@opentelemetry/resources",
		"@opentelemetry/semantic-conventions",
		"@opentelemetry/sdk-trace",
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
		"react-email",
		"@react-email/ui",
	],
};

const nextIntlConfig = withNextIntl(nextConfig);

export default hasPostHogSourcemapConfig
	? withPostHogConfig(nextIntlConfig, {
			personalApiKey: POSTHOG_API_KEY,
			projectId: POSTHOG_PROJECT_ID,
			host: POSTHOG_HOST,
			sourcemaps: {
				enabled: true,
				releaseName: "z8-webapp",
				releaseVersion: buildHash,
				deleteAfterUpload: true,
			},
		})
	: nextIntlConfig;
