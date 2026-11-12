import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: new Set<string>(),
	settingsTeamIds: [] as string[],
	guardCalls: [] as unknown[],
	insertedPolicies: [] as unknown[],
	updates: [] as unknown[],
}));

const teamRows = [
	{ id: "team-managed", name: "Managed Team" },
	{ id: "team-other", name: "Other Team" },
];

const employeeRows = [
	{ id: "employee-managed", teamId: "team-managed", user: { firstName: "Mina", lastName: "Miller" } },
	{ id: "employee-fallback", teamId: null, user: { firstName: "Fall", lastName: "Back" } },
	{ id: "employee-other", teamId: "team-other", user: { firstName: "Otto", lastName: "Other" } },
];

const policyRows = [
	{ id: "policy-org", name: "Org Default", createdAt: new Date("2026-01-01T00:00:00.000Z") },
	{ id: "policy-team", name: "Managed Team Policy", createdAt: new Date("2026-01-02T00:00:00.000Z") },
	{ id: "policy-other", name: "Other Team Policy", createdAt: new Date("2026-01-03T00:00:00.000Z") },
];

function assignment(
	id: string,
	policyId: string,
	assignmentType: "organization" | "team" | "employee",
	target: { teamId?: string; employeeId?: string },
	priority: number,
	day: number,
) {
	return {
		id,
		policyId,
		organizationId: "org-1",
		assignmentType,
		teamId: target.teamId ?? null,
		employeeId: target.employeeId ?? null,
		priority,
		isActive: true,
		createdAt: new Date(`2026-01-0${day}T00:00:00.000Z`),
		policy: { id: policyId },
		team: target.teamId ? { id: target.teamId, name: target.teamId } : null,
		employee: target.employeeId
			? { id: target.employeeId, user: { firstName: "Mina", lastName: "Miller" } }
			: null,
	};
}

const assignmentRows = [
	assignment("assignment-org", "policy-org", "organization", {}, 0, 1),
	assignment("assignment-team-managed", "policy-team", "team", { teamId: "team-managed" }, 1, 2),
	assignment(
		"assignment-employee-managed",
		"policy-team",
		"employee",
		{ employeeId: "employee-managed" },
		2,
		3,
	),
	assignment("assignment-team-other", "policy-other", "team", { teamId: "team-other" }, 1, 4),
];

function chain(result: unknown) {
	const builder: Record<string, unknown> = {};
	for (const method of ["from", "where", "innerJoin"]) builder[method] = () => builder;
	builder.limit = async () => result;
	// biome-ignore lint/suspicious/noThenProperty: a thenable query builder stand-in
	builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
	return builder;
}

const db = {
	query: {
		changePolicy: {
			findMany: vi.fn(async () => policyRows),
			findFirst: vi.fn(async () => policyRows[0]),
		},
		changePolicyAssignment: { findMany: vi.fn(async () => assignmentRows) },
		team: { findMany: vi.fn(async () => teamRows) },
		employee: {
			findMany: vi.fn(async () => employeeRows.filter((row) => state.managedEmployeeIds.has(row.id))),
		},
		teamPermissions: {
			findMany: vi.fn(async () =>
				state.settingsTeamIds.map((teamId) => ({ teamId, canManageTeamSettings: true })),
			),
		},
	},
	execute: vi.fn(async (statement: unknown) => {
		state.guardCalls.push(statement);
		return [];
	}),
	transaction(callback: (tx: unknown) => unknown) {
		return callback(db);
	},
	select: vi.fn(() => chain([{ id: "row-1" }])),
	insert: vi.fn(() => ({
		values: vi.fn((value: unknown) => ({
			returning: vi.fn(async () => {
				state.insertedPolicies.push(value);
				return [{ id: "created-policy" }];
			}),
		})),
	})),
	update: vi.fn(() => ({
		set: vi.fn((value: unknown) => ({
			where: vi.fn(async () => {
				state.updates.push(value);
			}),
		})),
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
					? (Effect.succeed([
							[...state.managedEmployeeIds].map((id) => ({ id })),
							[],
						]) as never)
					: Effect.promise(fn),
		}),
	);
});

vi.mock("@/lib/employee-lifecycle/current-roster-among", () => ({
	currentRosterAmong: vi.fn(
		async (_client: unknown, _organizationId: string, ids: string[]) =>
			new Set(ids.filter((id) => id !== "employee-former")),
	),
}));

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

const validPolicy = { name: "Allowed", selfServiceDays: 1, approvalDays: 3 };

beforeEach(() => {
	state.caller = scopedManager;
	state.managedEmployeeIds = new Set(["employee-managed"]);
	state.settingsTeamIds = ["team-managed"];
	state.guardCalls = [];
	state.insertedPolicies = [];
	state.updates = [];
});

function ids(result: { success: boolean; data?: unknown }) {
	expect(result.success).toBe(true);
	return (result.data as { id: string }[]).map((row) => row.id);
}

describe("change policy scoped access", () => {
	it("returns only policies assigned to a manager's teams or managed employees", async () => {
		expect(ids(await actions.getChangePolicies())).toEqual(["policy-team"]);
	});

	it("returns only assignments within a manager's scoped visibility", async () => {
		expect(ids(await actions.getChangePolicyAssignments())).toEqual([
			"assignment-employee-managed",
			"assignment-team-managed",
		]);
	});

	it("includes the organization default when it is the effective fallback for managed scope", async () => {
		state.managedEmployeeIds = new Set(["employee-fallback"]);
		state.settingsTeamIds = [];

		expect(ids(await actions.getChangePolicies())).toEqual(["policy-org"]);
		expect(ids(await actions.getChangePolicyAssignments())).toEqual(["assignment-org"]);
	});

	it("includes an unmanaged team's policy when it effectively governs a directly managed employee", async () => {
		state.managedEmployeeIds = new Set(["employee-other"]);
		state.settingsTeamIds = [];

		expect(ids(await actions.getChangePolicies())).toEqual(["policy-other"]);
		expect(ids(await actions.getChangePolicyAssignments())).toEqual(["assignment-team-other"]);
	});

	it("hides a policy outside a manager's scope", async () => {
		await expect(actions.getChangePolicy("policy-other")).resolves.toEqual({
			success: true,
			data: null,
		});
	});

	it("shows an org admin every policy", async () => {
		state.caller = orgAdmin;

		expect(ids(await actions.getChangePolicies())).toEqual(["policy-org", "policy-team", "policy-other"]);
	});
});

describe("change policy settings access", () => {
	it.each([
		["getChangePolicies", () => actions.getChangePolicies()],
		["getChangePolicy", () => actions.getChangePolicy("policy-org")],
		["getChangePolicyAssignments", () => actions.getChangePolicyAssignments()],
	])("refuses %s to an org member", async (_name, call) => {
		state.caller = orgMember;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it.each([
		["createChangePolicy", () => actions.createChangePolicy(validPolicy)],
		["updateChangePolicy", () => actions.updateChangePolicy({ policyId: "policy-org", data: validPolicy })],
		["deleteChangePolicy", () => actions.deleteChangePolicy("policy-org")],
		[
			"createChangePolicyAssignment",
			() =>
				actions.createChangePolicyAssignment({ policyId: "policy-org", assignmentType: "organization" }),
		],
		["deleteChangePolicyAssignment", () => actions.deleteChangePolicyAssignment("assignment-org")],
		["getTeamsForAssignment", () => actions.getTeamsForAssignment()],
		["getEmployeesForAssignment", () => actions.getEmployeesForAssignment()],
	])("refuses %s to a scoped manager", async (_name, call) => {
		const result = await call();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.insertedPolicies).toHaveLength(0);
		expect(state.updates).toHaveLength(0);
	});

	it.each([
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		[
			"a former employee",
			{ ...orgAdmin, employee: { id: "admin-employee", role: "admin" as const, former: true } },
		],
	])("refuses policy creation to %s", async (_case, caller) => {
		state.caller = caller;

		await expect(actions.createChangePolicy(validPolicy)).resolves.toMatchObject({ success: false });
		expect(state.insertedPolicies).toHaveLength(0);
	});

	it("lets an org admin create a policy under the configuration guard", async () => {
		state.caller = orgAdmin;

		await expect(actions.createChangePolicy(validPolicy)).resolves.toEqual({
			success: true,
			data: { id: "created-policy" },
		});
		expect(state.insertedPolicies).toEqual([
			expect.objectContaining({ organizationId: "org-1", name: "Allowed", createdBy: "user-1" }),
		]);
		expect(state.guardCalls).toHaveLength(1);
	});

	it("validates a policy after authorization", async () => {
		state.caller = orgAdmin;

		await expect(
			actions.createChangePolicy({ ...validPolicy, approvalDays: -1 }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(state.insertedPolicies).toHaveLength(0);
	});

	it("refuses to assign a policy to a former employee", async () => {
		state.caller = orgAdmin;

		await expect(
			actions.createChangePolicyAssignment({
				policyId: "policy-org",
				assignmentType: "employee",
				employeeId: "employee-former",
			}),
		).resolves.toMatchObject({ success: false, refusal: "former_employee" });
		expect(state.insertedPolicies).toHaveLength(0);
	});
});
