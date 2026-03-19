import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	session: {
		user: { id: "user-1", email: "user@example.com" },
		session: { activeOrganizationId: "org-1" },
	},
	membershipRole: "member" as "owner" | "admin" | "member" | null,
	currentEmployee: {
		id: "employee-1",
		organizationId: "org-1",
		role: "manager" as "admin" | "manager" | "employee",
		teamId: "team-1",
		isActive: true,
	},
	locationRecord: {
		id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		organizationId: "org-1",
		name: "North Hub",
	},
	subareaRecord: {
		id: "11111111-1111-4111-8111-111111111111",
		locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		location: {
			id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			organizationId: "org-1",
			name: "North Hub",
		},
	},
	targetEmployee: {
		id: "22222222-2222-4222-8222-222222222222",
		organizationId: "org-1",
		isActive: true,
	},
	insertCalls: [] as Array<any>,
	updateCalls: [] as Array<any>,
	deleteCalls: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id", userId: "userId", organizationId: "organizationId", isActive: "isActive" },
	location: { id: "id", organizationId: "organizationId" },
	locationEmployee: { id: "id", locationId: "locationId", employeeId: "employeeId" },
	locationSubarea: { id: "id" },
	subareaEmployee: { id: "id", subareaId: "subareaId", employeeId: "employeeId" },
	teamPermissions: { employeeId: "employeeId", organizationId: "organizationId", teamId: "teamId", canManageTeamSettings: "canManageTeamSettings" },
}));

vi.mock("@/db/auth-schema", () => ({
	member: { userId: "userId", organizationId: "organizationId", role: "role" },
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

vi.mock("@/db", () => ({ db: {} }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() }, createLogger: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() })) }));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	return { AuthService: Context.GenericTag<any>("AuthService") };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	return { DatabaseService: Context.GenericTag<any>("DatabaseService") };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const db = {
		query: {
			member: { findFirst: vi.fn(async () => ({ role: mockState.membershipRole })) },
			employee: {
				findFirst: vi.fn(async ({ where }: { where?: any }) => {
					const lookedUpId = where?.and?.find((item: any) => item?.eq?.[0] === "id")?.eq?.[1];
					if (lookedUpId) return mockState.targetEmployee;
					return mockState.currentEmployee;
				}),
				findMany: vi.fn(async () => []),
			},
			location: { findFirst: vi.fn(async () => mockState.locationRecord) },
			locationEmployee: {
				findFirst: vi.fn(async ({ where, with: withRelations }: { where?: any; with?: any }) => {
					const assignmentId = where?.eq?.[1];
					if (!assignmentId) return null;
					return withRelations?.location
						? { id: assignmentId, locationId: mockState.locationRecord.id, location: mockState.locationRecord }
						: null;
				}),
			},
			subareaEmployee: {
				findMany: vi.fn(async () => []),
				findFirst: vi.fn(async ({ where, with: withRelations }: { where?: any; with?: any }) => {
					const assignmentId = where?.eq?.[1];
					if (!assignmentId) return null;
					return withRelations?.subarea
						? { id: assignmentId, subareaId: mockState.subareaRecord.id, subarea: mockState.subareaRecord }
						: null;
				}),
			},
			teamPermissions: { findMany: vi.fn(async () => []) },
			locationSubarea: { findFirst: vi.fn(async () => mockState.subareaRecord) },
		},
		insert: vi.fn(() => ({
			values: vi.fn((value: unknown) => ({
				returning: vi.fn(async () => {
					mockState.insertCalls.push(value);
					return [{ id: "assignment-1" }];
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
			Layer.succeed(AuthService, { getSession: () => Effect.succeed(mockState.session) }),
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
					return {
						success: false as const,
						error: error && typeof error === "object" && "message" in error ? (error as { message: string }).message : "Unknown error",
					};
				},
			});
		},
	};
});

const {
	assignLocationEmployee,
	updateLocationEmployee,
	removeLocationEmployee,
	assignSubareaEmployee,
	updateSubareaEmployee,
	removeSubareaEmployee,
} = await import("./assignment-actions");

describe("location assignment org-admin parity", () => {
	beforeEach(() => {
		mockState.membershipRole = "member";
		mockState.currentEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "manager",
			teamId: "team-1",
			isActive: true,
		};
		mockState.insertCalls = [];
		mockState.updateCalls = [];
		mockState.deleteCalls = [];
	});

	it("rejects manager assignment mutations", async () => {
		const result = await assignLocationEmployee({
			locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			employeeId: "22222222-2222-4222-8222-222222222222",
			isPrimary: false,
		});

		expect(result).toEqual({
			success: false,
			error: "Only org admins can assign employees to locations",
		});
		expect(mockState.insertCalls).toEqual([]);
	});

	it("keeps owner membership parity for location assignment mutations", async () => {
		mockState.membershipRole = "owner";
		mockState.currentEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
			teamId: null,
			isActive: true,
		};

		const result = await assignLocationEmployee({
			locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			employeeId: "22222222-2222-4222-8222-222222222222",
			isPrimary: false,
		});

		expect(result).toEqual({ success: true, data: { id: "assignment-1" } });
		expect(mockState.insertCalls).toHaveLength(1);
	});

	it("rejects manager updates and deletes across the other location/subarea assignment mutations", async () => {
		expect(await updateLocationEmployee("assignment-1", { isPrimary: true })).toEqual({
			success: false,
			error: "Only org admins can update location assignments",
		});
		expect(await removeLocationEmployee("assignment-1")).toEqual({
			success: false,
			error: "Only org admins can remove location assignments",
		});
		expect(
			await assignSubareaEmployee({
				subareaId: "11111111-1111-4111-8111-111111111111",
				employeeId: "22222222-2222-4222-8222-222222222222",
				isPrimary: false,
			}),
		).toEqual({ success: false, error: "Only org admins can assign employees to subareas" });
		expect(await updateSubareaEmployee("assignment-2", { isPrimary: true })).toEqual({
			success: false,
			error: "Only org admins can update subarea assignments",
		});
		expect(await removeSubareaEmployee("assignment-2")).toEqual({
			success: false,
			error: "Only org admins can remove subarea assignments",
		});
		expect(mockState.insertCalls).toEqual([]);
		expect(mockState.updateCalls).toEqual([]);
		expect(mockState.deleteCalls).toEqual([]);
	});

	it("keeps owner membership parity across the other location/subarea assignment mutations", async () => {
		mockState.membershipRole = "owner";
		mockState.currentEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
			teamId: null,
			isActive: true,
		};

		expect(await updateLocationEmployee("assignment-1", { isPrimary: true })).toEqual({
			success: true,
			data: undefined,
		});
		expect(await removeLocationEmployee("assignment-1")).toEqual({ success: true, data: undefined });
		expect(
			await assignSubareaEmployee({
				subareaId: "11111111-1111-4111-8111-111111111111",
				employeeId: "22222222-2222-4222-8222-222222222222",
				isPrimary: false,
			}),
		).toEqual({ success: true, data: { id: "assignment-1" } });
		expect(await updateSubareaEmployee("assignment-2", { isPrimary: true })).toEqual({
			success: true,
			data: undefined,
		});
		expect(await removeSubareaEmployee("assignment-2")).toEqual({ success: true, data: undefined });
		expect(mockState.insertCalls).toHaveLength(1);
		expect(mockState.updateCalls).toHaveLength(2);
		expect(mockState.deleteCalls).toHaveLength(2);
	});
});
