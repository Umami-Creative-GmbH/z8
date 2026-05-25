import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { toServerActionResult } from "@/lib/effect/result";
import { ManagerService } from "@/lib/effect/services/manager.service";

const mocks = vi.hoisted(() => ({
	ensureSettingsActorCanAccessEmployeeTarget: vi.fn(),
	getEmployeeSettingsActorContext: vi.fn(),
	getTargetEmployee: vi.fn(),
	getTargetUser: vi.fn(),
	hasAppAccessChanges: vi.fn(),
	parseHourlyRate: vi.fn(),
	requireOrgAdminEmployeeSettingsAccess: vi.fn(),
	revalidateEmployeesCache: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
	validateInput: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	requestEmployeeWorkBalanceFullRebuild: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
		info: vi.fn(),
	}),
}));

vi.mock("./employee-action-utils", () => ({
	ensureCanAccessEmployeeSettingsTarget: vi.fn(),
	ensureSettingsActorCanAccessEmployeeTarget: mocks.ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeContext: vi.fn(),
	getEmployeeSettingsActorContext: mocks.getEmployeeSettingsActorContext,
	getTargetEmployee: mocks.getTargetEmployee,
	getTargetUser: mocks.getTargetUser,
	hasAppAccessChanges: mocks.hasAppAccessChanges,
	parseHourlyRate: mocks.parseHourlyRate,
	requireOrgAdminEmployeeSettingsAccess: mocks.requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache: mocks.revalidateEmployeesCache,
	runTracedEmployeeAction: mocks.runTracedEmployeeAction,
	validateInput: mocks.validateInput,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mocks.markEmployeeWorkBalanceDirty,
	requestEmployeeWorkBalanceFullRebuild: mocks.requestEmployeeWorkBalanceFullRebuild,
}));

import {
	createEmployeeSchema,
	personalInformationSchema,
	updateEmployeeSchema,
} from "@/lib/validations/employee";
import {
	assignManagersAction,
	createEmployeeAction,
	requestEmployeeWorkBalanceRecalculationAction,
	updateEmployeeAction,
} from "./employee-mutations.actions";

const validUserId = "11111111-1111-4111-8111-111111111111";
const validTeamId = "22222222-2222-4222-8222-222222222222";
const validEmployeeId = "33333333-3333-4333-8333-333333333333";
const validAdminEmployeeId = "44444444-4444-4444-8444-444444444444";

describe("employee mutation schemas", () => {
	it("strips employee-owned names from create employee input", () => {
		const result = createEmployeeSchema.safeParse({
			userId: validUserId,
			organizationId: "org-1",
			teamId: validTeamId,
			role: "employee",
			firstName: "Ada",
			lastName: "Lovelace",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).not.toHaveProperty("firstName");
		expect(result.data).not.toHaveProperty("lastName");
	});

	it("accepts and trims auth user names in update employee input", () => {
		const result = updateEmployeeSchema.safeParse({
			position: "Engineer",
			firstName: " Ada ",
			lastName: " Lovelace ",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.firstName).toBe("Ada");
		expect(result.data.lastName).toBe("Lovelace");
	});

	it("rejects blank auth user names when provided in update employee input", () => {
		const result = updateEmployeeSchema.safeParse({
			firstName: " ",
			lastName: "Lovelace",
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.path).toEqual(["firstName"]);
	});

	it("keeps structured names in self-service profile validation", () => {
		const result = personalInformationSchema.safeParse({
			firstName: "Ada",
			lastName: "Lovelace",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.firstName).toBe("Ada");
		expect(result.data.lastName).toBe("Lovelace");
	});
});

describe("createEmployeeAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not write employee-owned names into the employee insert payload", async () => {
		const returning = vi.fn().mockResolvedValue([
			{
				id: "employee-1",
				userId: validUserId,
				organizationId: "org-1",
			},
		]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));
		const dbService = {
			db: {
				insert,
				query: {
					employee: {
						findFirst: vi.fn().mockResolvedValue(null),
					},
				},
			},
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(options.execute({ setAttribute: vi.fn() })),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1" } },
				currentEmployee: { id: "employee-admin-1", role: "admin" },
				dbService,
			}),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
		mocks.getTargetUser.mockReturnValue(Effect.succeed({ id: validUserId }));
		mocks.validateInput.mockReturnValue(
			Effect.succeed({
				userId: validUserId,
				organizationId: "org-1",
				teamId: validTeamId,
				role: "employee",
				position: "Engineer",
				firstName: "Ada",
				lastName: "Lovelace",
			}),
		);

		await createEmployeeAction({
			userId: validUserId,
			organizationId: "org-1",
			teamId: validTeamId,
			role: "employee",
			firstName: "Ada",
			lastName: "Lovelace",
		} as Parameters<typeof createEmployeeAction>[0]);

		expect(values).toHaveBeenCalledWith(
			expect.not.objectContaining({
				firstName: expect.anything(),
				lastName: expect.anything(),
			}),
		);
	});
});

describe("updateEmployeeAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("writes auth names to the linked user and not the employee update payload", async () => {
		const employeeWhere = vi.fn().mockResolvedValue(undefined);
		const employeeSet = vi.fn(() => ({ where: employeeWhere }));
		const userWhere = vi.fn().mockResolvedValue(undefined);
		const userSet = vi.fn(() => ({ where: userWhere }));
		const update = vi
			.fn()
			.mockReturnValueOnce({ set: employeeSet })
			.mockReturnValueOnce({ set: userSet });
		const dbService = {
			db: {
				update,
			},
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(options.execute({ setAttribute: vi.fn() })),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1", email: "admin@example.com" } },
				dbService,
			}),
		);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({
				id: "employee-1",
				userId: validUserId,
				organizationId: "org-1",
				currentHourlyRate: null,
				contractType: "fixed",
				user: {
					firstName: "Old",
					lastName: "Name",
					name: "Old Name",
				},
			}),
		);
		mocks.ensureSettingsActorCanAccessEmployeeTarget.mockReturnValue(Effect.void);
		mocks.hasAppAccessChanges.mockReturnValue(false);
		mocks.validateInput.mockReturnValue(
			Effect.succeed({
				position: "Engineer",
				firstName: "Ada",
				lastName: "Lovelace",
			}),
		);

		await updateEmployeeAction("employee-1", {
			position: "Engineer",
			firstName: "Ada",
			lastName: "Lovelace",
		} as Parameters<typeof updateEmployeeAction>[1]);

		expect(employeeSet).toHaveBeenCalledWith(
			expect.not.objectContaining({
				firstName: expect.anything(),
				lastName: expect.anything(),
			}),
		);
		expect(userSet).toHaveBeenCalledWith(
			expect.objectContaining({
				firstName: "Ada",
				lastName: "Lovelace",
				name: "Ada Lovelace",
			}),
		);
		expect(update).toHaveBeenNthCalledWith(2, user);
		expect(userWhere).toHaveBeenCalledWith(eq(user.id, validUserId));
	});

	it("preserves existing auth name parts when only one name is provided", async () => {
		const employeeWhere = vi.fn().mockResolvedValue(undefined);
		const employeeSet = vi.fn(() => ({ where: employeeWhere }));
		const userWhere = vi.fn().mockResolvedValue(undefined);
		const userSet = vi.fn(() => ({ where: userWhere }));
		const update = vi
			.fn()
			.mockReturnValueOnce({ set: employeeSet })
			.mockReturnValueOnce({ set: userSet });
		const dbService = {
			db: { update },
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(options.execute({ setAttribute: vi.fn() })),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1", email: "admin@example.com" } },
				dbService,
			}),
		);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({
				id: "employee-1",
				userId: validUserId,
				organizationId: "org-1",
				currentHourlyRate: null,
				contractType: "fixed",
				user: {
					firstName: "ExistingFirst",
					lastName: "ExistingLast",
					name: "ExistingFirst ExistingLast",
				},
			}),
		);
		mocks.ensureSettingsActorCanAccessEmployeeTarget.mockReturnValue(Effect.void);
		mocks.hasAppAccessChanges.mockReturnValue(false);
		mocks.validateInput.mockReturnValue(
			Effect.succeed({
				position: "Engineer",
				firstName: "Ada",
			}),
		);

		await updateEmployeeAction("employee-1", {
			position: "Engineer",
			firstName: "Ada",
		} as Parameters<typeof updateEmployeeAction>[1]);

		expect(employeeSet).toHaveBeenCalledWith(
			expect.not.objectContaining({
				firstName: expect.anything(),
				lastName: expect.anything(),
			}),
		);
		expect(userSet).toHaveBeenCalledWith(
			expect.objectContaining({
				firstName: "Ada",
				lastName: "ExistingLast",
				name: "Ada ExistingLast",
			}),
		);
		expect(update).toHaveBeenNthCalledWith(2, user);
		expect(userWhere).toHaveBeenCalledWith(eq(user.id, validUserId));
	});

	it("does not allow manager-scoped updates to change auth names", async () => {
		const employeeSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
		const userSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
		const update = vi.fn((table) => ({ set: table === user ? userSet : employeeSet }));
		const dbService = {
			db: { update },
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(options.execute({ setAttribute: vi.fn() })),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "manager",
				organizationId: "org-1",
				session: { user: { id: "user-manager-1", email: "manager@example.com" } },
				dbService,
			}),
		);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({
				id: "employee-1",
				userId: validUserId,
				organizationId: "org-1",
				currentHourlyRate: null,
				contractType: "fixed",
			}),
		);
		mocks.ensureSettingsActorCanAccessEmployeeTarget.mockReturnValue(Effect.void);
		mocks.hasAppAccessChanges.mockReturnValue(false);
		mocks.validateInput.mockReturnValue(
			Effect.succeed({
				position: "Engineer",
			}),
		);

		await updateEmployeeAction("employee-1", {
			position: "Engineer",
			firstName: "Ada",
			lastName: "Lovelace",
		} as Parameters<typeof updateEmployeeAction>[1]);

		expect(employeeSet).toHaveBeenCalledWith({
			position: "Engineer",
			currentHourlyRate: null,
			updatedAt: expect.anything(),
		});
		expect(userSet).not.toHaveBeenCalled();
	});

	it("marks the employee work balance dirty when the start date changes", async () => {
		const where = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		const dbService = {
			db: { update },
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(options.execute({ setAttribute: vi.fn() })),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1", email: "admin@example.com" } },
				dbService,
			}),
		);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({
				id: "employee-1",
				userId: validUserId,
				organizationId: "org-1",
				currentHourlyRate: null,
				contractType: "fixed",
				startDate: new Date("2026-05-10T00:00:00.000Z"),
			}),
		);
		mocks.ensureSettingsActorCanAccessEmployeeTarget.mockReturnValue(Effect.void);
		mocks.hasAppAccessChanges.mockReturnValue(false);
		mocks.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mocks.validateInput.mockReturnValue(
			Effect.succeed({
				startDate: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);

		await updateEmployeeAction("employee-1", {
			startDate: new Date("2026-05-01T00:00:00.000Z"),
		} as Parameters<typeof updateEmployeeAction>[1]);

		expect(mocks.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-01",
		});
		expect(where.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});
});

describe("assignManagersAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("records manager assignments as assigned by the session user", async () => {
		const assignManager = vi.fn(() => Effect.void);
		const managerService = {
			assignManager,
			getManagers: vi.fn(() => Effect.succeed([])),
			getManagedEmployees: vi.fn(),
			getPrimaryManager: vi.fn(),
			isManagerOf: vi.fn(),
			removeManager: vi.fn(),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(
				options
					.execute({ setAttribute: vi.fn() })
					.pipe(Effect.provideService(ManagerService, managerService)),
			),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1" } },
				currentEmployee: { id: "employee-admin-1", role: "admin" },
			}),
		);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({ id: "employee-1", organizationId: "org-1" }),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
		mocks.ensureSettingsActorCanAccessEmployeeTarget.mockReturnValue(Effect.void);
		mocks.validateInput.mockReturnValue(
			Effect.succeed({ managers: [{ managerId: "manager-1", isPrimary: true }] }),
		);

		await assignManagersAction("employee-1", {
			managers: [{ managerId: "manager-1", isPrimary: true }],
		});

		expect(assignManager).toHaveBeenCalledWith("employee-1", "manager-1", true, "user-admin-1");
	});
});

describe("requestEmployeeWorkBalanceRecalculationAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.validateInput.mockImplementation((schema, data, fallbackField = "data") => {
			const result = schema.safeParse(data);
			if (result.success) {
				return Effect.succeed(result.data);
			}

			const issue = result.error.issues[0];
			return Effect.fail(
				new ValidationError({
					message: issue?.message ?? "Invalid input",
					field: issue?.path?.join(".") || fallbackField,
				}),
			);
		});
	});

	it("requires org admin access and requests a full work balance rebuild", async () => {
		const setAttribute = vi.fn();
		const findFirst = vi.fn().mockResolvedValue({ id: validEmployeeId, organizationId: "org-1" });
		const dbService = {
			db: { query: { employee: { findFirst } } },
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};
		mocks.runTracedEmployeeAction.mockImplementation(async (options) => {
			expect(options.attributes).toBeUndefined();
			const exit = await Effect.runPromiseExit(options.execute({ setAttribute }));
			return toServerActionResult(exit);
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1" } },
				currentEmployee: { id: validAdminEmployeeId, role: "admin" },
				dbService,
			}),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
		mocks.requestEmployeeWorkBalanceFullRebuild.mockResolvedValue(undefined);

		const result = await requestEmployeeWorkBalanceRecalculationAction(validEmployeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.requireOrgAdminEmployeeSettingsAccess).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", accessTier: "orgAdmin" }),
			{
				message: "Only organization admins can recalculate employee work balances",
				resource: "employee_work_balance",
				action: "recalculate_work_balance",
			},
		);
		expect(mocks.getTargetEmployee).not.toHaveBeenCalled();
		expect(dbService.query).toHaveBeenCalledWith(
			"getEmployeeForWorkBalanceRecalculation",
			expect.any(Function),
		);
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
		expect(setAttribute).toHaveBeenCalledWith("employee.id", validEmployeeId);
		expect(setAttribute).toHaveBeenCalledWith("employee.organizationId", "org-1");
		expect(setAttribute).toHaveBeenCalledWith("requestedBy.userId", "user-admin-1");
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).toHaveBeenCalledWith({
			employeeId: validEmployeeId,
			organizationId: "org-1",
		});
	});

	it("does not request recalculation when the employee is not in the active organization", async () => {
		const findFirst = vi.fn().mockResolvedValue(null);
		const dbService = {
			db: { query: { employee: { findFirst } } },
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};
		mocks.runTracedEmployeeAction.mockImplementation(async (options) => {
			const exit = await Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() }));
			return toServerActionResult(exit);
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1" } },
				currentEmployee: { id: validAdminEmployeeId, role: "admin" },
				dbService,
			}),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);

		const result = await requestEmployeeWorkBalanceRecalculationAction(validEmployeeId);

		expect(result).toEqual({
			success: false,
			error: "Employee not found",
			code: "NotFoundError",
		});
		expect(mocks.getTargetEmployee).not.toHaveBeenCalled();
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
	});

	it("rejects invalid employee IDs before target lookup or rebuild", async () => {
		mocks.runTracedEmployeeAction.mockImplementation(async (options) => {
			expect(options.attributes).toBeUndefined();
			const exit = await Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() }));
			return toServerActionResult(exit);
		});

		const result = await requestEmployeeWorkBalanceRecalculationAction("not-a-uuid");

		expect(result).toEqual({
			success: false,
			error: "Invalid employee ID",
			code: "ValidationError",
		});
		expect(mocks.getEmployeeSettingsActorContext).not.toHaveBeenCalled();
		expect(mocks.requireOrgAdminEmployeeSettingsAccess).not.toHaveBeenCalled();
		expect(mocks.getTargetEmployee).not.toHaveBeenCalled();
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
	});

	it("does not lookup or rebuild when org admin access is denied", async () => {
		mocks.runTracedEmployeeAction.mockImplementation(async (options) => {
			const exit = await Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() }));
			return toServerActionResult(exit);
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "manager",
				organizationId: "org-1",
				session: { user: { id: "user-manager-1" } },
				currentEmployee: { id: "55555555-5555-4555-8555-555555555555", role: "manager" },
			}),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message: "Only organization admins can recalculate employee work balances",
					userId: "user-manager-1",
					resource: "employee_work_balance",
					action: "recalculate_work_balance",
				}),
			),
		);

		const result = await requestEmployeeWorkBalanceRecalculationAction(validEmployeeId);

		expect(result).toEqual({
			success: false,
			error: "Only organization admins can recalculate employee work balances",
			code: "AuthorizationError",
		});
		expect(mocks.requireOrgAdminEmployeeSettingsAccess).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", accessTier: "manager" }),
			{
				message: "Only organization admins can recalculate employee work balances",
				resource: "employee_work_balance",
				action: "recalculate_work_balance",
			},
		);
		expect(mocks.getTargetEmployee).not.toHaveBeenCalled();
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
	});
});
