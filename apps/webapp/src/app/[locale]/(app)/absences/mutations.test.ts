import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findAbsence: vi.fn(),
	findOrganization: vi.fn(),
	findManagerLinks: vi.fn(),
	dbDelete: vi.fn(),
	canCancelAbsence: vi.fn(),
	addCalendarSyncJob: vi.fn(),
	removeCanonicalAbsenceRecord: vi.fn(),
	getCurrentEmployee: vi.fn(),
	onApprovedAbsenceCancelledByEmployee: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceEntry: {
				findFirst: mockState.findAbsence,
			},
			organization: {
				findFirst: mockState.findOrganization,
			},
			employeeManagers: {
				findMany: mockState.findManagerLinks,
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

vi.mock("@/lib/notifications/triggers", () => ({
	onApprovedAbsenceCancelledByEmployee: mockState.onApprovedAbsenceCancelledByEmployee,
}));

const mutations = await import("./mutations");

describe("absence mutations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		mockState.findOrganization.mockResolvedValue({ timezone: "UTC" });
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.dbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
		mockState.removeCanonicalAbsenceRecord.mockResolvedValue(undefined);
		mockState.canCancelAbsence.mockResolvedValue(true);
	});

	it("rejects cancellation when the absence belongs to another organization", async () => {
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-2",
			organizationId: "org-2",
			status: "pending",
			startDate: "2026-05-20",
			endDate: "2026-05-21",
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

	it("passes org-local today and start date into permission checks for approved future own absences", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-20T01:30:00.000Z"));
		mockState.findOrganization.mockResolvedValue({ timezone: "America/New_York" });
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "approved",
			startDate: "2026-05-20",
			endDate: "2026-05-21",
			canonicalRecordId: "record-1",
			employee: { user: { name: "Avery Employee" } },
			category: { name: "Vacation" },
		});

		await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(mockState.canCancelAbsence).toHaveBeenCalledWith("emp-1", "emp-1", "approved", {
			startDate: "2026-05-20",
			today: "2026-05-19",
		});
	});

	it("rejects approved own absences that have already started without delete or calendar side effects", async () => {
		mockState.canCancelAbsence.mockResolvedValue(false);
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "approved",
			startDate: "2026-05-20",
			endDate: "2026-05-21",
			canonicalRecordId: "record-1",
			employee: { user: { name: "Avery Employee" } },
			category: { name: "Vacation" },
		});

		const result = await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Approved absences can only be cancelled before they start",
		});
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
		expect(mockState.removeCanonicalAbsenceRecord).not.toHaveBeenCalled();
		expect(mockState.dbDelete).not.toHaveBeenCalled();
	});

	it("notifies only same-organization assigned managers after approved self-cancellation succeeds", async () => {
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "approved",
			startDate: "2026-05-22",
			endDate: "2026-05-23",
			canonicalRecordId: "record-1",
			employee: { user: { name: "Avery Employee" } },
			category: { name: "Vacation" },
		});
		mockState.findManagerLinks.mockResolvedValue([
			{ manager: { userId: "manager-user-1", organizationId: "org-1" } },
			{ manager: { userId: "manager-user-2", organizationId: "org-2" } },
		]);

		const result = await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({ success: true });
		expect(mockState.onApprovedAbsenceCancelledByEmployee).toHaveBeenCalledTimes(1);
		expect(mockState.onApprovedAbsenceCancelledByEmployee).toHaveBeenCalledWith({
			absenceId: "absence-1",
			managerUserId: "manager-user-1",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-22",
			endDate: "2026-05-23",
		});
	});

	it("does not notify managers for pending cancellation", async () => {
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "pending",
			startDate: "2026-05-22",
			endDate: "2026-05-23",
			canonicalRecordId: "record-1",
			employee: { user: { name: "Avery Employee" } },
			category: { name: "Vacation" },
		});
		mockState.findManagerLinks.mockResolvedValue([{ manager: { userId: "manager-user-1" } }]);

		const result = await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({ success: true });
		expect(mockState.onApprovedAbsenceCancelledByEmployee).not.toHaveBeenCalled();
	});
});
