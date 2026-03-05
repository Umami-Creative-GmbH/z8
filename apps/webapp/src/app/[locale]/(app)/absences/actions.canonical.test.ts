import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	dbTransaction: vi.fn(),
	dbUpdate: vi.fn(),
	dbDelete: vi.fn(),
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
		update: mockState.dbUpdate,
		delete: mockState.dbDelete,
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

	it("updates canonical absence approval state with org scoping", async () => {
		const whereUpdate = vi.fn().mockResolvedValue(undefined);
		const setUpdate = vi.fn().mockReturnValue({ where: whereUpdate });
		mockState.dbUpdate.mockReturnValue({ set: setUpdate });

		await actions.syncCanonicalAbsenceApprovalState({
			canonicalRecordId: "record-1",
			organizationId: "org-1",
			approvalState: "approved",
			updatedBy: "user-1",
		});

		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(setUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalState: "approved",
				updatedBy: "user-1",
			}),
		);
		expect(whereUpdate).toHaveBeenCalledTimes(1);
	});

	it("deletes canonical absence record on cancellation when linked", async () => {
		const whereDelete = vi.fn().mockResolvedValue(undefined);
		mockState.dbDelete.mockReturnValue({ where: whereDelete });

		await actions.removeCanonicalAbsenceRecord({
			canonicalRecordId: "record-1",
			organizationId: "org-1",
		});

		expect(mockState.dbDelete).toHaveBeenCalledTimes(1);
		expect(whereDelete).toHaveBeenCalledTimes(1);
	});

	it("skips canonical absence deletion when no linkage exists", async () => {
		await actions.removeCanonicalAbsenceRecord({
			canonicalRecordId: null,
			organizationId: "org-1",
		});

		expect(mockState.dbDelete).not.toHaveBeenCalled();
	});
});
