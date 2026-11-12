import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";
import type { holidayTestDatabase } from "./holiday-database.test.mock";

function assignment(
	id: string,
	assignmentType: "organization" | "team" | "employee",
	target: { teamId?: string; employeeId?: string } = {},
) {
	return {
		id,
		holidayId: `holiday-${id}`,
		categoryId: `category-${id}`,
		organizationId: "org-1",
		assignmentType,
		teamId: target.teamId ?? null,
		employeeId: target.employeeId ?? null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		team: target.teamId ? { id: target.teamId, name: target.teamId } : null,
		employee: target.employeeId
			? { id: target.employeeId, user: { firstName: "Mina", lastName: "Miller" } }
			: null,
	};
}

const harness = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: new Set<string>(),
	settingsTeamIds: [] as string[],
	assignments: [] as unknown[],
	formerEmployeeIds: new Set<string>(),
	database: null as unknown as ReturnType<typeof holidayTestDatabase>,
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => harness.formerEmployeeIds),
);

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { holidayTestDatabase } = await import("./holiday-database.test.mock");
	harness.database = holidayTestDatabase({
		teamPermissions: {
			findMany: vi.fn(async () =>
				harness.settingsTeamIds.map((teamId) => ({ teamId, canManageTeamSettings: true })),
			),
		},
		holidayAssignment: { findMany: vi.fn(async () => harness.assignments) },
		holidayCategoryAssignment: { findMany: vi.fn(async () => harness.assignments) },
	});
	return runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, {
			db: harness.database.db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[...harness.managedEmployeeIds].map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const actions = await import("./actions");

const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-employee-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...scopedManager,
	employee: { id: "manager-employee-1", role: "employee", former: false },
};
const orgAdmin: StubCaller = { ...scopedManager, membershipRole: "admin", employee: null };

beforeEach(() => {
	harness.database.reset();
	harness.caller = scopedManager;
	harness.managedEmployeeIds = new Set(["employee-managed"]);
	harness.settingsTeamIds = ["team-managed"];
	harness.formerEmployeeIds = new Set();
	harness.assignments = [
		assignment("org", "organization"),
		assignment("team", "team", { teamId: "team-managed" }),
		assignment("employee", "employee", { employeeId: "employee-managed" }),
		assignment("other-team", "team", { teamId: "team-other" }),
	];
});

function ids(result: { success: boolean; data?: unknown }) {
	expect(result.success).toBe(true);
	return (result.data as { id: string }[]).map((row) => row.id);
}

describe("holiday settings scope behavior", () => {
	it("lets managers read only organization, managed-team, and managed-employee holiday assignments", async () => {
		expect(ids(await actions.getHolidayAssignments())).toEqual(["org", "team", "employee"]);
	});

	it("lets managers read only organization, managed-team, and managed-employee holiday category assignments", async () => {
		const result = await actions.getHolidayCategoryAssignments();

		expect(ids(result)).toEqual(["org", "team", "employee"]);
		if (result.success) {
			expect(result.data[2]?.employee).toMatchObject({
				id: "employee-managed",
				firstName: "Mina",
				lastName: "Miller",
			});
		}
	});

	it("shows an org admin every holiday assignment", async () => {
		harness.caller = orgAdmin;

		expect(ids(await actions.getHolidayAssignments())).toEqual([
			"org",
			"team",
			"employee",
			"other-team",
		]);
	});

	it("creates holiday category assignments in the active organization for org admins", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[{ id: "category-org" }], [{ id: "team-managed" }]];

		const result = await actions.createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: "employee-managed",
		});

		expect(result.success).toBe(true);
		expect(harness.database.state.inserts).toEqual([
			{
				categoryId: "category-org",
				organizationId: "org-1",
				assignmentType: "team",
				teamId: "team-managed",
				employeeId: null,
				createdBy: "user-1",
			},
		]);
	});

	it("rejects cross-org and inactive holiday category IDs before insert", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[]];

		const result = await actions.createHolidayCategoryAssignment({
			categoryId: "category-other-org",
			assignmentType: "organization",
		});

		expect(result).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Holiday category not found",
		});
		expect(harness.database.state.inserts).toEqual([]);
	});

	it("rejects cross-org team and employee IDs before insert", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[{ id: "category-org" }], []];

		const teamResult = await actions.createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "team",
			teamId: "team-other-org",
		});

		expect(teamResult).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Team not found",
		});

		harness.database.state.selects = [[{ id: "category-org" }], []];

		const employeeResult = await actions.createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "employee",
			employeeId: "employee-other-org",
		});

		expect(employeeResult).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Employee not found",
		});
		expect(harness.database.state.inserts).toEqual([]);
	});

	it("refuses to assign a holiday or a category to a former employee", async () => {
		harness.caller = orgAdmin;
		harness.formerEmployeeIds = new Set(["employee-former"]);

		const holidayResult = await actions.createHolidayAssignment({
			holidayId: "holiday-1",
			assignmentType: "employee",
			employeeId: "employee-former",
		});
		const categoryResult = await actions.createHolidayCategoryAssignment({
			categoryId: "category-1",
			assignmentType: "employee",
			employeeId: "employee-former",
		});

		expect(holidayResult).toMatchObject({ success: false, refusal: "former_employee" });
		expect(categoryResult).toMatchObject({ success: false, refusal: "former_employee" });
		expect(harness.database.state.inserts).toEqual([]);
	});

	it("soft deletes holiday category assignments only in the admin organization", async () => {
		harness.caller = orgAdmin;
		harness.database.state.updateReturn = [{ id: "category-assignment-org" }];

		const result = await actions.deleteHolidayCategoryAssignment("category-assignment-org");

		expect(result.success).toBe(true);
		expect(harness.database.state.updates).toEqual([{ isActive: false }]);

		harness.database.state.updateReturn = [];

		const missingResult = await actions.deleteHolidayCategoryAssignment(
			"category-assignment-other-org",
		);

		expect(missingResult).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Holiday category assignment not found",
		});
	});

	it("hard deletes holidays for org admins under the configuration guard", async () => {
		harness.caller = orgAdmin;
		harness.database.state.deleteReturn = [{ id: "holiday-org" }];

		const result = await actions.deleteHoliday("holiday-org");

		expect(result.success).toBe(true);
		expect(harness.database.state.guardCalls).toBe(1);
		expect(harness.database.state.deletes).toBe(1);
		expect(harness.database.state.updates).toEqual([]);
	});

	it("hard deletes multiple holidays for org admins", async () => {
		harness.caller = orgAdmin;
		harness.database.state.deleteReturn = [{ id: "holiday-org" }, { id: "holiday-team" }];

		const result = await actions.bulkDeleteHolidays(["holiday-org", "holiday-team"]);

		expect(result).toEqual({ success: true, data: { deleted: 2 } });
		expect(harness.database.state.guardCalls).toBe(1);
		expect(harness.database.state.deletes).toBe(1);
	});
});

describe("holiday settings access", () => {
	it.each([
		["getHolidays", () => actions.getHolidays({})],
		["getHolidayCategories", () => actions.getHolidayCategories()],
		["getHolidayAssignments", () => actions.getHolidayAssignments()],
		["getHolidayCategoryAssignments", () => actions.getHolidayCategoryAssignments()],
	])("refuses %s to an org member", async (_name, call) => {
		harness.caller = orgMember;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it.each([
		["deleteHoliday", () => actions.deleteHoliday("holiday-org")],
		["bulkDeleteHolidays", () => actions.bulkDeleteHolidays(["holiday-org"])],
		["deleteCategory", () => actions.deleteCategory("category-org")],
		[
			"createHolidayCategoryAssignment",
			() =>
				actions.createHolidayCategoryAssignment({
					categoryId: "category-org",
					assignmentType: "organization",
				}),
		],
		[
			"deleteHolidayCategoryAssignment",
			() => actions.deleteHolidayCategoryAssignment("category-assignment-org"),
		],
		[
			"createHolidayAssignment",
			() =>
				actions.createHolidayAssignment({
					holidayId: "holiday-org",
					assignmentType: "organization",
				}),
		],
		["deleteHolidayAssignment", () => actions.deleteHolidayAssignment("assignment-org")],
	])("refuses %s to a scoped manager", async (_name, call) => {
		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(harness.database.state.inserts).toEqual([]);
		expect(harness.database.state.updates).toEqual([]);
		expect(harness.database.state.deletes).toBe(0);
	});
});
