import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	findUserSettings: vi.fn(),
	findOrganization: vi.fn(),
	findUser: vi.fn(),
	getPrincipalContext: vi.fn(),
	getAvailableCategoriesForEmployee: vi.fn(),
	getAssignedProjectsWithHours: vi.fn(),
	readAppendAdmission: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mocks.findEmployee },
			userSettings: { findFirst: mocks.findUserSettings },
			organization: { findFirst: mocks.findOrganization },
			user: { findFirst: mocks.findUser },
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({
	getPrincipalContext: mocks.getPrincipalContext,
}));
vi.mock("@/lib/query/work-category.queries", () => ({
	getAvailableCategoriesForEmployee: mocks.getAvailableCategoriesForEmployee,
}));
vi.mock("./entry-helpers", () => ({
	getAssignedProjectsWithHours: mocks.getAssignedProjectsWithHours,
}));
vi.mock("@/lib/time-tracking/work-transaction", () => ({
	readAppendAdmission: mocks.readAppendAdmission,
}));

const { getManualEntryTargetContextForEmployee, resolveManualEntryTargetZone } =
	await import("./manual-entry-target");

type Actor = Parameters<
	typeof getManualEntryTargetContextForEmployee
>[0]["currentEmployee"];

function employeeRecord(overrides: Partial<Actor> = {}): Actor {
	return {
		id: "manager-1",
		userId: "manager-user",
		organizationId: "org-1",
		teamId: "team-1",
		role: "manager",
		isActive: true,
		...overrides,
	} as Actor;
}

const staff = employeeRecord({
	id: "staff-1",
	userId: "staff-user",
	role: "employee",
	teamId: "team-2",
});

function principal(options: {
	role: "admin" | "manager" | "employee";
	orgRole?: "owner" | "admin" | "member";
	managedEmployeeIds?: string[];
	customRoles?: unknown[];
}) {
	return {
		userId: "manager-user",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: {
			organizationId: "org-1",
			role: options.orgRole ?? "member",
			status: "active",
		},
		employee: {
			id: "manager-1",
			organizationId: "org-1",
			role: options.role,
			teamId: "team-1",
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: options.managedEmployeeIds ?? [],
		customRoles: options.customRoles ?? [],
	};
}

describe("getManualEntryTargetContextForEmployee", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.readAppendAdmission.mockResolvedValue("legacy");
		mocks.findUserSettings.mockResolvedValue({ timezone: "Europe/Berlin" });
		mocks.findOrganization.mockResolvedValue({ timezone: "America/New_York" });
		mocks.findUser.mockResolvedValue({
			firstName: "Bertha",
			lastName: "Sipes",
			name: "Bertha Sipes",
			email: "bertha@example.com",
		});
		mocks.getAssignedProjectsWithHours.mockResolvedValue({
			projectsById: new Map([
				[
					"project-b",
					{
						id: "project-b",
						name: "Beta",
						color: null,
						status: "active",
						budgetHours: "10.5",
						deadline: new Date("2026-06-01T00:00:00.000Z"),
					},
				],
				[
					"project-a",
					{
						id: "project-a",
						name: "Alpha",
						color: "#fff",
						status: "planned",
						budgetHours: null,
						deadline: null,
					},
				],
			]),
			hoursByProjectId: new Map([["project-b", 2.5]]),
		});
		mocks.getAvailableCategoriesForEmployee.mockResolvedValue([
			{
				id: "category-1",
				organizationId: "org-1",
				name: "Night",
				description: null,
				factor: "1.25",
				color: null,
				isActive: true,
				createdAt: new Date(),
				sortOrder: 0,
			},
		]);
	});

	it("returns the signed-in employee's own zone and choices without an on-behalf check", async () => {
		const self = employeeRecord({ role: "employee" });

		const result = await getManualEntryTargetContextForEmployee({
			currentEmployee: self,
		});

		expect(mocks.getPrincipalContext).not.toHaveBeenCalled();
		expect(result).toEqual({
			success: true,
			data: {
				targetEmployeeId: "manager-1",
				targetName: "Bertha Sipes",
				isOwnEntry: true,
				timezone: "Europe/Berlin",
				timezoneSource: "employee",
				manualCommandVersion: 1,
				// The session's user and organization scope frozen command recovery (#310).
				recoveryContext: { userId: "manager-user", organizationId: "org-1" },
				projects: [
					{
						id: "project-a",
						name: "Alpha",
						color: "#fff",
						status: "planned",
						budgetHours: null,
						deadline: null,
						totalHoursBooked: 0,
					},
					{
						id: "project-b",
						name: "Beta",
						color: null,
						status: "active",
						budgetHours: 10.5,
						deadline: "2026-06-01T00:00:00.000Z",
						totalHoursBooked: 2.5,
					},
				],
				categories: [
					{ id: "category-1", name: "Night", factor: "1.25", color: null },
				],
			},
		});
	});

	it("advertises version-2 commands once the organization has adopted them", async () => {
		mocks.readAppendAdmission.mockResolvedValue("append");

		const result = await getManualEntryTargetContextForEmployee({
			currentEmployee: employeeRecord({ role: "employee" }),
		});

		expect(result.success && result.data.manualCommandVersion).toBe(2);
		expect(mocks.readAppendAdmission).toHaveBeenCalledWith(expect.anything(), "org-1");
	});

	it("loads the direct report's zone and choices for an authorized manager", async () => {
		mocks.getPrincipalContext.mockResolvedValue(
			principal({ role: "manager", managedEmployeeIds: ["staff-1"] }),
		);
		mocks.findEmployee.mockResolvedValue(staff);
		mocks.findUserSettings.mockResolvedValue(undefined);

		const result = await getManualEntryTargetContextForEmployee({
			currentEmployee: employeeRecord(),
			requestedEmployeeId: "staff-1",
		});

		expect(result.success && result.data).toMatchObject({
			targetEmployeeId: "staff-1",
			isOwnEntry: false,
			timezone: "America/New_York",
			timezoneSource: "organization",
		});
		// Choices belong to the target, not the actor.
		expect(mocks.getAssignedProjectsWithHours).toHaveBeenCalledWith(
			"staff-1",
			"org-1",
			"team-2",
		);
		expect(mocks.getAvailableCategoriesForEmployee).toHaveBeenCalledWith(
			"staff-1",
			"org-1",
		);
	});

	it.each([
		{
			name: "a manager without a direct-report link",
			principal: principal({ role: "manager" }),
		},
		{
			name: "an employee with read-only custom grants",
			principal: principal({
				role: "employee",
				customRoles: [
					{
						roleId: "role-1",
						roleName: "Viewer",
						baseTier: "employee",
						permissions: [
							{ action: "read", subject: "Employee" },
							{ action: "read", subject: "TimeEntry" },
						],
					},
				],
			}),
		},
	])("refuses context to $name without loading choices", async (testCase) => {
		mocks.getPrincipalContext.mockResolvedValue(testCase.principal);
		mocks.findEmployee.mockResolvedValue(staff);

		const result = await getManualEntryTargetContextForEmployee({
			currentEmployee: employeeRecord({
				role: testCase.principal.employee.role,
			}),
			requestedEmployeeId: "staff-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Not authorized to create time entries for this employee",
		});
		expect(mocks.getAssignedProjectsWithHours).not.toHaveBeenCalled();
		expect(mocks.getAvailableCategoriesForEmployee).not.toHaveBeenCalled();
		expect(mocks.findUserSettings).not.toHaveBeenCalled();
	});

	it("lets an organization admin with an ordinary employee role load any active colleague", async () => {
		mocks.getPrincipalContext.mockResolvedValue(
			principal({ role: "employee", orgRole: "admin" }),
		);
		mocks.findEmployee.mockResolvedValue(staff);

		const result = await getManualEntryTargetContextForEmployee({
			currentEmployee: employeeRecord({ role: "employee" }),
			requestedEmployeeId: "staff-1",
		});

		expect(result.success).toBe(true);
	});
});

describe("resolveManualEntryTargetZone", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the organization zone when the employee's saved zone is invalid", async () => {
		mocks.findUserSettings.mockResolvedValue({ timezone: "Not/AZone" });
		mocks.findOrganization.mockResolvedValue({ timezone: "Asia/Tokyo" });

		await expect(
			resolveManualEntryTargetZone({
				userId: "staff-user",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ timezone: "Asia/Tokyo", source: "organization" });
	});

	it("falls back to UTC when neither the employee nor the organization zone is valid", async () => {
		mocks.findUserSettings.mockResolvedValue({ timezone: "Not/AZone" });
		mocks.findOrganization.mockResolvedValue({ timezone: null });

		await expect(
			resolveManualEntryTargetZone({
				userId: "staff-user",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ timezone: "UTC", source: "default" });
	});
});
