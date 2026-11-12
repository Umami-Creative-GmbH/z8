import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const LOCATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUBAREA_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	formerEmployeeIds: new Set<string>(),
	location: null as Record<string, unknown> | null,
	subarea: null as Record<string, unknown> | null,
	targetEmployee: null as Record<string, unknown> | null,
	locationAssignment: null as Record<string, unknown> | null,
	subareaAssignment: null as Record<string, unknown> | null,
	inserted: [] as unknown[],
	updated: [] as unknown[],
	deleted: 0,
}));

const db = vi.hoisted(() => ({
	query: {
		location: { findFirst: vi.fn(async () => state.location) },
		locationSubarea: { findFirst: vi.fn(async () => state.subarea) },
		employee: { findFirst: vi.fn(async () => state.targetEmployee) },
		locationEmployee: {
			// The duplicate check has no `with`; the assignment lookup loads the location.
			findFirst: vi.fn(async (args: { with?: unknown }) =>
				args.with ? state.locationAssignment : null,
			),
		},
		subareaEmployee: {
			findFirst: vi.fn(async (args: { with?: unknown }) =>
				args.with ? state.subareaAssignment : null,
			),
		},
	},
	insert: vi.fn(() => ({
		values: (value: unknown) => ({
			returning: async () => {
				state.inserted.push(value);
				return [{ id: "assignment-1" }];
			},
		}),
	})),
	update: vi.fn(() => ({
		set: (value: unknown) => ({
			where: async () => {
				state.updated.push(value);
			},
		}),
	})),
	delete: vi.fn(() => ({
		where: async () => {
			state.deleted += 1;
		},
	})),
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => state.formerEmployeeIds),
);
vi.mock("@/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => state.caller, { db }));
});

const {
	assignLocationEmployee,
	assignSubareaEmployee,
	removeLocationEmployee,
	removeSubareaEmployee,
	updateLocationEmployee,
	updateSubareaEmployee,
} = await import("./assignment-actions");

const owner: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: { id: "employee-1", role: "employee", former: false },
};
const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

function inOrganization(organizationId: string) {
	state.location = { id: LOCATION_ID, organizationId, name: "North Hub" };
	state.subarea = { id: SUBAREA_ID, locationId: LOCATION_ID, location: { organizationId } };
	state.locationAssignment = {
		id: ASSIGNMENT_ID,
		locationId: LOCATION_ID,
		location: { organizationId },
	};
	state.subareaAssignment = {
		id: ASSIGNMENT_ID,
		subareaId: SUBAREA_ID,
		subarea: { locationId: LOCATION_ID, location: { organizationId } },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.caller = owner;
	state.formerEmployeeIds = new Set();
	inOrganization("org-1");
	state.targetEmployee = { id: EMPLOYEE_ID, organizationId: "org-1" };
	state.inserted = [];
	state.updated = [];
	state.deleted = 0;
});

const assignLocation = () =>
	assignLocationEmployee({ locationId: LOCATION_ID, employeeId: EMPLOYEE_ID, isPrimary: false });
const assignSubarea = () =>
	assignSubareaEmployee({ subareaId: SUBAREA_ID, employeeId: EMPLOYEE_ID, isPrimary: false });

describe("location and subarea assignments", () => {
	it("refuses a scoped manager every assignment change, one level below an org admin", async () => {
		state.caller = scopedManager;

		const results = [
			await assignLocation(),
			await updateLocationEmployee({ assignmentId: ASSIGNMENT_ID, isPrimary: true }),
			await removeLocationEmployee(ASSIGNMENT_ID),
			await assignSubarea(),
			await updateSubareaEmployee({ assignmentId: ASSIGNMENT_ID, isPrimary: true }),
			await removeSubareaEmployee(ASSIGNMENT_ID),
		];

		for (const result of results) {
			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		}
		expect(state.inserted).toEqual([]);
		expect(state.updated).toEqual([]);
		expect(state.deleted).toBe(0);
	});

	it("lets an owner without an admin employee role change every assignment", async () => {
		expect(await assignLocation()).toEqual({ success: true, data: { id: "assignment-1" } });
		expect(await updateLocationEmployee({ assignmentId: ASSIGNMENT_ID, isPrimary: true })).toEqual({
			success: true,
			data: undefined,
		});
		expect(await removeLocationEmployee(ASSIGNMENT_ID)).toEqual({
			success: true,
			data: undefined,
		});
		expect(await assignSubarea()).toEqual({ success: true, data: { id: "assignment-1" } });
		expect(await updateSubareaEmployee({ assignmentId: ASSIGNMENT_ID, isPrimary: true })).toEqual({
			success: true,
			data: undefined,
		});
		expect(await removeSubareaEmployee(ASSIGNMENT_ID)).toEqual({ success: true, data: undefined });
		expect(state.inserted).toEqual([
			expect.objectContaining({
				locationId: LOCATION_ID,
				employeeId: EMPLOYEE_ID,
				createdBy: "user-1",
			}),
			expect.objectContaining({
				subareaId: SUBAREA_ID,
				employeeId: EMPLOYEE_ID,
				createdBy: "user-1",
			}),
		]);
		expect(state.updated).toHaveLength(2);
		expect(state.deleted).toBe(2);
	});

	it("refuses assigning a former employee to a location or subarea (#1438)", async () => {
		state.formerEmployeeIds = new Set([EMPLOYEE_ID]);

		expect(await assignLocation()).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "former_employee",
		});
		expect(await assignSubarea()).toMatchObject({ success: false, refusal: "former_employee" });
		expect(state.inserted).toEqual([]);
	});

	it("treats another organization's location, subarea or assignment as not found", async () => {
		inOrganization("org-2");
		state.location = null;

		const results = [
			await assignLocation(),
			await updateLocationEmployee({ assignmentId: ASSIGNMENT_ID, isPrimary: true }),
			await removeLocationEmployee(ASSIGNMENT_ID),
			await assignSubarea(),
			await updateSubareaEmployee({ assignmentId: ASSIGNMENT_ID, isPrimary: true }),
			await removeSubareaEmployee(ASSIGNMENT_ID),
		];

		for (const result of results) {
			expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		}
		expect(state.inserted).toEqual([]);
		expect(state.updated).toEqual([]);
		expect(state.deleted).toBe(0);
	});
});
