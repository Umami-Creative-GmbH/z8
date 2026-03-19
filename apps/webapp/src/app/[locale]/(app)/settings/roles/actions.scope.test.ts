import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	session: {
		user: {
			id: "user-1",
			email: "user@example.com",
			name: "User",
		},
		session: {
			activeOrganizationId: "org-1",
		},
	},
	settingsAccessTier: "orgAdmin" as "orgAdmin" | "manager" | "member" | null,
	employeeRow: null as any,
	listRoles: vi.fn(),
	createRole: vi.fn(),
	employeeFindFirst: vi.fn(async () => mockState.employeeRow),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db/schema", () => ({
	employee: {
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getSettingsAccessTierForUser: vi.fn(async () => mockState.settingsAccessTier),
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
	const { CustomRoleService } = await import("@/lib/effect/services/custom-role.service");

	return {
		AppLayer: Layer.mergeAll(
			Layer.succeed(AuthService, {
				getSession: () => Effect.succeed(mockState.session),
			}),
			Layer.succeed(DatabaseService, {
				db: {
					query: {
						employee: {
							findFirst: mockState.employeeFindFirst,
						},
					},
				},
				query: <T>(_key: string, fn: () => Promise<T>) => Effect.promise(fn),
			}),
			Layer.succeed(CustomRoleService, {
				listRoles: (organizationId: string) =>
					Effect.promise(() => mockState.listRoles(organizationId)),
				createRole: (organizationId: string, input: unknown, createdBy: string) =>
					Effect.promise(() => mockState.createRole(organizationId, input, createdBy)),
				getRole: vi.fn(),
				updateRole: vi.fn(),
				deleteRole: vi.fn(),
				setPermissions: vi.fn(),
				assignRole: vi.fn(),
				unassignRole: vi.fn(),
				getEmployeeRoles: vi.fn(),
			}),
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = <T>(exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defects = Cause.defects(cause);
				const defect = [...defects][0] ?? null;
				const failure = Option.getOrNull(Cause.failureOption(cause));
				const error = defect ?? failure ?? cause;

				if (error && typeof error === "object" && "_tag" in error) {
					return {
						success: false as const,
						error: (error as { message: string }).message,
						code: (error as { _tag: string })._tag,
					};
				}

				return {
					success: false as const,
					error: error instanceof Error ? error.message : "An unexpected error occurred",
					code: "UNKNOWN_ERROR",
				};
			},
			onSuccess: (data) => ({ success: true as const, data }),
		});

	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromiseExit<T>>[0]) => {
			const exit = await Effect.runPromiseExit(effect);
			return toServerActionResult(exit);
		},
	};
});

const { createCustomRole, listCustomRoles } = await import("./actions");

describe("custom role settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.session = {
			user: {
				id: "user-1",
				email: "user@example.com",
				name: "User",
			},
			session: {
				activeOrganizationId: "org-1",
			},
		};
		mockState.settingsAccessTier = "orgAdmin";
		mockState.employeeRow = null;
		mockState.listRoles.mockResolvedValue([]);
		mockState.createRole.mockResolvedValue("role-1");
	});

	it("allows owners without an employee row to list custom roles", async () => {
		mockState.session.user.id = "user-owner";
		mockState.listRoles.mockResolvedValue([{ id: "role-1" }]);

		const result = await listCustomRoles();

		expect(result).toEqual({ success: true, data: [{ id: "role-1" }] });
		expect(mockState.listRoles).toHaveBeenCalledWith("org-1");
	});

	it("allows owners without an employee row to create custom roles", async () => {
		mockState.session.user.id = "user-owner";

		const input = {
			name: "Supervisor",
			baseTier: "manager" as const,
		};

		const result = await createCustomRole(input);

		expect(result).toEqual({ success: true, data: { id: "role-1" } });
		expect(mockState.createRole).toHaveBeenCalledWith("org-1", input, "user-owner");
	});

	it("scopes acting employee lookup to the active organization and active rows", async () => {
		mockState.employeeRow = {
			id: "emp-1",
			organizationId: "org-1",
			role: "admin",
		};

		await listCustomRoles();

		expect(mockState.employeeFindFirst).toHaveBeenCalledTimes(1);
		expect(mockState.employeeFindFirst).toHaveBeenCalledWith({
			where: {
				and: [
					{ eq: ["userId", "user-1"] },
					{ eq: ["organizationId", "org-1"] },
					{ eq: ["isActive", true] },
				],
			},
		});
	});
});
