import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	dbTransaction: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		transaction: mockState.dbTransaction,
	},
}));

const { canonicalWorkRecordClient } = await import("./canonical-work-record");

describe("canonicalWorkRecordClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("persists canonical work records with project allocation", async () => {
		const valuesRecord = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "record-1" }]),
		});
		const valuesWork = vi.fn().mockResolvedValue(undefined);
		const valuesAllocation = vi.fn().mockResolvedValue(undefined);

		const txInsert = vi
			.fn()
			.mockReturnValueOnce({ values: valuesRecord })
			.mockReturnValueOnce({ values: valuesWork })
			.mockReturnValueOnce({ values: valuesAllocation });

		mockState.dbTransaction.mockImplementation(
			async (callback: (tx: { insert: typeof txInsert }) => Promise<unknown>) =>
				callback({ insert: txInsert }),
		);

		const result = await canonicalWorkRecordClient.createForCompletedPeriod({
			organizationId: "org-1",
			employeeId: "emp-1",
			startAt: new Date("2026-01-01T08:00:00.000Z"),
			endAt: new Date("2026-01-01T16:00:00.000Z"),
			durationMinutes: 480,
			approvalState: "approved",
			createdBy: "user-1",
			workCategoryId: "wc-1",
			projectId: "project-1",
			origin: "clock",
		});

		expect(result).toEqual({ id: "record-1" });
		expect(mockState.dbTransaction).toHaveBeenCalledTimes(1);
		expect(txInsert).toHaveBeenCalledTimes(3);
		expect(valuesWork).toHaveBeenCalledWith(
			expect.objectContaining({
				recordId: "record-1",
				organizationId: "org-1",
				workCategoryId: "wc-1",
			}),
		);
		expect(valuesAllocation).toHaveBeenCalledWith(
			expect.objectContaining({
				recordId: "record-1",
				organizationId: "org-1",
				allocationKind: "project",
				projectId: "project-1",
				weightPercent: 100,
			}),
		);
	});

	it("uses a caller-owned transaction for canonical work records", async () => {
		const valuesRecord = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "record-1" }]),
		});
		const valuesWork = vi.fn().mockResolvedValue(undefined);
		const txInsert = vi
			.fn()
			.mockReturnValueOnce({ values: valuesRecord })
			.mockReturnValueOnce({ values: valuesWork });
		const tx = { insert: txInsert };

		const result = await canonicalWorkRecordClient.createForCompletedPeriod(
			{
				organizationId: "org-1",
				employeeId: "emp-1",
				startAt: new Date("2026-01-01T08:00:00.000Z"),
				endAt: new Date("2026-01-01T16:00:00.000Z"),
				durationMinutes: 480,
				approvalState: "approved",
				createdBy: "user-1",
				origin: "clock",
			},
			tx as never,
		);

		expect(result).toEqual({ id: "record-1" });
		expect(txInsert).toHaveBeenCalledTimes(2);
		expect(mockState.dbTransaction).not.toHaveBeenCalled();
	});
});
