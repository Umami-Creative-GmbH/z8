import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
}));

import {
	createEmployeeSchema,
	personalInformationSchema,
	updateEmployeeSchema,
} from "@/lib/validations/employee";
import {
	assignManagersAction,
	createEmployeeAction,
	updateEmployeeAction,
} from "./employee-mutations.actions";

const validUserId = "11111111-1111-4111-8111-111111111111";
const validTeamId = "22222222-2222-4222-8222-222222222222";

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

	it("strips employee-owned names from update employee input", () => {
		const result = updateEmployeeSchema.safeParse({
			position: "Engineer",
			firstName: "Ada",
			lastName: "Lovelace",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).not.toHaveProperty("firstName");
		expect(result.data).not.toHaveProperty("lastName");
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

	it("does not write employee-owned names into the employee update payload", async () => {
		const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
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

		expect(set).toHaveBeenCalledWith(
			expect.not.objectContaining({
				firstName: expect.anything(),
				lastName: expect.anything(),
			}),
		);
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
