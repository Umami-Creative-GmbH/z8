import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	calculateHash: vi.fn(() => "entry-hash"),
	getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" })),
	findProject: vi.fn(),
	findAssignment: vi.fn(),
	findAssignments: vi.fn(),
	hoursRows: vi.fn(async () => [] as { projectId: string; totalMinutes: number }[]),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			project: { findFirst: mocks.findProject },
			projectAssignment: {
				findFirst: mocks.findAssignment,
				findMany: mocks.findAssignments,
			},
		},
		select: () => ({
			from: () => ({ where: () => ({ groupBy: mocks.hoursRows }) }),
		}),
	},
}));
vi.mock("@/lib/time-tracking/blockchain", () => ({ calculateHash: mocks.calculateHash }));
vi.mock("./auth", () => ({ getRequestMetadata: mocks.getRequestMetadata }));

const { createTimeEntry, getAssignedProjectsWithHours, validateProjectAssignment } = await import(
	"./entry-helpers"
);

describe("createTimeEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stores the previous entry ID with the previous hash", async () => {
		const previousEntry = { id: "entry-previous", hash: "previous-hash" };
		const limit = vi.fn().mockResolvedValue([previousEntry]);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		const returning = vi.fn().mockResolvedValue([{ id: "entry-new" }]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));

		await createTimeEntry(
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "correction",
				timestamp: new Date("2026-07-01T08:15:00.000Z"),
				createdBy: "user-1",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
			},
			{ select, insert } as never,
		);

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				previousHash: "previous-hash",
				previousEntryId: "entry-previous",
			}),
		);
	});

	it("uses an explicit chain predecessor without querying for it again", async () => {
		const select = vi.fn();
		const returning = vi.fn().mockResolvedValue([{ id: "entry-new" }]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));

		await createTimeEntry(
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "correction",
				timestamp: new Date("2026-07-01T08:15:00.000Z"),
				createdBy: "user-1",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
				chainAfter: {
					id: "entry-first",
					hash: "first-hash",
					employeeId: "employee-1",
					organizationId: "org-1",
				},
			},
			{ select, insert } as never,
		);

		expect(select).not.toHaveBeenCalled();
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				previousHash: "first-hash",
				previousEntryId: "entry-first",
			}),
		);
	});

	it("rejects a chain predecessor from another employee or organization", async () => {
		await expect(
			createTimeEntry(
				{
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "correction",
					timestamp: new Date("2026-07-01T08:15:00.000Z"),
					createdBy: "user-1",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "user_setting",
					chainAfter: {
						id: "entry-other",
						hash: "other-hash",
						employeeId: "employee-2",
						organizationId: "org-1",
					},
				},
				{ select: vi.fn(), insert: vi.fn() } as never,
			),
		).rejects.toThrow("same employee and organization");
	});
});

describe("project booking eligibility", () => {
	const activeProject = {
		id: "project-active",
		name: "Active",
		color: null,
		status: "active",
		isActive: true,
		budgetHours: null,
		deadline: null,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findAssignment.mockResolvedValue({ id: "assignment-1" });
	});

	it("rejects a bookable-status project that has been deactivated", async () => {
		mocks.findProject.mockResolvedValue({ ...activeProject, isActive: false });

		await expect(
			validateProjectAssignment("project-active", "employee-1", "team-1", "org-1"),
		).resolves.toEqual({
			isValid: false,
			error: "Cannot book time to an inactive project",
		});
		expect(mocks.findAssignment).not.toHaveBeenCalled();
	});

	it("accepts an active, bookable project assigned to the employee", async () => {
		mocks.findProject.mockResolvedValue(activeProject);

		await expect(
			validateProjectAssignment("project-active", "employee-1", "team-1", "org-1"),
		).resolves.toEqual({ isValid: true });
	});

	it("offers only active projects in a bookable status", async () => {
		mocks.findAssignments
			.mockResolvedValueOnce([
				{ project: activeProject },
				{ project: { ...activeProject, id: "project-inactive", isActive: false } },
				{ project: { ...activeProject, id: "project-done", status: "completed" } },
			])
			.mockResolvedValueOnce([]);

		const { projectsById } = await getAssignedProjectsWithHours("employee-1", "org-1", "team-1");

		expect(Array.from(projectsById.keys())).toEqual(["project-active"]);
	});
});
