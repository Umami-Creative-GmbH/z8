import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { execute: executeMock },
}));

describe("daily digest delivery ledger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("claims a recipient-local daily Telegram digest only once", async () => {
		executeMock.mockResolvedValueOnce({ rows: [{ id: "delivery-1" }] });
		const { claimDailyDigestDelivery } = await import("./daily-digest-delivery");

		const deliveryId = await claimDailyDigestDelivery({
			organizationId: "org-1",
			recipientUserId: "user-1",
			platform: "telegram",
			type: "daily_digest",
			recipientLocalDate: "2026-07-10",
		});

		expect(deliveryId).toBe("delivery-1");
		expect(executeMock).toHaveBeenCalledTimes(1);
	});

	it("does not claim an already-sent digest", async () => {
		executeMock.mockResolvedValueOnce({ rows: [] });
		const { claimDailyDigestDelivery } = await import("./daily-digest-delivery");

		await expect(
			claimDailyDigestDelivery({
				organizationId: "org-1",
				recipientUserId: "user-1",
				platform: "telegram",
				type: "daily_digest",
				recipientLocalDate: "2026-07-10",
			}),
		).resolves.toBeNull();
	});

	it("marks a claimed digest as failed so it can be retried", async () => {
		executeMock.mockResolvedValueOnce({ rows: [] });
		const { markDailyDigestDeliveryFailed } = await import("./daily-digest-delivery");

		await markDailyDigestDeliveryFailed({
			id: "delivery-1",
			organizationId: "org-1",
		});

		expect(executeMock).toHaveBeenCalledTimes(1);
	});

	it("marks a claimed digest as sent", async () => {
		executeMock.mockResolvedValueOnce({ rows: [] });
		const { markDailyDigestDeliverySent } = await import("./daily-digest-delivery");

		await markDailyDigestDeliverySent({
			id: "delivery-1",
			organizationId: "org-1",
		});

		expect(executeMock).toHaveBeenCalledTimes(1);
	});
});
