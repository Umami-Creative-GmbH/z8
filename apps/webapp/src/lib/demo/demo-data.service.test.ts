import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { absenceEntry, approvalRequest, notification, timeEntry } from "@/db/schema";

const mocks = vi.hoisted(() => ({
	employees: [] as Array<{ id: string; organizationId: string; userId: string }>,
	categories: [] as Array<{ id: string; organizationId: string; type: string; isActive: boolean }>,
	managerAssignments: [] as Array<{ employeeId: string; managerId: string; isPrimary: boolean }>,
	ownerEmployee: null as { id: string; organizationId: string; userId: string } | null,
	latestTimeEntry: null as { id: string; hash: string } | null,
	workPeriods: [] as Array<{
		id: string;
		employeeId: string;
		organizationId: string;
		clockInId: string;
		startTime: Date;
		isActive: boolean;
	}>,
	existingApprovals: [] as Array<{ entityId: string }>,
	insertedAbsences: [] as Array<Record<string, unknown>>,
	insertedTimeEntries: [] as Array<Record<string, unknown>>,
	insertedApprovals: [] as Array<Record<string, unknown>>,
	insertedNotifications: [] as Array<Record<string, unknown>>,
	ensureDefaultAbsenceCategories: vi.fn(),
}));

vi.mock("@/lib/absences/default-absence-categories", () => ({
	ensureDefaultAbsenceCategoriesForOrganization: mocks.ensureDefaultAbsenceCategories,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: vi.fn(async () => mocks.ownerEmployee),
				findMany: vi.fn(async () => mocks.employees),
			},
			absenceCategory: {
				findMany: vi.fn(async () => mocks.categories),
			},
			employeeManagers: {
				findMany: vi.fn(async () => mocks.managerAssignments),
			},
			workPeriod: {
				findMany: vi.fn(async () => mocks.workPeriods),
			},
			approvalRequest: {
				findMany: vi.fn(async () => mocks.existingApprovals),
			},
			timeEntry: {
				findFirst: vi.fn(async () => mocks.latestTimeEntry),
			},
		},
		insert: vi.fn((table) => ({
			values: vi.fn((value: Record<string, unknown>) => {
				if (table === approvalRequest) {
					mocks.insertedApprovals.push(value);
				}

				if (table === notification) {
					mocks.insertedNotifications.push(value);
				}

				return {
					returning: vi.fn(async () => {
						if (table === absenceEntry) {
							mocks.insertedAbsences.push(value);
							return [{ id: `absence-${mocks.insertedAbsences.length}` }];
						}

						if (table === timeEntry) {
							mocks.insertedTimeEntries.push(value);
							return [{ id: `time-entry-${mocks.insertedTimeEntries.length}` }];
						}

						return [];
					}),
				};
			}),
		})),
	},
}));

describe("generateDemoPendingAbsenceApprovals", () => {
	beforeEach(() => {
		mocks.employees = [];
		mocks.categories = [];
		mocks.managerAssignments = [];
		mocks.ownerEmployee = null;
		mocks.latestTimeEntry = null;
		mocks.workPeriods = [];
		mocks.existingApprovals = [];
		mocks.insertedAbsences = [];
		mocks.insertedTimeEntries = [];
		mocks.insertedApprovals = [];
		mocks.insertedNotifications = [];
		mocks.ensureDefaultAbsenceCategories.mockReset();
	});

	it("creates pending absence entries with matching approval requests", async () => {
		const { generateDemoPendingAbsenceApprovals } = await import("./demo-data.service");

		mocks.employees = [
			{ id: "employee-1", organizationId: "org-1", userId: "user-1" },
			{ id: "employee-2", organizationId: "org-1", userId: "user-2" },
		];
		mocks.categories = [
			{ id: "personal-category", organizationId: "org-1", type: "personal", isActive: true },
			{ id: "vacation-category", organizationId: "org-1", type: "vacation", isActive: true },
		];
		mocks.managerAssignments = [
			{ employeeId: "employee-1", managerId: "employee-2", isPrimary: true },
			{ employeeId: "employee-2", managerId: "employee-2", isPrimary: true },
		];

		const result = await generateDemoPendingAbsenceApprovals({
			organizationId: "org-1",
			dateRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			createdBy: "user-1",
		});

		expect(result).toEqual({ pendingAbsenceApprovalsCreated: 2 });
		expect(mocks.ensureDefaultAbsenceCategories).toHaveBeenCalledWith("org-1");
		expect(mocks.insertedAbsences).toHaveLength(2);
		expect(mocks.insertedAbsences[0]).toMatchObject({
			organizationId: "org-1",
			employeeId: "employee-1",
			categoryId: "vacation-category",
			status: "pending",
			notes: "Demo data - Pending approval request",
		});
		expect(mocks.insertedApprovals).toEqual([
			{
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-1",
				requestedBy: "employee-1",
				approverId: "employee-2",
				status: "pending",
				reason: "Demo data - Pending absence approval",
			},
			{
				organizationId: "org-1",
				entityType: "absence_entry",
				entityId: "absence-2",
				requestedBy: "employee-2",
				approverId: "employee-1",
				status: "pending",
				reason: "Demo data - Pending absence approval",
			},
		]);
		expect(mocks.insertedNotifications).toEqual([
			{
				userId: "user-2",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "New absence request",
				message: "Demo data - Pending absence request needs approval.",
				entityType: "absence_entry",
				entityId: "absence-1",
				actionUrl: "/approvals/inbox",
			},
			{
				userId: "user-1",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "New absence request",
				message: "Demo data - Pending absence request needs approval.",
				entityType: "absence_entry",
				entityId: "absence-2",
				actionUrl: "/approvals/inbox",
			},
		]);
	});
});

describe("generateDemoPendingTimeCorrectionApprovals", () => {
	beforeEach(() => {
		mocks.employees = [];
		mocks.categories = [];
		mocks.managerAssignments = [];
		mocks.ownerEmployee = null;
		mocks.latestTimeEntry = null;
		mocks.workPeriods = [];
		mocks.existingApprovals = [];
		mocks.insertedAbsences = [];
		mocks.insertedTimeEntries = [];
		mocks.insertedApprovals = [];
		mocks.insertedNotifications = [];
		mocks.ensureDefaultAbsenceCategories.mockReset();
	});

	it("creates pending time correction approvals for completed periods without existing approvals", async () => {
		const { generateDemoPendingTimeCorrectionApprovals } = await import("./demo-data.service");

		mocks.employees = [
			{ id: "employee-1", organizationId: "org-1", userId: "user-1" },
			{ id: "employee-2", organizationId: "org-1", userId: "user-2" },
			{ id: "employee-3", organizationId: "org-1", userId: "user-3" },
		];
		mocks.workPeriods = [
			{
				id: "period-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				clockInId: "clock-in-1",
				startTime: new Date("2026-01-05T08:00:00.000Z"),
				isActive: false,
			},
			{
				id: "period-2",
				employeeId: "employee-2",
				organizationId: "org-1",
				clockInId: "clock-in-2",
				startTime: new Date("2026-01-06T08:00:00.000Z"),
				isActive: false,
			},
		];
		mocks.existingApprovals = [{ entityId: "period-2" }];
		mocks.managerAssignments = [
			{ employeeId: "employee-1", managerId: "employee-2", isPrimary: true },
			{ employeeId: "employee-2", managerId: "employee-2", isPrimary: true },
		];
		mocks.latestTimeEntry = { id: "latest-entry-1", hash: "latest-hash-1" };

		const result = await generateDemoPendingTimeCorrectionApprovals({
			organizationId: "org-1",
			dateRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			createdBy: "user-1",
		});

		expect(result).toEqual({ pendingTimeCorrectionApprovalsCreated: 1 });
		expect(mocks.insertedTimeEntries).toHaveLength(1);
		expect(mocks.insertedTimeEntries[0]).toMatchObject({
			employeeId: "employee-1",
			organizationId: "org-1",
			type: "correction",
			timestamp: new Date("2026-01-05T08:15:00.000Z"),
			replacesEntryId: "clock-in-1",
			notes: "Demo data - Pending time correction",
			createdBy: "user-1",
		});
		expect(mocks.insertedTimeEntries[0]?.hash).toEqual(expect.any(String));
		expect(mocks.insertedTimeEntries[0]).toMatchObject({
			previousHash: "latest-hash-1",
			previousEntryId: "latest-entry-1",
		});
		const latestEntryQuery = vi.mocked(db.query.timeEntry.findFirst).mock.calls.at(-1)?.[0];
		expect(latestEntryQuery?.orderBy(timeEntry, { desc: (column) => column })).toBe(
			timeEntry.createdAt,
		);
		expect(mocks.insertedApprovals).toEqual([
			{
				organizationId: "org-1",
				entityType: "time_entry",
				entityId: "period-1",
				requestedBy: "employee-1",
				approverId: "employee-2",
				status: "pending",
				reason: "Demo data - Pending time correction approval",
				metadata: { timeCorrection: { clockInCorrectionId: "time-entry-1" } },
			},
		]);
		expect(mocks.insertedNotifications).toEqual([
			{
				userId: "user-2",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "New time correction request",
				message: "Demo data - Pending time correction request needs approval.",
				entityType: "work_period",
				entityId: "period-1",
				actionUrl: "/approvals/inbox",
			},
		]);
	});
});

describe("generateDemoData", () => {
	beforeEach(() => {
		mocks.employees = [];
		mocks.categories = [];
		mocks.managerAssignments = [];
		mocks.ownerEmployee = null;
		mocks.latestTimeEntry = null;
		mocks.workPeriods = [];
		mocks.existingApprovals = [];
		mocks.insertedAbsences = [];
		mocks.insertedTimeEntries = [];
		mocks.insertedApprovals = [];
		mocks.insertedNotifications = [];
		mocks.ensureDefaultAbsenceCategories.mockReset();
	});

	it("returns pending approval counts when aggregate options are selected", async () => {
		const { generateDemoData } = await import("./demo-data.service");

		mocks.employees = [
			{ id: "employee-1", organizationId: "org-1", userId: "user-1" },
			{ id: "employee-2", organizationId: "org-1", userId: "user-2" },
		];
		mocks.categories = [
			{ id: "vacation-category", organizationId: "org-1", type: "vacation", isActive: true },
		];
		mocks.managerAssignments = [
			{ employeeId: "employee-1", managerId: "employee-2", isPrimary: true },
		];
		mocks.workPeriods = [
			{
				id: "period-1",
				employeeId: "employee-1",
				organizationId: "org-1",
				clockInId: "clock-in-1",
				startTime: new Date("2026-01-05T08:00:00.000Z"),
				isActive: false,
			},
		];

		const result = await generateDemoData({
			organizationId: "org-1",
			dateRange: { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includePendingAbsenceApprovals: true,
			includePendingTimeCorrectionApprovals: true,
			createdBy: "user-1",
		});

		expect(result.pendingAbsenceApprovalsCreated).toBe(2);
		expect(result.pendingTimeCorrectionApprovalsCreated).toBe(1);
	});
});
