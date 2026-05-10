import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

	it("recommends checking queue configuration when worker queue has failed jobs", async () => {
		const snapshot = await collectPlatformDiagnostics(
			buildDeps({
				checkQueue: async () => true,
				getQueueSummary: async (): Promise<QueueSummary> => ({
					waiting: 0,
					active: 0,
					failed: 1,
					delayed: 0,
				}),
			}),
		);

		expect(snapshot.health).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Queue / Valkey", status: "healthy", value: "Connected" }),
				expect.objectContaining({ title: "Worker queue", status: "warning", value: "0 waiting, 0 active, 1 failed, 0 delayed" }),
			]),
		);
		expect(snapshot.recommendedActions).toContain("Check Valkey/Redis connectivity and worker queue configuration.");
	});

	it("queries cookie consent configuration directly in default dependencies", () => {
		const source = readFileSync(fileURLToPath(new URL("./collector.ts", import.meta.url)), "utf8");

		expect(source).toContain("cookie_consent_script");
		expect(source).not.toContain("getCookieConsentScript");
	});
});
