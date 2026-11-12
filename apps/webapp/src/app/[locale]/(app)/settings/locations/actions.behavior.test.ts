import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const NORTH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOUTH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FRONT_DESK = "11111111-1111-4111-8111-111111111111";
const STORAGE = "22222222-2222-4222-8222-222222222222";
const PRIVATE_OFFICE = "33333333-3333-4333-8333-333333333333";
const REMOTE = "44444444-4444-4444-8444-444444444444";

function subarea(id: string, locationId: string, name: string) {
	return {
		id,
		locationId,
		name,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		employees: [],
	};
}

function locationRow(id: string, name: string, subareas: ReturnType<typeof subarea>[]) {
	return {
		id,
		organizationId: "org-1",
		name,
		street: null,
		city: "Berlin",
		postalCode: null,
		country: "DE",
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		createdBy: "user-1",
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedBy: null,
		subareas,
		employees: [],
	};
}

const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	locations: [] as Array<Record<string, any>>,
	teamPermissions: [] as Array<{ teamId: string | null; canManageTeamSettings: boolean }>,
	ownSubareas: [] as Array<{ subareaId: string }>,
	teamEmployees: [] as Array<{
		subareaAssignments: Array<{ subareaId: string }>;
		locationAssignments: Array<{ locationId: string }>;
	}>,
	foundLocation: null as Record<string, any> | null,
	foundSubarea: null as Record<string, any> | null,
	inserted: [] as unknown[],
	updated: [] as unknown[],
	deleted: 0,
}));

const db = vi.hoisted(() => ({
	query: {
		location: {
			findMany: vi.fn(async () => state.locations),
			findFirst: vi.fn(async () => state.foundLocation),
		},
		locationSubarea: { findFirst: vi.fn(async () => state.foundSubarea) },
		teamPermissions: { findMany: vi.fn(async () => state.teamPermissions) },
		subareaEmployee: { findMany: vi.fn(async () => state.ownSubareas) },
		employee: { findMany: vi.fn(async () => state.teamEmployees) },
	},
	insert: vi.fn(() => ({
		values: (value: unknown) => ({
			returning: async () => {
				state.inserted.push(value);
				return [{ id: "created-1" }];
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

vi.mock("@/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		LOCATION_CREATED: "LOCATION_CREATED",
		LOCATION_UPDATED: "LOCATION_UPDATED",
		LOCATION_DELETED: "LOCATION_DELETED",
	},
	logAudit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => state.caller, { db }));
});

const {
	createLocation,
	createSubarea,
	deleteLocation,
	deleteSubarea,
	getAvailableEmployees,
	getLocation,
	getLocations,
	updateLocation,
	updateSubarea,
} = await import("./actions");

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
const member: StubCaller = {
	...scopedManager,
	employee: { id: "employee-1", role: "employee", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.caller = scopedManager;
	state.locations = [
		locationRow(NORTH, "North Hub", [
			subarea(FRONT_DESK, NORTH, "Front Desk"),
			subarea(STORAGE, NORTH, "Storage"),
			subarea(PRIVATE_OFFICE, NORTH, "Private Office"),
		]),
		locationRow(SOUTH, "South Hub", [subarea(REMOTE, SOUTH, "Remote")]),
	];
	state.teamPermissions = [{ teamId: "team-1", canManageTeamSettings: true }];
	state.ownSubareas = [{ subareaId: STORAGE }];
	state.teamEmployees = [
		{ subareaAssignments: [{ subareaId: FRONT_DESK }], locationAssignments: [] },
	];
	state.foundLocation = null;
	state.foundSubarea = null;
	state.inserted = [];
	state.updated = [];
	state.deleted = 0;
});

describe("location reads", () => {
	it("lets a scoped manager list only locations tied to their teams or own subareas", async () => {
		const result = await getLocations();

		expect(result).toEqual({
			success: true,
			data: [
				{
					id: NORTH,
					name: "North Hub",
					city: "Berlin",
					country: "DE",
					isActive: true,
					subareaCount: 2,
					employeeCount: 0,
				},
			],
		});
	});

	it("includes a location tied only through a managed team's location assignment", async () => {
		state.ownSubareas = [];
		state.teamEmployees = [
			{ subareaAssignments: [], locationAssignments: [{ locationId: NORTH }] },
		];

		const result = await getLocations();

		expect(result.success && result.data).toEqual([
			expect.objectContaining({ id: NORTH, subareaCount: 3 }),
		]);
	});

	it("lists every location for an owner without a manager employee role", async () => {
		state.caller = owner;

		const result = await getLocations();

		expect(result.success && result.data.map((row) => row.id)).toEqual([NORTH, SOUTH]);
		expect(db.query.teamPermissions.findMany).not.toHaveBeenCalled();
	});

	it("lists every location for a workforce admin, whose scope is the whole organization", async () => {
		state.caller = {
			...scopedManager,
			employee: { id: "employee-1", role: "admin", former: false },
		};

		const result = await getLocations();

		expect(result.success && result.data.map((row) => row.id)).toEqual([NORTH, SOUTH]);
		expect(db.query.teamPermissions.findMany).not.toHaveBeenCalled();
	});

	it("refuses an org member, one level below a scoped manager", async () => {
		state.caller = member;

		expect(await getLocations()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(await getLocation(NORTH)).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(db.query.location.findMany).not.toHaveBeenCalled();
		expect(db.query.location.findFirst).not.toHaveBeenCalled();
	});

	it("narrows a location's detail to the scoped manager's subareas", async () => {
		state.foundLocation = state.locations[0];

		const result = await getLocation(NORTH);

		expect(result.success && result.data.subareas.map((row) => row.id)).toEqual([
			FRONT_DESK,
			STORAGE,
		]);
	});

	it("refuses a scoped manager a location outside their scope", async () => {
		state.foundLocation = state.locations[1];

		expect(await getLocation(SOUTH)).toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "Only org admins can manage locations",
		});
	});

	it("reads a location outside the session's organization as not found", async () => {
		state.caller = owner;
		state.foundLocation = null;

		expect(await getLocation(NORTH)).toMatchObject({ success: false, code: "NotFoundError" });
	});

	it("refuses a scoped manager the available-employee list, one level below an org admin", async () => {
		expect(await getAvailableEmployees({ excludeLocationId: NORTH })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});
});

describe("location and subarea writes", () => {
	it("refuses a scoped manager every write, one level below an org admin", async () => {
		const results = [
			await createLocation({ name: "Scoped Location" }),
			await updateLocation({ locationId: NORTH, data: { name: "Scoped Rename" } }),
			await deleteLocation(NORTH),
			await createSubarea({ locationId: NORTH, name: "Scoped Subarea" }),
			await updateSubarea({ subareaId: FRONT_DESK, data: { name: "Scoped Subarea" } }),
			await deleteSubarea(FRONT_DESK),
		];

		for (const result of results) {
			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		}
		expect(state.inserted).toEqual([]);
		expect(state.updated).toEqual([]);
		expect(state.deleted).toBe(0);
	});

	it("creates a location in the session's organization", async () => {
		state.caller = owner;

		expect(await createLocation({ name: "New Hub", city: "Hamburg" })).toEqual({
			success: true,
			data: { id: "created-1" },
		});
		expect(state.inserted).toEqual([
			expect.objectContaining({ organizationId: "org-1", name: "New Hub", createdBy: "user-1" }),
		]);
	});

	it("refuses an organizationId in the input", async () => {
		state.caller = owner;

		expect(
			await createLocation({ name: "New Hub", organizationId: "org-2" } as never),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(state.inserted).toEqual([]);
	});

	it("updates and deletes a location of the session's organization", async () => {
		state.caller = owner;
		state.foundLocation = state.locations[0];

		expect(await updateLocation({ locationId: NORTH, data: { city: "Bremen" } })).toEqual({
			success: true,
			data: undefined,
		});
		expect(await deleteLocation(NORTH)).toEqual({ success: true, data: undefined });
		expect(state.updated).toEqual([
			expect.objectContaining({ city: "Bremen", updatedBy: "user-1" }),
		]);
		expect(state.deleted).toBe(1);
	});

	it("treats another organization's location or subarea as not found", async () => {
		state.caller = owner;
		state.foundSubarea = {
			id: FRONT_DESK,
			locationId: NORTH,
			location: { organizationId: "org-2" },
		};

		expect(await deleteLocation(NORTH)).toMatchObject({ success: false, code: "NotFoundError" });
		expect(await createSubarea({ locationId: NORTH, name: "Desk" })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(await deleteSubarea(FRONT_DESK)).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(state.inserted).toEqual([]);
		expect(state.deleted).toBe(0);
	});
});
