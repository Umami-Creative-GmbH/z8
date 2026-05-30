import { eq } from "drizzle-orm";
import { DateTime } from "luxon";

import { db } from "@/db";
import { systemConfig } from "@/db/schema";
import { env } from "@/env";
import { getJobQueue, isQueueHealthy } from "@/lib/queue";
import { getOrCreateDeploymentId } from "@/lib/telemetry";

import type { DiagnosticsItem, PlatformDiagnosticsSnapshot, QueueSummary } from "./types";

type DiagnosticsEnv = Partial<Record<string, string | undefined>>;

export interface PlatformDiagnosticsDependencies {
	now: () => string;
	env: DiagnosticsEnv;
	getDeploymentId: () => Promise<string | null>;
	getBuildHash: () => string | undefined;
	getCookieConsentConfigured: () => Promise<boolean>;
	checkDatabase: () => Promise<boolean>;
	checkQueue: () => Promise<boolean>;
	getQueueSummary: () => Promise<QueueSummary>;
}

const STRIPE_KEYS = [
	"STRIPE_SECRET_KEY",
	"STRIPE_WEBHOOK_SECRET",
	"STRIPE_PRICE_MONTHLY_ID",
	"STRIPE_PRICE_YEARLY_ID",
] as const;

const COOKIE_CONSENT_SCRIPT_KEY = "cookie_consent_script";

function isConfigured(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function _createConfigItem(
	title: string,
	configured: boolean,
	description: string,
): DiagnosticsItem {
	return {
		title,
		status: configured ? "healthy" : "warning",
		value: configured ? "Configured" : "Missing",
		description,
	};
}

function buildTurnstileConfigItem(env: DiagnosticsEnv): DiagnosticsItem {
	const configured = isConfigured(env.TURNSTILE_SITE_KEY) && isConfigured(env.TURNSTILE_SECRET_KEY);

	return {
		title: "Turnstile",
		status: configured ? "healthy" : "disabled",
		value: configured ? "Configured" : "Disabled",
		description: configured
			? "Cloudflare Turnstile site and secret keys are configured."
			: "Cloudflare Turnstile checks are disabled unless both keys are configured.",
	};
}

function buildBillingReadiness(env: DiagnosticsEnv): DiagnosticsItem {
	if (env.BILLING_ENABLED !== "true") {
		return {
			title: "Billing readiness",
			status: "disabled",
			value: "Billing disabled",
			description: "Billing checks are skipped while BILLING_ENABLED is not true.",
		};
	}

	const missing = STRIPE_KEYS.filter((key) => !isConfigured(env[key]));

	if (missing.length === 0) {
		return {
			title: "Billing readiness",
			status: "healthy",
			value: "Configured",
			description: "Required Stripe variables are present.",
		};
	}

	return {
		title: "Billing readiness",
		status: "warning",
		value: "Missing Stripe configuration",
		description: `Missing ${formatList(missing)}.`,
	};
}

function formatList(values: string[]): string {
	if (values.length === 0) {
		return "";
	}

	if (values.length === 1) {
		return values[0];
	}

	return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function getOverallStatus(items: DiagnosticsItem[]): PlatformDiagnosticsSnapshot["overallStatus"] {
	if (items.some((item) => item.status === "error")) {
		return "error";
	}

	if (items.some((item) => item.status === "warning")) {
		return "warning";
	}

	return "healthy";
}

function getRecommendedActions(items: DiagnosticsItem[]): string[] {
	const actions = new Set<string>();

	if (items.some((item) => item.title === "Database" && item.status === "error")) {
		actions.add("Restore database connectivity before trusting other diagnostics.");
	}

	if (items.some((item) => item.title.includes("Turnstile") && item.status === "warning")) {
		actions.add(
			"Configure both Turnstile variables to enable bot protection on authentication forms.",
		);
	}

	if (items.some((item) => item.title === "Deployment ID" && item.status !== "healthy")) {
		actions.add(
			"Verify system_config persistence so telemetry can identify this deployment consistently.",
		);
	}

	if (
		items.some((item) => item.title.toLowerCase().includes("queue") && item.status === "warning")
	) {
		actions.add("Check Redis connectivity and worker queue configuration.");
	}

	if (items.some((item) => item.title === "Billing readiness" && item.status === "warning")) {
		actions.add("Configure missing Stripe variables before enabling billing workflows.");
	}

	return [...actions];
}

export const defaultPlatformDiagnosticsDependencies: PlatformDiagnosticsDependencies = {
	now: () => DateTime.utc().toISO() ?? DateTime.utc().toString(),
	env,
	getDeploymentId: async () => getOrCreateDeploymentId(),
	getBuildHash: () => env.NEXT_PUBLIC_BUILD_HASH,
	getCookieConsentConfigured: async () => {
		const [row] = await db
			.select({ value: systemConfig.value })
			.from(systemConfig)
			.where(eq(systemConfig.key, COOKIE_CONSENT_SCRIPT_KEY))
			.limit(1);

		return isConfigured(row?.value);
	},
	checkDatabase: async () => {
		await db.select({ key: systemConfig.key }).from(systemConfig).limit(1);
		return true;
	},
	checkQueue: async () => isQueueHealthy(),
	getQueueSummary: async () => {
		const counts = await getJobQueue().getJobCounts();

		return {
			waiting: counts.waiting ?? 0,
			active: counts.active ?? 0,
			failed: counts.failed ?? 0,
			delayed: counts.delayed ?? 0,
		};
	},
};

export async function collectPlatformDiagnostics(
	deps: PlatformDiagnosticsDependencies = defaultPlatformDiagnosticsDependencies,
): Promise<PlatformDiagnosticsSnapshot> {
	const [databaseHealthy, deploymentIdResult, cookieConsentResult, queueHealthy] =
		await Promise.all([
			deps.checkDatabase().catch(() => false),
			deps.getDeploymentId().then(
				(value) => ({ ok: true as const, value }),
				() => ({ ok: false as const, value: null }),
			),
			deps.getCookieConsentConfigured().then(
				(value) => ({ ok: true as const, value }),
				() => ({ ok: false as const, value: false }),
			),
			deps.checkQueue().catch(() => false),
		]);

	const queueSummary = queueHealthy ? await deps.getQueueSummary().catch(() => null) : null;

	const billingEnabled = deps.env.BILLING_ENABLED === "true";
	const runtimeParts = [deps.env.NODE_ENV ?? "unknown", deps.env.NEXT_RUNTIME ?? "nodejs"].filter(
		Boolean,
	);
	const buildHash = deps.env.NEXT_PUBLIC_BUILD_HASH ?? deps.getBuildHash();
	const secretStoreProvider =
		deps.env.SECRET_STORE_PROVIDER === "vault" || deps.env.SECRET_STORE_PROVIDER === "scaleway"
			? deps.env.SECRET_STORE_PROVIDER
			: env.SECRET_STORE_PROVIDER;

	const configuration: DiagnosticsItem[] = [
		{
			title: "Billing",
			status: billingEnabled ? "healthy" : "disabled",
			value: billingEnabled ? "Enabled" : "Disabled",
			description: "Runtime value of BILLING_ENABLED.",
		},
		buildTurnstileConfigItem(deps.env),
		cookieConsentResult.ok
			? {
					title: "Cookie consent script",
					status: cookieConsentResult.value ? "healthy" : "disabled",
					value: cookieConsentResult.value ? "Configured" : "Not configured",
					description: cookieConsentResult.value
						? "Global auth-page cookie consent script."
						: "Optional global auth-page cookie consent script is not configured.",
					actionHref: "/platform-admin/settings",
					actionLabel: "Open platform settings",
				}
			: {
					title: "Cookie consent script",
					status: "error",
					value: "Unavailable",
					description: "Could not read cookie consent configuration.",
				},
		deploymentIdResult.ok && deploymentIdResult.value
			? {
					title: "Deployment ID",
					status: "healthy",
					value: deploymentIdResult.value,
					description: "Non-secret telemetry identifier from system_config.",
				}
			: {
					title: "Deployment ID",
					status: deploymentIdResult.ok ? "warning" : "error",
					value: deploymentIdResult.ok ? "Missing" : "Unavailable",
					description: deploymentIdResult.ok
						? "No deployment_id row exists in system_config."
						: "Could not read deployment_id from system_config.",
				},
		{
			title: "Runtime",
			status: "healthy",
			value: runtimeParts.join(" / "),
			description: "Node environment and Next.js runtime label.",
		},
		{
			title: "Build hash",
			status: isConfigured(buildHash) ? "healthy" : "warning",
			value: buildHash ?? "Missing",
			description: "Public build identifier when provided by deployment.",
		},
	];

	const health: DiagnosticsItem[] = [
		{
			title: "Database",
			status: databaseHealthy ? "healthy" : "error",
			value: databaseHealthy ? "Connected" : "Unavailable",
			description: "Lightweight read against system configuration storage.",
		},
		{
			title: "Queue / Redis",
			status: queueHealthy ? "healthy" : "warning",
			value: queueHealthy ? "Connected" : "Unavailable",
			description: "BullMQ queue connectivity check.",
		},
		queueSummary
			? {
					title: "Worker queue",
					status: queueSummary.failed > 0 ? "warning" : "healthy",
					value: `${queueSummary.waiting} waiting, ${queueSummary.active} active, ${queueSummary.failed} failed, ${queueSummary.delayed} delayed`,
					description: "Compact queue count summary. Use Worker Queue for detailed job history.",
					actionHref: "/platform-admin/worker-queue",
					actionLabel: "Open worker queue",
				}
			: {
					title: "Worker queue",
					status: "warning",
					value: "Unavailable",
					description: "Queue summary could not be collected.",
					actionHref: "/platform-admin/worker-queue",
					actionLabel: "Open worker queue",
				},
		buildBillingReadiness(deps.env),
	];

	const allItems = [...configuration, ...health];

	return {
		fetchedAt: deps.now(),
		overallStatus: getOverallStatus(allItems),
		secretStoreProvider,
		configuration,
		health,
		recommendedActions: getRecommendedActions(allItems),
	};
}
