import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerError = vi.fn();
const kioskSeatUpgrades = vi.fn();

vi.mock("@/env", () => ({ env: { BILLING_ENABLED: "true" } }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: loggerError }),
}));
vi.mock("@/lib/effect/services/billing", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const { StripeError } = await import("@/lib/effect/errors");

	class SeatSyncService extends Context.Service<
		SeatSyncService,
		{
			readonly syncSeatsForOrganization: (organizationId: string) => Effect.Effect<number, unknown>;
			readonly handleKioskSeatUpgraded: (
				organizationId: string,
				memberId: string,
				userId: string,
			) => Effect.Effect<void>;
		}
	>()("SeatSyncService") {}

	return {
		SeatSyncService,
		BillingServicesLive: Layer.succeed(
			SeatSyncService,
			SeatSyncService.of({
				syncSeatsForOrganization: () =>
					Effect.fail(
						new StripeError({
							message: "Stripe seat delivery is uncertain and will be reconciled",
							operation: "syncSeatsForOrganization",
						}),
					),
				handleKioskSeatUpgraded: (organizationId, memberId, userId) =>
					Effect.sync(() => kioskSeatUpgrades(organizationId, memberId, userId)),
			}),
		),
	};
});
vi.mock("@/lib/effect/runtime", async () =>
	(await import("@/test/effect-runtime")).runtimeModuleOver(),
);

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

	it("rejects with the seat sync's StripeError itself in strict mode", async () => {
		const { StripeError } = await import("@/lib/effect/errors");
		const { reconcileBillingSeatsForOrganization } = await import(
			"./seat-sync-trigger"
		);

		const rejection = reconcileBillingSeatsForOrganization("org-1", {
			strict: true,
		});

		await expect(rejection).rejects.toBeInstanceOf(StripeError);
		await expect(rejection).rejects.toMatchObject({
			message: "Stripe seat delivery is uncertain and will be reconciled",
		});
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
		expect(runtimeLoader).toContain('import("@/lib/effect/runtime")');
		expect(runtimeLoader).toContain('import("@/lib/effect/services/billing")');
	});
});

describe("syncBillingSeatsAfterMemberChange", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("moves a kiosk-only employee's seat to a full seat when they gain an email (#886)", async () => {
		const { syncBillingSeatsAfterMemberChange } = await import("./seat-sync-trigger");

		await syncBillingSeatsAfterMemberChange({
			organizationId: "org-1",
			memberId: "member-1",
			userId: "user-1",
			change: "kiosk_seat_upgraded",
		});

		expect(kioskSeatUpgrades).toHaveBeenCalledExactlyOnceWith("org-1", "member-1", "user-1");
		expect(loggerError).not.toHaveBeenCalled();
	});
});
