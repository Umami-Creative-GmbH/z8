import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

type AssignmentRow = {
	id: string;
	setId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	set: { id: string; name: string; description: string | null };
	team: { id: string; name: string } | null;
	employee: { id: string; user: { firstName: string; lastName: string } } | null;
};

const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: new Set<string>(),
	teamPermissionsRows: [] as Array<{ teamId: string; canManageTeamSettings: boolean }>,
	assignmentRows: [] as AssignmentRow[],
	selectQueue: [] as unknown[][],
	insertValues: [] as unknown[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function selectResult() {
	const execute = async () => state.selectQueue.shift() ?? [];
	return {
		orderBy: vi.fn(async () => execute()),
		limit: vi.fn(async () => execute()),
		// biome-ignore lint/suspicious/noThenProperty: a thenable query builder stand-in
		then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
			execute().then(resolve, reject),
	};
}

const db = {
	query: {
		employee: { findMany: vi.fn(async () => [{ id: "employee-team-member" }]) },
		locationEmployee: {
			findMany: vi.fn(async () => [
				{ locationId: "location-managed", employeeId: "employee-manager-1" },
				{ locationId: "location-managed", employeeId: "employee-area-member" },
			]),
		},
		subareaEmployee: {
			findMany: vi.fn(async () => [
				{ subareaId: "subarea-managed", employeeId: "employee-manager-1" },
				{ subareaId: "subarea-managed", employeeId: "employee-area-member" },
			]),
		},
		teamPermissions: { findMany: vi.fn(async () => state.teamPermissionsRows) },
		projectManager: { findMany: vi.fn(async () => [{ projectId: "project-managed" }]) },
		workCategorySetAssignment: { findMany: vi.fn(async () => state.assignmentRows) },
	},
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			innerJoin: vi.fn(() => ({ where: vi.fn(selectResult) })),
			where: vi.fn(selectResult),
		})),
	})),
	insert: vi.fn(() => ({
		values: vi.fn((values: unknown) => {
			state.insertValues.push(values);
			return { returning: vi.fn(async () => [{ id: "category-created" }]) };
		}),
	})),
	update: vi.fn(() => ({
		set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "row" }]) })) })),
	})),
};

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => state.caller, {
			db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[...state.managedEmployeeIds].map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const actions = await import("./actions");

const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...scopedManager,
	employee: { id: "employee-manager-1", role: "employee", former: false },
};
const owner: StubCaller = {
	...scopedManager,
	userId: "user-owner-1",
	membershipRole: "owner",
	employee: null,
};

function assignment(
	id: string,
	setId: string,
	assignmentType: AssignmentRow["assignmentType"],
	target: { teamId?: string; employeeId?: string } = {},
): AssignmentRow {
	return {
		id,
		setId,
		assignmentType,
		teamId: target.teamId ?? null,
		employeeId: target.employeeId ?? null,
		set: { id: setId, name: setId, description: null },
		team: target.teamId ? { id: target.teamId, name: target.teamId } : null,
		employee: target.employeeId
			? { id: target.employeeId, user: { firstName: "Una", lastName: "Scoped" } }
			: null,
	};
}

function category(id: string) {
	return {
		id,
		organizationId: "org-1",
		name: id,
		description: null,
		factor: "1.00",
		color: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.caller = scopedManager;
	state.managedEmployeeIds = new Set(["employee-managed"]);
	state.teamPermissionsRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
	state.assignmentRows = [
		assignment("assignment-org", "set-org", "organization"),
		assignment("assignment-team-managed", "set-team-managed", "team", { teamId: "team-managed" }),
		assignment("assignment-team-other", "set-team-other", "team", { teamId: "team-other" }),
	];
	state.selectQueue = [];
	state.insertValues = [];
});

describe("work category settings manager scope", () => {
	it("shows managers only category definitions used by scoped teams own areas or managed projects", async () => {
		state.selectQueue = [
			["category-area", "category-team", "category-project", "category-other"].map(category),
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 0 }],
			[{ count: 1 }],
			[{ workCategoryId: "category-team" }, { workCategoryId: "category-area" }],
			[{ workCategoryId: "category-project" }],
		];

		const result = await actions.getOrganizationCategories();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.map((row) => row.id).sort()).toEqual([
			"category-area",
			"category-project",
			"category-team",
		]);
	});

	it("hides organization default assignments when scoped teams areas and projects do not use them", async () => {
		state.assignmentRows = state.assignmentRows.slice(0, 2);
		state.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
		];

		const result = await actions.getWorkCategorySetAssignments();

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "assignment-team-managed" })],
		});
	});

	it("filters out unrelated assignments even when they share a visible set", async () => {
		state.assignmentRows = [
			assignment("assignment-team-managed", "set-team-managed", "team", { teamId: "team-managed" }),
			assignment("assignment-team-other", "set-team-managed", "team", { teamId: "team-other" }),
			assignment("assignment-employee-other", "set-team-managed", "employee", {
				employeeId: "employee-unmanaged",
			}),
		];
		state.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
		];

		const result = await actions.getWorkCategorySetAssignments();

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "assignment-team-managed" })],
		});
	});

	it("shows managers only sets backed by scoped category usage instead of assignment visibility", async () => {
		state.assignmentRows = [assignment("assignment-org", "set-org", "organization")];
		state.selectQueue = [
			[
				{
					id: "set-org",
					name: "Org Default",
					description: null,
					isActive: true,
					createdAt: new Date(),
				},
				{
					id: "set-team-managed",
					name: "Managed Team Set",
					description: null,
					isActive: true,
					createdAt: new Date(),
				},
			],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 0 }],
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
		];

		const result = await actions.getWorkCategorySets();

		expect(result).toEqual({
			success: true,
			data: [expect.objectContaining({ id: "set-team-managed" })],
		});
	});

	it("rejects manager detail reads for arbitrary sets while allowing scoped sets", async () => {
		state.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[
				{
					id: "set-other",
					organizationId: "org-1",
					isActive: true,
					name: "Other Set",
					description: null,
				},
			],
			[],
		];

		await expect(actions.getWorkCategorySetDetail("set-other")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		state.selectQueue = [
			[{ workCategoryId: "category-team" }],
			[{ workCategoryId: "category-project" }],
			[
				{
					id: "set-team-managed",
					organizationId: "org-1",
					isActive: true,
					name: "Managed Team Set",
					description: null,
				},
			],
			[{ categoryId: "category-team", setId: "set-team-managed" }],
			[
				{ ...category("category-team"), sortOrder: 0 },
				{ ...category("category-other"), sortOrder: 1 },
			],
		];

		const allowed = await actions.getWorkCategorySetDetail("set-team-managed");

		expect(allowed).toEqual({
			success: true,
			data: {
				set: expect.objectContaining({ id: "set-team-managed" }),
				categories: [expect.objectContaining({ id: "category-team" })],
			},
		});
	});

	it("reads another organization's set as not found", async () => {
		state.caller = owner;
		state.selectQueue = [[]];

		await expect(actions.getWorkCategorySetDetail("set-elsewhere")).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("keeps owner parity with org admins for category reads", async () => {
		state.caller = owner;
		state.selectQueue = [
			[category("category-org"), category("category-other")],
			[{ count: 1 }],
			[{ count: 0 }],
		];

		const result = await actions.getOrganizationCategories();

		expect(result).toEqual({
			success: true,
			data: [
				expect.objectContaining({ id: "category-org" }),
				expect.objectContaining({ id: "category-other" }),
			],
		});
	});

	it("lets an owner create a category in the active organization", async () => {
		state.caller = owner;
		state.selectQueue = [[]];

		const result = await actions.createOrganizationCategory({
			name: "Owner Category",
			factor: "1.00",
		});

		expect(result).toEqual({ success: true, data: { id: "category-created" } });
		expect(state.insertValues).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				name: "Owner Category",
				createdBy: "user-owner-1",
			}),
		]);
	});

	it("validates the factor after authorization", async () => {
		state.caller = owner;

		await expect(
			actions.createOrganizationCategory({ name: "Too much", factor: "3" }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(state.insertValues).toEqual([]);
	});
});

describe("work category settings access", () => {
	it.each([
		["getOrganizationCategories", () => actions.getOrganizationCategories()],
		["getWorkCategorySets", () => actions.getWorkCategorySets()],
		["getWorkCategorySetDetail", () => actions.getWorkCategorySetDetail("set-org")],
		["getWorkCategorySetAssignments", () => actions.getWorkCategorySetAssignments()],
		["getTeamsForAssignment", () => actions.getTeamsForAssignment()],
		["getEmployeesForAssignment", () => actions.getEmployeesForAssignment()],
	])("refuses %s to an org member", async (_name, call) => {
		state.caller = orgMember;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it.each([
		[
			"createOrganizationCategory",
			() => actions.createOrganizationCategory({ name: "Manager Category", factor: "1.00" }),
		],
		[
			"updateOrganizationCategory",
			() => actions.updateOrganizationCategory({ categoryId: "category-1", name: "Renamed" }),
		],
		["deleteOrganizationCategory", () => actions.deleteOrganizationCategory("category-1")],
		["createWorkCategorySet", () => actions.createWorkCategorySet({ name: "Set" })],
		["updateWorkCategorySet", () => actions.updateWorkCategorySet({ setId: "set-1", name: "Set" })],
		["deleteWorkCategorySet", () => actions.deleteWorkCategorySet("set-1")],
		[
			"updateSetCategories",
			() => actions.updateSetCategories({ setId: "set-1", categoryIds: ["category-1"] }),
		],
		[
			"reorderSetCategories",
			() => actions.reorderSetCategories({ setId: "set-1", categoryIds: ["category-1"] }),
		],
		[
			"createSetAssignment",
			() => actions.createSetAssignment({ setId: "set-1", assignmentType: "organization" }),
		],
		["deleteSetAssignment", () => actions.deleteSetAssignment("assignment-1")],
	])("refuses %s to a scoped manager", async (_name, call) => {
		const result = await call();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.insertValues).toEqual([]);
		expect(db.update).not.toHaveBeenCalled();
	});

	it.each([
		["a pending membership", { ...scopedManager, membershipRole: null }],
		[
			"a former employee",
			{ ...scopedManager, employee: { id: "employee-1", role: "employee" as const, former: true } },
		],
		["a signed-out caller", null],
	])("refuses the clock-out categories to %s", async (_case, caller) => {
		state.caller = caller;

		await expect(actions.getAvailableCategoriesForEmployee("employee-1")).resolves.toMatchObject({
			success: false,
		});
	});

	it("gives an org member no categories for an employee outside the active organization", async () => {
		state.caller = orgMember;
		state.selectQueue = [[]];

		await expect(actions.getAvailableCategoriesForEmployee("employee-elsewhere")).resolves.toEqual({
			success: true,
			data: [],
		});
	});
});
