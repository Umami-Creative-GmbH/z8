import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerService } from "@/lib/effect/services/manager.service";

const mocks = vi.hoisted(() => ({
	ensureSettingsActorCanAccessEmployeeTarget: vi.fn(),
	getEmployeeSettingsActorContext: vi.fn(),
	getTargetEmployee: vi.fn(),
	requireOrgAdminEmployeeSettingsAccess: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
	validateInput: vi.fn(),
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
	getTargetUser: vi.fn(),
	hasAppAccessChanges: vi.fn(),
	parseHourlyRate: vi.fn(),
	requireOrgAdminEmployeeSettingsAccess: mocks.requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache: vi.fn(),
	runTracedEmployeeAction: mocks.runTracedEmployeeAction,
	validateInput: mocks.validateInput,
}));

import { assignManagersAction } from "./employee-mutations.actions";

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

		expect(assignManager).toHaveBeenCalledWith(
			"employee-1",
			"manager-1",
			true,
			"user-admin-1",
		);
	});
});
