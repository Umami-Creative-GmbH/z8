import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findAbsence: vi.fn(),
	dbDelete: vi.fn(),
	canCancelAbsence: vi.fn(),
	addCalendarSyncJob: vi.fn(),
	removeCanonicalAbsenceRecord: vi.fn(),
	getCurrentEmployee: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceEntry: {
				findFirst: mockState.findAbsence,
			},
		},
		delete: mockState.dbDelete,
	},
}));

vi.mock("@/lib/absences/permissions", () => ({
	canCancelAbsence: mockState.canCancelAbsence,
}));

vi.mock("@/lib/queue", () => ({
	addCalendarSyncJob: mockState.addCalendarSyncJob,
}));

vi.mock("./actions.canonical", () => ({
	removeCanonicalAbsenceRecord: mockState.removeCanonicalAbsenceRecord,
}));

vi.mock("./current-employee", () => ({
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

const mutations = await import("./mutations");

describe("absence mutations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects cancellation when the absence belongs to another organization", async () => {
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-2",
			organizationId: "org-2",
			status: "pending",
			canonicalRecordId: "record-1",
		});

		const result = await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Absence not found in the active organization",
		});
		expect(mockState.canCancelAbsence).not.toHaveBeenCalled();
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
		expect(mockState.removeCanonicalAbsenceRecord).not.toHaveBeenCalled();
		expect(mockState.dbDelete).not.toHaveBeenCalled();
	});
});
