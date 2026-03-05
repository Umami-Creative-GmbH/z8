import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	dbTransaction: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

vi.mock("@/db", () => ({
	db: {
		transaction: mockState.dbTransaction,
	},
}));

const actions = await import("./actions");

describe("absence canonical action routing", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("syncs absence requests to canonical records with org scoping", async () => {
		const createSpy = vi
			.spyOn(actions.canonicalAbsenceRecordClient, "create")
			.mockResolvedValue({ id: "rec-1" } as never);

		await actions.syncAbsenceRequestToCanonicalRecord({
			organizationId: "org-1",
			employeeId: "emp-1",
			absenceCategoryId: "cat-1",
			startDate: "2026-02-10",
			startPeriod: "full_day",
			endDate: "2026-02-12",
			endPeriod: "full_day",
			countsAgainstVacation: false,
			requiresApproval: true,
			createdBy: "user-1",
		});

		expect(createSpy).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "emp-1",
			absenceCategoryId: "cat-1",
			startDate: "2026-02-10",
			startPeriod: "full_day",
			endDate: "2026-02-12",
			endPeriod: "full_day",
			countsAgainstVacation: false,
			requiresApproval: true,
			createdBy: "user-1",
		});
	});

	it("maps same-day half-day requests to partial canonical timestamps", () => {
		const mapped = actions.mapAbsenceRangeToCanonicalTimestamps({
			startDate: "2026-02-10",
			startPeriod: "pm",
			endDate: "2026-02-10",
			endPeriod: "pm",
		});

		expect(mapped.startAt.toISOString()).toBe("2026-02-10T12:00:00.000Z");
		expect(mapped.endAt.toISOString()).toBe("2026-02-10T23:59:59.999Z");
	});

	it("fails the action when canonical sync fails", async () => {
		vi.spyOn(actions.canonicalAbsenceRecordClient, "create").mockRejectedValue(
			new Error("canonical write failed"),
		);

		await expect(
			actions.syncAbsenceRequestToCanonicalRecord({
			organizationId: "org-1",
			employeeId: "emp-1",
			absenceCategoryId: "cat-1",
			startDate: "2026-02-10",
			startPeriod: "full_day",
			endDate: "2026-02-12",
			endPeriod: "full_day",
			countsAgainstVacation: true,
			requiresApproval: false,
			createdBy: "user-1",
			}),
		).rejects.toThrow("canonical write failed");
	});

	it("persists canonical absence subtype with category linkage", async () => {
		const valuesRecord = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: "record-1" }]),
		});
		const valuesAbsence = vi.fn().mockResolvedValue(undefined);

		const txInsert = vi
			.fn()
			.mockReturnValueOnce({ values: valuesRecord })
			.mockReturnValueOnce({ values: valuesAbsence });

		mockState.dbTransaction.mockImplementation(async (callback: any) =>
			callback({ insert: txInsert }),
		);

		const record = await actions.canonicalAbsenceRecordClient.create({
			organizationId: "org-1",
			employeeId: "emp-1",
			absenceCategoryId: "cat-1",
			startDate: "2026-02-10",
			startPeriod: "am",
			endDate: "2026-02-10",
			endPeriod: "pm",
			countsAgainstVacation: false,
			requiresApproval: true,
			createdBy: "user-1",
		});

		expect(record).toEqual({ id: "record-1" });
		expect(valuesAbsence).toHaveBeenCalledWith(
			expect.objectContaining({
				recordId: "record-1",
				organizationId: "org-1",
				absenceCategoryId: "cat-1",
				startPeriod: "am",
				endPeriod: "pm",
				countsAgainstVacation: false,
			}),
		);
	});
});
