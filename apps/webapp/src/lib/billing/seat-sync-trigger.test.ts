import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerError = vi.fn();

vi.mock("@/env", () => ({ env: { BILLING_ENABLED: "true" } }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: loggerError }),
}));

describe("reconcileBillingSeatsForOrganization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("propagates reconciliation failures in strict mode", async () => {
		const failure = new Error("stripe raw failure");
		const { reconcileBillingSeatsForOrganization } = await import(
			"./seat-sync-trigger"
		);

		await expect(
			reconcileBillingSeatsForOrganization("org-1", {
				strict: true,
				run: () => Promise.reject(failure),
			}),
		).rejects.toBe(failure);
		expect(loggerError).toHaveBeenCalledOnce();
	});

	it("preserves best-effort behavior when strict mode is not requested", async () => {
		const failure = new Error("stripe unavailable");
		const { reconcileBillingSeatsForOrganization } = await import(
			"./seat-sync-trigger"
		);

		await expect(
			reconcileBillingSeatsForOrganization("org-1", {
				run: () => Promise.reject(failure),
			}),
		).resolves.toBeUndefined();
		expect(loggerError).toHaveBeenCalledOnce();
	});

	it("loads independent seat-sync runtime modules in parallel", () => {
		const source = readFileSync(
			new URL("./seat-sync-trigger.ts", import.meta.url),
			"utf8",
		);
		const runtimeLoader = source.slice(
			source.indexOf("async function getSeatSyncRuntime"),
			source.indexOf(
				"export async function reconcileBillingSeatsForOrganization",
			),
		);

		expect(runtimeLoader).toContain("await Promise.all([");
		expect(runtimeLoader).toContain('import("effect")');
		expect(runtimeLoader).toContain('import("@/lib/effect/services/billing")');
	});
});
