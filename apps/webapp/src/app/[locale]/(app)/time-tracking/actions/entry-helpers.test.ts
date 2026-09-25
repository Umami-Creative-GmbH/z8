import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	calculateHash: vi.fn(() => "entry-hash"),
	getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" })),
	findProject: vi.fn(),
	listEligibleProjects: vi.fn(),
	isProjectEligible: vi.fn(),
	hoursRows: vi.fn(async () => [] as { projectId: string; totalMinutes: number }[]),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			project: { findFirst: mocks.findProject },
		},
		select: () => ({
			from: () => ({ where: () => ({ groupBy: mocks.hoursRows }) }),
		}),
	},
}));
vi.mock("@/lib/time-tracking/blockchain", () => ({ calculateHash: mocks.calculateHash }));
vi.mock("./auth", () => ({ getRequestMetadata: mocks.getRequestMetadata }));
// The rule itself is SQL; clocking.manual-eligibility.integration.test.ts proves it on PostgreSQL.
vi.mock("@/lib/time-tracking/project-eligibility", () => ({
	listEligibleProjects: mocks.listEligibleProjects,
	isProjectEligible: mocks.isProjectEligible,
}));

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
	});

	it("accepts exactly what the shared rule accepts, without further reads", async () => {
		mocks.isProjectEligible.mockResolvedValue(true);

		await expect(
			validateProjectAssignment("project-active", "employee-1", "team-1", "org-1"),
		).resolves.toEqual({ isValid: true });
		expect(mocks.isProjectEligible).toHaveBeenCalledWith(
			{ employeeId: "employee-1", teamId: "team-1", organizationId: "org-1" },
			"project-active",
			expect.anything(),
		);
		expect(mocks.findProject).not.toHaveBeenCalled();
	});

	it("explains a refusal of the shared rule", async () => {
		mocks.isProjectEligible.mockResolvedValue(false);
		const explain = async (found: object | undefined) => {
			mocks.findProject.mockResolvedValueOnce(found);
			return validateProjectAssignment("project-active", "employee-1", null, "org-1");
		};

		await expect(explain(undefined)).resolves.toEqual({
			isValid: false,
			error: "Project not found",
		});
		await expect(explain({ ...activeProject, isActive: false })).resolves.toEqual({
			isValid: false,
			error: "Cannot book time to an inactive project",
		});
		await expect(explain({ ...activeProject, status: "completed" })).resolves.toMatchObject({
			isValid: false,
			error: expect.stringContaining("completed"),
		});
		// Eligible-looking but refused: not assigned (directly or through the team).
		await expect(explain(activeProject)).resolves.toEqual({
			isValid: false,
			error: "You are not assigned to this project. Contact your administrator.",
		});
	});

	it("offers the shared rule's projects with their booked hours", async () => {
		mocks.listEligibleProjects.mockResolvedValue([activeProject]);
		mocks.hoursRows.mockResolvedValue([{ projectId: "project-active", totalMinutes: 90 }]);

		const { projectsById, hoursByProjectId } = await getAssignedProjectsWithHours(
			"employee-1",
			"org-1",
			"team-1",
		);

		expect(mocks.listEligibleProjects).toHaveBeenCalledWith({
			employeeId: "employee-1",
			teamId: "team-1",
			organizationId: "org-1",
		});
		expect(Array.from(projectsById.keys())).toEqual(["project-active"]);
		expect(hoursByProjectId.get("project-active")).toBe(1.5);
	});
});
