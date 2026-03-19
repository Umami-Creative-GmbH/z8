import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	session: {
		user: {
			id: "user-1",
			email: "manager@example.com",
		},
		session: {
			activeOrganizationId: "org-1",
		},
	},
	membershipRole: "member" as "owner" | "admin" | "member" | null,
	currentEmployee: {
		id: "employee-1",
		organizationId: "org-1",
		role: "manager" as "admin" | "manager" | "employee",
		teamId: "team-1",
		isActive: true,
	},
	teamPermissions: [{ teamId: "team-1", canManageTeamSettings: true }],
	managerSubareaAssignments: [{ subareaId: "22222222-2222-4222-8222-222222222222" }],
	teamEmployees: [
		{
			id: "employee-2",
			subareaAssignments: [{ subareaId: "11111111-1111-4111-8111-111111111111" }],
			locationAssignments: [],
		},
	],
	locations: [
		{
			id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			organizationId: "org-1",
			name: "North Hub",
			street: null,
			city: "Berlin",
			postalCode: null,
			country: "DE",
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedBy: null,
			subareas: [
				{
					id: "11111111-1111-4111-8111-111111111111",
					locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					name: "Front Desk",
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					employees: [],
				},
				{
					id: "22222222-2222-4222-8222-222222222222",
					locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					name: "Storage",
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					employees: [],
				},
				{
					id: "33333333-3333-4333-8333-333333333333",
					locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					name: "Private Office",
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					employees: [],
				},
			],
			employees: [],
		},
		{
			id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			organizationId: "org-1",
			name: "South Hub",
			street: null,
			city: "Munich",
			postalCode: null,
			country: "DE",
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-02T00:00:00.000Z"),
			updatedBy: null,
			subareas: [
				{
					id: "44444444-4444-4444-8444-444444444444",
					locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
					name: "Remote",
					isActive: true,
					createdAt: new Date("2026-01-02T00:00:00.000Z"),
					employees: [],
				},
			],
			employees: [],
		},
	],
	locationDetail: null as any,
	insertCalls: [] as Array<any>,
	updateCalls: [] as Array<any>,
	deleteCalls: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "id",
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
		teamId: "teamId",
	},
	location: {
		id: "id",
		organizationId: "organizationId",
		createdAt: "createdAt",
		name: "name",
	},
	locationEmployee: { locationId: "locationId", employeeId: "employeeId" },
	locationSubarea: { id: "id", locationId: "locationId", name: "name" },
	subareaEmployee: { subareaId: "subareaId", employeeId: "employeeId" },
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "userId",
		organizationId: "organizationId",
		role: "role",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getSettingsAccessTierForUser: vi.fn(async () => {
		if (mockState.membershipRole === "owner" || mockState.membershipRole === "admin") {
			return "orgAdmin";
		}
		if (mockState.currentEmployee?.role === "manager" || mockState.currentEmployee?.role === "admin") {
			return "manager";
		}
		return "member";
	}),
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/cache/tags", () => ({
	CACHE_TAGS: {
		LOCATIONS: (organizationId: string) => `locations:${organizationId}`,
	},
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		LOCATION_CREATED: "LOCATION_CREATED",
		LOCATION_UPDATED: "LOCATION_UPDATED",
		LOCATION_DELETED: "LOCATION_DELETED",
	},
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
	logger: {
		error: vi.fn(),
	},
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<any>("AuthService");
	return { AuthService };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	return { DatabaseService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const db = {
		query: {
			member: {
				findFirst: vi.fn(async () => ({ role: mockState.membershipRole })),
			},
			employee: {
				findFirst: vi.fn(async () => mockState.currentEmployee),
				findMany: vi.fn(async () => mockState.teamEmployees),
			},
			teamPermissions: {
				findMany: vi.fn(async () => mockState.teamPermissions),
			},
			subareaEmployee: {
				findMany: vi.fn(async () => mockState.managerSubareaAssignments),
			},
			location: {
				findMany: vi.fn(async () => mockState.locations),
				findFirst: vi.fn(async ({ where }: { where?: any }) => {
					const locationId = where?.eq?.[1] ?? null;
					return (
						mockState.locationDetail ??
						mockState.locations.find((location) => location.id === locationId) ??
						null
					);
				}),
			},
			locationSubarea: {
				findFirst: vi.fn(async ({ where, with: withRelations }: { where?: any; with?: any }) => {
					const subareaId = where?.eq?.[1] ?? null;
					const match = mockState.locations
						.flatMap((location) =>
							location.subareas.map((subarea) => ({
								...subarea,
								location: {
									id: location.id,
									organizationId: location.organizationId,
									name: location.name,
								},
							})),
						)
						.find((subarea) => subarea.id === subareaId);

					if (!match) return null;
					return withRelations?.location ? match : { ...match, location: undefined };
				}),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn((value: unknown) => ({
				returning: vi.fn(async () => {
					mockState.insertCalls.push(value);
					return [{ id: "created-location-1" }];
				}),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn((value: unknown) => ({
				where: vi.fn(async () => {
					mockState.updateCalls.push(value);
				}),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn(async (value: unknown) => {
				mockState.deleteCalls.push(value);
			}),
		})),
	};

	return {
		AppLayer: Layer.mergeAll(
			Layer.succeed(AuthService, {
				getSession: () => Effect.succeed(mockState.session),
			}),
			Layer.succeed(DatabaseService, {
				db,
				query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
			}),
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T>(effect: any) => {
			const exit = await Effect.runPromiseExit(effect);
			return Exit.match(exit, {
				onSuccess: (data) => ({ success: true as const, data: data as T }),
				onFailure: (cause) => {
					const defect = [...Cause.defects(cause)][0] ?? null;
					const failure = Option.getOrNull(Cause.failureOption(cause));
					const error = defect ?? failure ?? cause;

					if (error && typeof error === "object" && "message" in error) {
						return { success: false as const, error: (error as { message: string }).message };
					}

					return { success: false as const, error: "Unknown error" };
				},
			});
		},
	};
});

const {
	createLocation,
	deleteLocation,
	getLocation,
	getLocations,
	updateLocation,
	createSubarea,
	updateSubarea,
	deleteSubarea,
} = await import("./actions");

describe("location settings scope behavior", () => {
	beforeEach(() => {
		mockState.membershipRole = "member";
		mockState.currentEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "manager",
			teamId: "team-1",
			isActive: true,
		};
		mockState.teamPermissions = [{ teamId: "team-1", canManageTeamSettings: true }];
		mockState.managerSubareaAssignments = [
			{ subareaId: "22222222-2222-4222-8222-222222222222" },
		];
		mockState.teamEmployees = [
			{
				id: "employee-2",
				subareaAssignments: [{ subareaId: "11111111-1111-4111-8111-111111111111" }],
				locationAssignments: [],
			},
		];
		mockState.locationDetail = null;
		mockState.insertCalls = [];
		mockState.updateCalls = [];
		mockState.deleteCalls = [];
	});

	it("lets managers read only locations tied to own teams or own areas", async () => {
		const result = await getLocations("org-1");

		expect(result).toEqual({
			success: true,
			data: [
				{
					id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

	it("includes locations tied only through managed-team location assignments", async () => {
		mockState.managerSubareaAssignments = [];
		mockState.teamEmployees = [
			{
				id: "employee-2",
				subareaAssignments: [],
				locationAssignments: [{ locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
			},
		];

		const result = await getLocations("org-1");

		expect(result).toEqual({
			success: true,
			data: [
				{
					id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					name: "North Hub",
					city: "Berlin",
					country: "DE",
					isActive: true,
					subareaCount: 3,
					employeeCount: 0,
				},
			],
		});
	});

	it("filters location detail down to scoped subareas for managers", async () => {
		const result = await getLocation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.subareas.map((subarea) => subarea.id)).toEqual([
				"11111111-1111-4111-8111-111111111111",
				"22222222-2222-4222-8222-222222222222",
			]);
		}
	});

	it("rejects manager reads for unrelated locations", async () => {
		const result = await getLocation("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

		expect(result).toEqual({ success: false, error: "Only org admins can manage locations" });
	});

	it("rejects manager location and subarea mutations", async () => {
		expect(
			await createLocation({ organizationId: "org-1", name: "Scoped Location" }),
		).toEqual({ success: false, error: "Only org admins can create locations" });
		expect(
			await updateLocation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { name: "Scoped Rename" }),
		).toEqual({ success: false, error: "Only org admins can update locations" });
		expect(await deleteLocation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toEqual({
			success: false,
			error: "Only org admins can delete locations",
		});
		expect(
			await createSubarea({
				locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				name: "Scoped Subarea",
			}),
		).toEqual({ success: false, error: "Only org admins can create subareas" });
		expect(
			await updateSubarea("11111111-1111-4111-8111-111111111111", { name: "Scoped Subarea" }),
		).toEqual({
			success: false,
			error: "Only org admins can update subareas",
		});
		expect(await deleteSubarea("11111111-1111-4111-8111-111111111111")).toEqual({
			success: false,
			error: "Only org admins can delete subareas",
		});
		expect(mockState.insertCalls).toEqual([]);
		expect(mockState.updateCalls).toEqual([]);
		expect(mockState.deleteCalls).toEqual([]);
	});

	it("keeps owner and admin parity by allowing org-admin reads without an admin employee role", async () => {
		mockState.membershipRole = "owner";
		mockState.currentEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
			teamId: null,
			isActive: true,
		};

		const result = await getLocations("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toHaveLength(2);
		}
	});
});
