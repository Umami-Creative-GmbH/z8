# Platform Admin Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-admin diagnostics page that shows safe deployment configuration and app-only health checks with manual refresh.

**Architecture:** Build a server-side diagnostics collector with injected dependencies for testability, then expose it through a platform-admin-protected server action. Render the initial snapshot server-side on `/platform-admin/diagnostics`, pass it into a small client component for manual refresh, and link the page from platform-admin navigation and overview quick actions.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Testing Library, Drizzle, Effect server actions, Luxon, existing shadcn-style UI components.

---

## File Structure

- Create: `apps/webapp/src/lib/platform-diagnostics/types.ts`
  - Owns serializable diagnostics types used by collector, route, action, and UI.
- Create: `apps/webapp/src/lib/platform-diagnostics/collector.ts`
  - Owns `collectPlatformDiagnostics()` and dependency injection for environment, database, cookie consent, queue, and billing checks.
- Create: `apps/webapp/src/lib/platform-diagnostics/collector.test.ts`
  - Unit-tests status computation, secret redaction, billing readiness, queue warning behavior, and recommended actions.
- Create: `apps/webapp/src/lib/platform-diagnostics/index.ts`
  - Re-exports public diagnostics functions/types.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
  - Owns `refreshPlatformDiagnosticsAction()` and platform-admin authorization.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`
  - Verifies refresh action requires platform-admin access before collecting diagnostics.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
  - Client island for rendering the snapshot, refresh button, pending state, and refresh errors.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`
  - Tests initial render, successful refresh, and failed refresh behavior.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx`
  - Server page that collects initial diagnostics and renders the client component.
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
  - Add diagnostics to platform-admin navigation.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`
  - Add diagnostics quick action.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`
  - Add source-level assertions for diagnostics nav and route.

## Task 1: Diagnostics Collector Types And Tests

**Files:**
- Create: `apps/webapp/src/lib/platform-diagnostics/types.ts`
- Create: `apps/webapp/src/lib/platform-diagnostics/collector.test.ts`

- [ ] **Step 1: Create diagnostics types**

Create `apps/webapp/src/lib/platform-diagnostics/types.ts` with:

```ts
export type DiagnosticsStatus = "healthy" | "warning" | "error" | "disabled";

export interface DiagnosticsItem {
	title: string;
	status: DiagnosticsStatus;
	value: string;
	description?: string;
	actionHref?: string;
	actionLabel?: string;
}

export interface PlatformDiagnosticsSnapshot {
	fetchedAt: string;
	overallStatus: Exclude<DiagnosticsStatus, "disabled">;
	configuration: DiagnosticsItem[];
	health: DiagnosticsItem[];
	recommendedActions: string[];
}

export interface QueueSummary {
	waiting: number;
	active: number;
	failed: number;
	delayed: number;
}
```

- [ ] **Step 2: Write collector tests before implementation**

Create `apps/webapp/src/lib/platform-diagnostics/collector.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { collectPlatformDiagnostics } from "./collector";
import type { QueueSummary } from "./types";

function buildDeps(overrides: Partial<Parameters<typeof collectPlatformDiagnostics>[0]> = {}) {
	return {
		now: () => "2026-05-10T12:00:00.000Z",
		env: {
			BILLING_ENABLED: "false",
			NODE_ENV: "production",
			NEXT_RUNTIME: "nodejs",
			NEXT_PUBLIC_BUILD_HASH: "build-123",
			TURNSTILE_SITE_KEY: "site-secret-value-that-must-not-leak",
			TURNSTILE_SECRET_KEY: "turnstile-secret-that-must-not-leak",
			STRIPE_SECRET_KEY: "stripe-secret-that-must-not-leak",
			STRIPE_WEBHOOK_SECRET: "stripe-webhook-secret-that-must-not-leak",
			STRIPE_PRICE_MONTHLY_ID: "price_monthly_123",
			STRIPE_PRICE_YEARLY_ID: "price_yearly_123",
		},
		getDeploymentId: async () => "deployment-123",
		getCookieConsentConfigured: async () => true,
		checkDatabase: async () => true,
		checkQueue: async () => true,
		getQueueSummary: async (): Promise<QueueSummary> => ({
			waiting: 1,
			active: 2,
			failed: 0,
			delayed: 3,
		}),
		...overrides,
	};
}

describe("collectPlatformDiagnostics", () => {
	it("returns a healthy snapshot without leaking secret values", async () => {
		const snapshot = await collectPlatformDiagnostics(buildDeps());
		const serialized = JSON.stringify(snapshot);

		expect(snapshot.overallStatus).toBe("healthy");
		expect(snapshot.fetchedAt).toBe("2026-05-10T12:00:00.000Z");
		expect(snapshot.configuration).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Billing", status: "disabled", value: "Disabled" }),
				expect.objectContaining({ title: "Turnstile site key", status: "healthy", value: "Configured" }),
				expect.objectContaining({ title: "Turnstile secret key", status: "healthy", value: "Configured" }),
				expect.objectContaining({ title: "Cookie consent script", status: "healthy", value: "Configured" }),
				expect.objectContaining({ title: "Deployment ID", status: "healthy", value: "deployment-123" }),
				expect.objectContaining({ title: "Runtime", status: "healthy", value: "production / nodejs" }),
				expect.objectContaining({ title: "Build hash", status: "healthy", value: "build-123" }),
			]),
		);
		expect(snapshot.health).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Database", status: "healthy", value: "Connected" }),
				expect.objectContaining({ title: "Queue / Valkey", status: "healthy", value: "Connected" }),
				expect.objectContaining({ title: "Worker queue", status: "healthy", value: "1 waiting, 2 active, 0 failed, 3 delayed" }),
				expect.objectContaining({ title: "Billing readiness", status: "disabled", value: "Billing disabled" }),
			]),
		);
		expect(serialized).not.toContain("site-secret-value-that-must-not-leak");
		expect(serialized).not.toContain("turnstile-secret-that-must-not-leak");
		expect(serialized).not.toContain("stripe-secret-that-must-not-leak");
		expect(serialized).not.toContain("stripe-webhook-secret-that-must-not-leak");
	});

	it("marks billing readiness as warning when billing is enabled and Stripe config is incomplete", async () => {
		const snapshot = await collectPlatformDiagnostics(
			buildDeps({
				env: {
					BILLING_ENABLED: "true",
					NODE_ENV: "production",
					STRIPE_SECRET_KEY: "sk_live_present",
					STRIPE_WEBHOOK_SECRET: "",
					STRIPE_PRICE_MONTHLY_ID: "price_monthly_123",
					STRIPE_PRICE_YEARLY_ID: undefined,
				},
			}),
		);

		expect(snapshot.overallStatus).toBe("warning");
		expect(snapshot.health).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Billing readiness",
					status: "warning",
					value: "Missing Stripe configuration",
					description: "Missing STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_YEARLY_ID.",
				}),
			]),
		);
		expect(snapshot.recommendedActions).toContain(
			"Configure missing Stripe variables before enabling billing workflows.",
		);
	});

	it("keeps database failures isolated and marks the snapshot as error", async () => {
		const snapshot = await collectPlatformDiagnostics(
			buildDeps({
				checkDatabase: async () => false,
				getDeploymentId: async () => {
					throw new Error("database unavailable");
				},
				getCookieConsentConfigured: async () => {
					throw new Error("database unavailable");
				},
			}),
		);

		expect(snapshot.overallStatus).toBe("error");
		expect(snapshot.configuration).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Deployment ID", status: "error", value: "Unavailable" }),
				expect.objectContaining({ title: "Cookie consent script", status: "error", value: "Unavailable" }),
			]),
		);
		expect(snapshot.health).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Database", status: "error", value: "Unavailable" }),
			]),
		);
		expect(snapshot.recommendedActions).toContain("Restore database connectivity before trusting other diagnostics.");
	});

	it("treats queue failures as warnings and leaves the database healthy", async () => {
		const snapshot = await collectPlatformDiagnostics(
			buildDeps({
				checkQueue: async () => false,
				getQueueSummary: async () => {
					throw new Error("queue unavailable");
				},
			}),
		);

		expect(snapshot.overallStatus).toBe("warning");
		expect(snapshot.health).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Database", status: "healthy", value: "Connected" }),
				expect.objectContaining({ title: "Queue / Valkey", status: "warning", value: "Unavailable" }),
				expect.objectContaining({ title: "Worker queue", status: "warning", value: "Unavailable" }),
			]),
		);
		expect(snapshot.recommendedActions).toContain("Check Valkey/Redis connectivity and worker queue configuration.");
	});
});
```

- [ ] **Step 3: Run the failing collector tests**

Run:

```bash
pnpm --filter webapp test src/lib/platform-diagnostics/collector.test.ts
```

Expected: FAIL because `./collector` does not exist.

## Task 2: Diagnostics Collector Implementation

**Files:**
- Create: `apps/webapp/src/lib/platform-diagnostics/collector.ts`
- Create: `apps/webapp/src/lib/platform-diagnostics/index.ts`
- Test: `apps/webapp/src/lib/platform-diagnostics/collector.test.ts`

- [ ] **Step 1: Implement the collector**

Create `apps/webapp/src/lib/platform-diagnostics/collector.ts` with:

```ts
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { systemConfig } from "@/db/schema";
import { getCookieConsentScript } from "@/lib/platform-settings";
import { getJobQueue, isQueueHealthy } from "@/lib/queue";
import type { DiagnosticsItem, PlatformDiagnosticsSnapshot, QueueSummary } from "./types";

type DiagnosticsEnv = Partial<Record<string, string | undefined>>;

export interface PlatformDiagnosticsDependencies {
	now: () => string;
	env: DiagnosticsEnv;
	getDeploymentId: () => Promise<string | null>;
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

function isConfigured(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function createConfigItem(
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
		actions.add("Configure both Turnstile variables to enable bot protection on authentication forms.");
	}

	if (items.some((item) => item.title === "Deployment ID" && item.status !== "healthy")) {
		actions.add("Verify system_config persistence so telemetry can identify this deployment consistently.");
	}

	if (items.some((item) => item.title.includes("Queue") && item.status === "warning")) {
		actions.add("Check Valkey/Redis connectivity and worker queue configuration.");
	}

	if (items.some((item) => item.title === "Billing readiness" && item.status === "warning")) {
		actions.add("Configure missing Stripe variables before enabling billing workflows.");
	}

	return [...actions];
}

export const defaultPlatformDiagnosticsDependencies: PlatformDiagnosticsDependencies = {
	now: () => DateTime.utc().toISO() ?? DateTime.utc().toString(),
	env: process.env,
	getDeploymentId: async () => {
		const [row] = await db
			.select({ value: systemConfig.value })
			.from(systemConfig)
			.where(eq(systemConfig.key, "deployment_id"))
			.limit(1);

		return row?.value ?? null;
	},
	getCookieConsentConfigured: async () => {
		const script = await getCookieConsentScript();
		return isConfigured(script ?? undefined);
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
	const [databaseHealthy, deploymentIdResult, cookieConsentResult, queueHealthy] = await Promise.all([
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

	const queueSummary = queueHealthy
		? await deps.getQueueSummary().catch(() => null)
		: null;

	const billingEnabled = deps.env.BILLING_ENABLED === "true";
	const runtimeParts = [deps.env.NODE_ENV ?? "unknown", deps.env.NEXT_RUNTIME ?? "nodejs"].filter(Boolean);

	const configuration: DiagnosticsItem[] = [
		{
			title: "Billing",
			status: billingEnabled ? "healthy" : "disabled",
			value: billingEnabled ? "Enabled" : "Disabled",
			description: "Runtime value of BILLING_ENABLED.",
		},
		createConfigItem(
			"Turnstile site key",
			isConfigured(deps.env.TURNSTILE_SITE_KEY),
			"Reports presence only. The key value is not exposed.",
		),
		createConfigItem(
			"Turnstile secret key",
			isConfigured(deps.env.TURNSTILE_SECRET_KEY),
			"Reports presence only. The secret value is never exposed.",
		),
		cookieConsentResult.ok
			? {
					title: "Cookie consent script",
					status: cookieConsentResult.value ? "healthy" : "warning",
					value: cookieConsentResult.value ? "Configured" : "Not configured",
					description: "Global auth-page cookie consent script.",
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
			status: isConfigured(deps.env.NEXT_PUBLIC_BUILD_HASH) ? "healthy" : "warning",
			value: deps.env.NEXT_PUBLIC_BUILD_HASH ?? "Missing",
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
			title: "Queue / Valkey",
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
		configuration,
		health,
		recommendedActions: getRecommendedActions(allItems),
	};
}
```

- [ ] **Step 2: Add a public diagnostics barrel file**

Create `apps/webapp/src/lib/platform-diagnostics/index.ts` with:

```ts
export { collectPlatformDiagnostics, defaultPlatformDiagnosticsDependencies } from "./collector";
export type {
	DiagnosticsItem,
	DiagnosticsStatus,
	PlatformDiagnosticsSnapshot,
	QueueSummary,
} from "./types";
```

- [ ] **Step 3: Run collector tests**

Run:

```bash
pnpm --filter webapp test src/lib/platform-diagnostics/collector.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit collector work**

Run:

```bash
git add apps/webapp/src/lib/platform-diagnostics
git commit -m "feat: add platform diagnostics collector"
```

Expected: commit succeeds.

## Task 3: Protected Refresh Server Action

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`

- [ ] **Step 1: Write refresh action tests**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ACTIONS_PATH = fileURLToPath(new URL("./actions.ts", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("platform diagnostics refresh action", () => {
	it("requires platform-admin authorization before collecting diagnostics", () => {
		const source = stripComments(readFileSync(ACTIONS_PATH, "utf8"));
		const authCheck = "adminService.requirePlatformAdmin()";
		const collectorCall = "collectPlatformDiagnostics()";

		expect(source).toContain('"use server"');
		expect(source).toContain("PlatformAdminService");
		expect(source).toContain(authCheck);
		expect(source).toContain(collectorCall);
		expect(source.indexOf(authCheck)).toBeLessThan(source.indexOf(collectorCall));
		expect(source).toContain("runServerActionSafe");
	});
});
```

- [ ] **Step 2: Run the failing refresh action tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
```

Expected: FAIL because `actions.ts` does not exist.

- [ ] **Step 3: Implement the refresh action**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts` with:

```ts
"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { collectPlatformDiagnostics, type PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";

export async function refreshPlatformDiagnosticsAction(): Promise<ServerActionResult<PlatformDiagnosticsSnapshot>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		return yield* Effect.promise(() => collectPlatformDiagnostics());
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
```

- [ ] **Step 4: Run refresh action tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit refresh action work**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
git commit -m "feat: protect diagnostics refresh action"
```

Expected: commit succeeds.

## Task 4: Diagnostics Client Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`

- [ ] **Step 1: Write client component tests**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";

const { refreshPlatformDiagnosticsActionMock } = vi.hoisted(() => ({
	refreshPlatformDiagnosticsActionMock: vi.fn(),
}));

vi.mock("./actions", () => ({
	refreshPlatformDiagnosticsAction: refreshPlatformDiagnosticsActionMock,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

function snapshot(overrides: Partial<PlatformDiagnosticsSnapshot> = {}): PlatformDiagnosticsSnapshot {
	return {
		fetchedAt: "2026-05-10T12:00:00.000Z",
		overallStatus: "healthy",
		configuration: [
			{
				title: "Billing",
				status: "disabled",
				value: "Disabled",
				description: "Runtime value of BILLING_ENABLED.",
			},
		],
		health: [
			{
				title: "Database",
				status: "healthy",
				value: "Connected",
				description: "Lightweight read against system configuration storage.",
			},
		],
		recommendedActions: [],
		...overrides,
	};
}

import { DiagnosticsClient } from "./diagnostics-client";

describe("DiagnosticsClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the initial diagnostics snapshot", () => {
		render(<DiagnosticsClient initialSnapshot={snapshot()} />);

		expect(screen.getByText("Deployment Diagnostics")).toBeTruthy();
		expect(screen.getByText("Healthy")).toBeTruthy();
		expect(screen.getByText("Billing")).toBeTruthy();
		expect(screen.getByText("Disabled")).toBeTruthy();
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("refreshes the snapshot when the refresh action succeeds", async () => {
		refreshPlatformDiagnosticsActionMock.mockResolvedValue({
			success: true,
			data: snapshot({
				fetchedAt: "2026-05-10T12:05:00.000Z",
				overallStatus: "warning",
				recommendedActions: ["Check Valkey/Redis connectivity and worker queue configuration."],
				health: [
					{
						title: "Queue / Valkey",
						status: "warning",
						value: "Unavailable",
						description: "BullMQ queue connectivity check.",
					},
				],
			}),
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh diagnostics" }));

		await waitFor(() => expect(screen.getByText("Warning")).toBeTruthy());
		expect(screen.getByText("Queue / Valkey")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
		expect(screen.getByText("Check Valkey/Redis connectivity and worker queue configuration.")).toBeTruthy();
	});

	it("keeps the previous snapshot visible when refresh fails", async () => {
		refreshPlatformDiagnosticsActionMock.mockResolvedValue({
			success: false,
			error: "Platform admin access required",
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} />);
		fireEvent.click(screen.getByRole("button", { name: "Refresh diagnostics" }));

		await waitFor(() => expect(screen.getByText("Platform admin access required")).toBeTruthy());
		expect(screen.getByText("Database")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the failing client tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
```

Expected: FAIL because `diagnostics-client.tsx` does not exist.

- [ ] **Step 3: Implement the client component**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx` with:

```tsx
"use client";

import { IconAlertTriangle, IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiagnosticsItem, DiagnosticsStatus, PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { refreshPlatformDiagnosticsAction } from "./actions";

const statusLabels: Record<DiagnosticsStatus, string> = {
	healthy: "Healthy",
	warning: "Warning",
	error: "Error",
	disabled: "Disabled",
};

const statusStyles: Record<DiagnosticsStatus, string> = {
	healthy: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
	warning: "border-amber-500/40 text-amber-700 dark:text-amber-400",
	error: "border-red-500/40 text-red-700 dark:text-red-400",
	disabled: "border-muted-foreground/30 text-muted-foreground",
};

function StatusIcon({ status }: { status: DiagnosticsStatus }) {
	if (status === "healthy") {
		return <IconCheck className="size-3" aria-hidden="true" />;
	}

	if (status === "error") {
		return <IconX className="size-3" aria-hidden="true" />;
	}

	return <IconAlertTriangle className="size-3" aria-hidden="true" />;
}

function StatusBadge({ status }: { status: DiagnosticsStatus }) {
	return (
		<Badge variant="outline" className={cn("capitalize", statusStyles[status])}>
			<StatusIcon status={status} />
			{statusLabels[status]}
		</Badge>
	);
}

function DiagnosticsItemRow({ item }: { item: DiagnosticsItem }) {
	return (
		<div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="text-sm font-medium">{item.title}</h3>
					<StatusBadge status={item.status} />
				</div>
				{item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}
				{item.actionHref && item.actionLabel ? (
					<Link href={item.actionHref} className="text-sm font-medium text-primary hover:underline">
						{item.actionLabel}
					</Link>
				) : null}
			</div>
			<div className="font-mono text-sm text-muted-foreground sm:text-right">{item.value}</div>
		</div>
	);
}

function DiagnosticsSection({ title, description, items }: { title: string; description: string; items: DiagnosticsItem[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{items.map((item) => (
					<DiagnosticsItemRow key={item.title} item={item} />
				))}
			</CardContent>
		</Card>
	);
}

export function DiagnosticsClient({ initialSnapshot }: { initialSnapshot: PlatformDiagnosticsSnapshot }) {
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	function refreshDiagnostics() {
		setError(null);
		startTransition(async () => {
			const result = await refreshPlatformDiagnosticsAction();

			if (result.success) {
				setSnapshot(result.data);
				return;
			}

			setError(result.error);
		});
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-3">
							<CardTitle>Deployment Diagnostics</CardTitle>
							<StatusBadge status={snapshot.overallStatus} />
						</div>
						<CardDescription>
							Safe platform configuration and app-level service health. Last refreshed {snapshot.fetchedAt}.
						</CardDescription>
					</div>
					<Button onClick={refreshDiagnostics} disabled={isPending} aria-label="Refresh diagnostics">
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						)}
						Refresh diagnostics
					</Button>
				</CardHeader>
				{error ? (
					<CardContent>
						<div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
							{error}
						</div>
					</CardContent>
				) : null}
			</Card>

			<div className="grid gap-6 xl:grid-cols-2">
				<DiagnosticsSection
					title="Platform Configuration"
					description="Safe deployment configuration states. Secret values are never shown."
					items={snapshot.configuration}
				/>
				<DiagnosticsSection
					title="Service Health"
					description="App-only checks for infrastructure dependencies used by the webapp."
					items={snapshot.health}
				/>
			</div>

			{snapshot.recommendedActions.length > 0 ? (
				<Card className="border-amber-500/30 bg-amber-500/5">
					<CardHeader>
						<CardTitle>Recommended Actions</CardTitle>
						<CardDescription>Resolve these items to return diagnostics to a healthy state.</CardDescription>
					</CardHeader>
					<CardContent>
						<ul className="space-y-2 text-sm">
							{snapshot.recommendedActions.map((action) => (
								<li key={action} className="flex gap-2">
									<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
									<span>{action}</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
```

- [ ] **Step 4: Run client component tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit client component work**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
git commit -m "feat: add diagnostics refresh client"
```

Expected: commit succeeds.

## Task 5: Diagnostics Page, Navigation, And Overview Link

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Extend platform-admin layout tests**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts` by adding this test inside the existing `describe` block:

```ts
	it("links to deployment diagnostics from platform-admin navigation and overview", () => {
		const layoutSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));
		const overviewSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"));

		expect(layoutSource).toContain('href: "/platform-admin/diagnostics"');
		expect(layoutSource).toContain('"Deployment Diagnostics"');
		expect(overviewSource).toContain('href="/platform-admin/diagnostics"');
		expect(overviewSource).toContain('"Deployment Diagnostics"');
	});
```

- [ ] **Step 2: Run the failing layout test**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: FAIL because the diagnostics route is not linked yet.

- [ ] **Step 3: Create the server-rendered diagnostics page**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx` with:

```tsx
import { connection } from "next/server";
import { collectPlatformDiagnostics } from "@/lib/platform-diagnostics";
import { DiagnosticsClient } from "./diagnostics-client";

export default async function PlatformDiagnosticsPage() {
	await connection();

	const snapshot = await collectPlatformDiagnostics();

	return (
		<div className="space-y-10">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">Deployment Diagnostics</h1>
				<p className="text-muted-foreground">
					Safe platform configuration and app-only deployment health checks.
				</p>
			</div>

			<DiagnosticsClient initialSnapshot={snapshot} />
		</div>
	);
}
```

- [ ] **Step 4: Add diagnostics to platform-admin navigation**

Modify `apps/webapp/src/app/[locale]/(admin)/layout.tsx`:

Add `IconActivityHeartbeat` to the Tabler import list:

```tsx
import {
	IconActivityHeartbeat,
	IconBuilding,
	IconChartBar,
	IconCreditCard,
	IconLogout,
	IconServer,
	IconSettings,
	IconShield,
	IconUsers,
} from "@tabler/icons-react";
```

Add this nav item after Worker Queue:

```tsx
		{
			href: "/platform-admin/diagnostics",
			icon: IconActivityHeartbeat,
			label: t("admin:admin.layout.nav.diagnostics", "Deployment Diagnostics"),
		},
```

- [ ] **Step 5: Add diagnostics to overview quick actions**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`:

Add `IconActivityHeartbeat` to the Tabler import list:

```tsx
import {
	IconActivityHeartbeat,
	IconAlertTriangle,
	IconArrowUpRight,
	IconBuilding,
	IconChevronRight,
	IconCreditCard,
	IconCurrencyEuro,
	IconUserBolt,
	IconUsers,
	IconUserX,
} from "@tabler/icons-react";
```

Change the quick-action grid to allow four cards comfortably:

```tsx
<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
```

Add this `QuickActionCard` after Organization Management:

```tsx
					<QuickActionCard
						title={t(
							"admin:admin.overview.quickActions.diagnostics.title",
							"Deployment Diagnostics",
						)}
						description={t(
							"admin:admin.overview.quickActions.diagnostics.description",
							"Review safe config and app health checks",
						)}
						href="/platform-admin/diagnostics"
						icon={<IconActivityHeartbeat className="size-5" />}
					/>
```

- [ ] **Step 6: Run layout/navigation tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Commit page and navigation work**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/layout.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
git commit -m "feat: add platform diagnostics page"
```

Expected: commit succeeds.

## Task 6: Verification And Documentation Update

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`

- [ ] **Step 1: Update platform-admin docs**

Modify `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx` by changing the route-set paragraph to mention diagnostics:

```mdx
Open `/platform-admin` to reach the platform-scoped admin area. The current route set includes an overview dashboard plus dedicated pages for users, organizations, deployment diagnostics, worker queue operations, settings, and optional billing views.
```

Add this section after the Organizations section and before “What Platform Admins Do Not Replace”:

```mdx
## Deployment Diagnostics

Use `/platform-admin/diagnostics` to review safe deployment configuration and app-only service health. The page reports configuration presence, database connectivity, queue/Valkey health, worker queue summary, and billing readiness without exposing secret values.

Diagnostics are read-only. They do not inspect Kubernetes state and do not provide restart, rollout, or scaling controls.
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/lib/platform-diagnostics/collector.test.ts 'src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts' 'src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx' 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Run the webapp test suite**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS.

- [ ] **Step 4: Run the production build when environment allows**

Run:

```bash
CI=true pnpm --filter webapp build
```

Expected: PASS. If the build requires unavailable Phase-managed system secrets, stop the build attempt and record which variables blocked verification in the final handoff.

- [ ] **Step 5: Commit docs and verification fixes**

Run:

```bash
git add apps/docs/content/docs/guide/admin-guide/platform-admin.mdx
git commit -m "docs: document platform diagnostics"
```

Expected: commit succeeds if docs changed. If verification required code fixes, add those touched files to the same commit with the docs update and use `git status --short` to confirm only intended files are staged.

## Self-Review Notes

- Spec coverage: route, nav, overview quick action, server-rendered initial snapshot, platform-admin-protected refresh, safe config states, database/queue checks, recommended actions, and redaction tests are all covered by Tasks 1-6.
- Secret handling: collector tests assert raw Turnstile and Stripe values are absent from serialized diagnostics.
- Scope control: plan excludes Kubernetes diagnostics and mutation controls, matching the approved app-only diagnostics scope.
- Type consistency: all tasks use `DiagnosticsStatus`, `DiagnosticsItem`, `QueueSummary`, and `PlatformDiagnosticsSnapshot` from `apps/webapp/src/lib/platform-diagnostics/types.ts`.
