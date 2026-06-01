import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: { BILLING_ENABLED: "false" },
	findMany: vi.fn(),
	isNotNull: vi.fn((column) => ({ type: "isNotNull", column })),
	syncSeatsForOrganization: vi.fn(),
	loggerError: vi.fn(),
	stripeSubscriptionIdColumn: { name: "stripe_subscription_id" },
}));

vi.mock("@/env", () => ({
	env: mockState.env,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			subscription: {
				findMany: mockState.findMany,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	subscription: {
		stripeSubscriptionId: mockState.stripeSubscriptionIdColumn,
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	isNotNull: mockState.isNotNull,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: mockState.loggerError,
	}),
}));

vi.mock("@/lib/effect/services/billing", async () => {
	const { Context, Effect, Layer } = await import("effect");

	class SeatSyncService extends Context.Tag("SeatSyncService")<
		SeatSyncService,
		{
			readonly syncSeatsForOrganization: (organizationId: string) => Effect.Effect<number, unknown>;
		}
	>() {}

	const SeatSyncServiceLive = Layer.succeed(
		SeatSyncService,
		SeatSyncService.of({
			syncSeatsForOrganization: (organizationId) =>
				Effect.tryPromise({
					try: () => mockState.syncSeatsForOrganization(organizationId),
					catch: (error) => error,
				}),
		}),
	);

	return {
		SeatSyncService,
		SeatSyncServiceLive,
		StripeServiceLive: Layer.empty,
		SubscriptionServiceLive: Layer.empty,
	};
});

import { runBillingSeatReconciliation } from "./billing-seat-reconciliation";

describe("runBillingSeatReconciliation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.env.BILLING_ENABLED = "false";
		mockState.findMany.mockResolvedValue([]);
		mockState.syncSeatsForOrganization.mockResolvedValue(1);
	});

	it("skips all billing work when billing is disabled", async () => {
		const result = await runBillingSeatReconciliation();

		expect(result).toEqual({
			success: true,
			billingEnabled: false,
			processed: 0,
			synced: 0,
			skipped: 1,
			errors: [],
		});
		expect(mockState.findMany).not.toHaveBeenCalled();
		expect(mockState.syncSeatsForOrganization).not.toHaveBeenCalled();
	});

	it("syncs each Stripe-backed subscription and records per-organization failures", async () => {
		mockState.env.BILLING_ENABLED = "true";
		mockState.findMany.mockResolvedValue([
			{ organizationId: "org-success" },
			{ organizationId: "org-failure" },
		]);
		mockState.syncSeatsForOrganization
			.mockResolvedValueOnce(3)
			.mockRejectedValueOnce(new Error("stripe quantity update failed"));

		const result = await runBillingSeatReconciliation();

		expect(mockState.findMany).toHaveBeenCalledWith({
			where: { type: "isNotNull", column: mockState.stripeSubscriptionIdColumn },
			columns: { organizationId: true },
		});
		expect(mockState.syncSeatsForOrganization).toHaveBeenCalledTimes(2);
		expect(mockState.syncSeatsForOrganization).toHaveBeenNthCalledWith(1, "org-success");
		expect(mockState.syncSeatsForOrganization).toHaveBeenNthCalledWith(2, "org-failure");
		expect(mockState.loggerError).toHaveBeenCalledWith(
			{ error: expect.any(Error), organizationId: "org-failure" },
			"Failed to reconcile billing seats",
		);
		expect(result).toEqual({
			success: false,
			billingEnabled: true,
			processed: 2,
			synced: 1,
			skipped: 0,
			errors: [{ organizationId: "org-failure", error: "stripe quantity update failed" }],
		});
	});
});
