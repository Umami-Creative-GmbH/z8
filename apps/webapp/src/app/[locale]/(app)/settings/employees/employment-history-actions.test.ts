import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";
const OTHER_EMPLOYEE_ID = "8e4d9f9f-3c8b-4f8f-8b62-1e7f2d3c4b5f";
const HISTORY_ID = "9f5e0a0a-4d9c-4a9a-9c73-2f8a3e4d5c6a";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: [] as string[],
	findEmployee: vi.fn(),
	findHistory: vi.fn(async () => [] as unknown[]),
	selectPeriods: vi.fn(async () => [] as unknown[]),
	transaction: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const db = {
		query: {
			employee: { findFirst: mocks.findEmployee },
			employeeEmploymentHistory: { findMany: mocks.findHistory },
		},
		select: () => ({ from: () => ({ where: mocks.selectPeriods }) }),
		transaction: mocks.transaction,
	};
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([mocks.managedEmployeeIds.map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const {
	cancelEmployeeEmploymentHistoryAction,
	changeEmployeeWageAction,
	confirmEmployeeEmploymentHistoryAction,
	createEmployeeEmploymentHistoryAction,
	listEmployeeEmploymentHistoryAction,
} = await import("./employment-history-actions");

const scopedManager: StubCaller = {
	userId: "user-2",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "user-3",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

describe("employment history actions (#1613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = null;
		mocks.managedEmployeeIds = [];
		mocks.findEmployee.mockImplementation(async () => ({
			id: EMPLOYEE_ID,
			organizationId: "org-1",
		}));
	});

	it("lists a managed employee's terms for their scoped manager", async () => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [EMPLOYEE_ID];
		mocks.findHistory.mockResolvedValueOnce([{ id: HISTORY_ID, employmentPeriodId: null }]);

		await expect(listEmployeeEmploymentHistoryAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: [{ id: HISTORY_ID, employmentPeriodId: null, employmentPeriod: null }],
		});
	});

	it("refuses a scoped manager an employee they do not manage", async () => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [OTHER_EMPLOYEE_ID];

		await expect(listEmployeeEmploymentHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.findHistory).not.toHaveBeenCalled();
	});

	it("reads another organization's employee as not found", async () => {
		mocks.caller = { ...scopedManager, membershipRole: "admin", employee: null };
		mocks.findEmployee.mockResolvedValueOnce(undefined);

		await expect(listEmployeeEmploymentHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("refuses the list to an org member, one level below a scoped manager", async () => {
		mocks.caller = orgMember;

		await expect(listEmployeeEmploymentHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.findEmployee).not.toHaveBeenCalled();
	});

	it.each([
		[
			"create",
			() =>
				createEmployeeEmploymentHistoryAction({
					employeeId: EMPLOYEE_ID,
					data: {} as never,
				}),
		],
		["change wage", () => changeEmployeeWageAction({ employeeId: EMPLOYEE_ID, data: {} as never })],
		[
			"confirm",
			() =>
				confirmEmployeeEmploymentHistoryAction({ employeeId: EMPLOYEE_ID, historyId: HISTORY_ID }),
		],
		[
			"cancel",
			() =>
				cancelEmployeeEmploymentHistoryAction({ employeeId: EMPLOYEE_ID, historyId: HISTORY_ID }),
		],
	])("refuses %s to a scoped manager, one level below org admin", async (_label, run) => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [EMPLOYEE_ID];

		await expect(run()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
});
