import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
// The rule itself is SQL; clocking.manual-eligibility.integration.test.ts proves it on PostgreSQL.
vi.mock("@/lib/time-tracking/project-eligibility", () => ({
	listEligibleProjects: mocks.listEligibleProjects,
	isProjectEligible: mocks.isProjectEligible,
	BOOKABLE_PROJECT_STATUSES: ["planned", "active", "paused"],
}));

const { getAssignedProjectsWithHours, validateProjectAssignment } = await import("./entry-helpers");

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
