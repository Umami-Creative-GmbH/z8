import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";
const DEACTIVATION_ID = "0b6b5f1e-2c3d-4e5f-8a9b-1c2d3e4f5a6b";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: [] as string[],
	findEmployee: vi.fn(),
	loadReactivationChecklist: vi.fn(async (_db: unknown, _input: unknown) => null),
	dismissReactivationChecklist: vi.fn(async (_db: unknown, _input: unknown) => undefined),
	loadLifecycleHistory: vi.fn(async (_db: unknown, _input: unknown) => ({
		events: [],
		timezone: "Europe/Berlin",
	})),
	db: {} as Record<string, unknown>,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	mocks.db.query = { employee: { findFirst: mocks.findEmployee } };
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: mocks.db,
			query: (name, run) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([mocks.managedEmployeeIds.map((id) => ({ id })), []]) as never)
					: (Effect.promise(run) as never),
		}),
	);
});
vi.mock("@/lib/employee-lifecycle/reactivation-checklist-store", () => ({
	loadReactivationChecklist: mocks.loadReactivationChecklist,
	dismissReactivationChecklist: mocks.dismissReactivationChecklist,
}));
vi.mock("@/lib/employee-lifecycle/lifecycle-history", () => ({
	loadLifecycleHistory: mocks.loadLifecycleHistory,
}));

const {
	dismissReactivationChecklistAction,
	getReactivationChecklistAction,
	listEmployeeLifecycleHistoryAction,
} = await import("./employee-reactivation.actions");

const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "manager-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "member-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "member-1", role: "employee", former: false },
};

describe("reactivation actions (#1441)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = null;
		mocks.managedEmployeeIds = [];
		mocks.findEmployee.mockResolvedValue({ id: EMPLOYEE_ID, organizationId: "org-1" });
	});

	it("loads the checklist in the org admin's organization", async () => {
		mocks.caller = orgAdmin;

		await expect(getReactivationChecklistAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: null,
		});
		expect(mocks.loadReactivationChecklist).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
		});
	});

	it("dismisses the checklist as the org admin", async () => {
		mocks.caller = orgAdmin;

		await expect(
			dismissReactivationChecklistAction({
				employeeId: EMPLOYEE_ID,
				deactivationId: DEACTIVATION_ID,
			}),
		).resolves.toEqual({ success: true, data: undefined });
		expect(mocks.dismissReactivationChecklist).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
			deactivationId: DEACTIVATION_ID,
			actorUserId: "admin-user",
		});
	});

	it("refuses the checklist to a scoped manager, one level below org admin", async () => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [EMPLOYEE_ID];

		await expect(getReactivationChecklistAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(
			dismissReactivationChecklistAction({
				employeeId: EMPLOYEE_ID,
				deactivationId: DEACTIVATION_ID,
			}),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.loadReactivationChecklist).not.toHaveBeenCalled();
		expect(mocks.dismissReactivationChecklist).not.toHaveBeenCalled();
	});

	it("rejects a malformed dismissal", async () => {
		mocks.caller = orgAdmin;

		await expect(
			dismissReactivationChecklistAction({ employeeId: EMPLOYEE_ID, deactivationId: "nope" }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.dismissReactivationChecklist).not.toHaveBeenCalled();
	});

	it("lists the lifecycle history of an employee the scoped manager manages", async () => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [EMPLOYEE_ID];

		await expect(listEmployeeLifecycleHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: true,
		});
		expect(mocks.loadLifecycleHistory).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
		});
	});

	it("refuses a scoped manager the history of an employee they do not manage", async () => {
		mocks.caller = scopedManager;

		await expect(listEmployeeLifecycleHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.loadLifecycleHistory).not.toHaveBeenCalled();
	});

	it("reads another organization's employee as not found", async () => {
		mocks.caller = orgAdmin;
		mocks.findEmployee.mockResolvedValue(undefined);

		await expect(listEmployeeLifecycleHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("refuses the history to an org member, one level below scoped manager", async () => {
		mocks.caller = orgMember;

		await expect(listEmployeeLifecycleHistoryAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.findEmployee).not.toHaveBeenCalled();
	});
});
