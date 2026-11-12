import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseQuery } from "@/lib/effect/services/database.service";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: [] as string[],
	findEmployee: vi.fn(),
	loadEmployeeTrackingDateSettings: vi.fn(),
	previewEmployeeTrackingDate: vi.fn(),
	commitEmployeeTrackingDate: vi.fn(),
	refreshTrackingDateResults: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const db = { query: { employee: { findFirst: mocks.findEmployee } } };
	// A scoped manager's managed scope: their reports, no teams.
	const query: DatabaseQuery = (name, fn) =>
		name === "organizationAction.managedScope"
			? (Effect.succeed([mocks.managedEmployeeIds.map((id) => ({ id })), []]) as never)
			: Effect.promise(fn);
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db, query }));
});
vi.mock("@/lib/time-tracking/employee-tracking-date", () => ({
	loadEmployeeTrackingDateSettings: mocks.loadEmployeeTrackingDateSettings,
	previewEmployeeTrackingDate: mocks.previewEmployeeTrackingDate,
	commitEmployeeTrackingDate: mocks.commitEmployeeTrackingDate,
}));
vi.mock("@/lib/time-tracking/tracking-date-refresh", () => ({
	refreshTrackingDateResults: mocks.refreshTrackingDateResults,
}));

const { TrackingDateRefusal } = await import("@/lib/time-tracking/tracking-date-review-types");
const actions = await import("./employee-tracking-date-actions");

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";
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
const member: StubCaller = {
	userId: "member-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "member-1", role: "employee", former: false },
};
const proposal = { employeeId: EMPLOYEE_ID, trackingStartDate: "2026-05-21" };

describe("employee tracking date actions (#1613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.managedEmployeeIds = [];
		mocks.findEmployee.mockResolvedValue({ id: EMPLOYEE_ID, organizationId: "org-1" });
		mocks.loadEmployeeTrackingDateSettings.mockResolvedValue({ active: true });
	});

	it("reads the tracking dates for an org admin, who may manage them", async () => {
		await expect(actions.getEmployeeTrackingDateAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: { active: true, canManage: true },
		});
		expect(mocks.loadEmployeeTrackingDateSettings).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
		});
	});

	it("reads the tracking dates of a scoped manager's report read-only", async () => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [EMPLOYEE_ID];

		await expect(actions.getEmployeeTrackingDateAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: { active: true, canManage: false },
		});
	});

	it("refuses a scoped manager an employee they do not manage", async () => {
		mocks.caller = scopedManager;

		await expect(actions.getEmployeeTrackingDateAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.loadEmployeeTrackingDateSettings).not.toHaveBeenCalled();
	});

	it("refuses an org member, one level below a scoped manager, the read", async () => {
		mocks.caller = member;

		await expect(actions.getEmployeeTrackingDateAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("reads another organization's employee as not found", async () => {
		mocks.findEmployee.mockResolvedValue(undefined);

		await expect(actions.getEmployeeTrackingDateAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("previews and commits for an org admin in the session's organization", async () => {
		mocks.previewEmployeeTrackingDate.mockResolvedValue({ fingerprint: "f", blockers: [] });
		mocks.commitEmployeeTrackingDate.mockResolvedValue({ employees: [] });
		mocks.refreshTrackingDateResults.mockResolvedValue(false);

		await expect(actions.previewEmployeeTrackingDateAction(proposal)).resolves.toMatchObject({
			success: true,
			data: { fingerprint: "f" },
		});
		expect(mocks.previewEmployeeTrackingDate).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ ...proposal, organizationId: "org-1", actorUserId: "admin-user" }),
		);
		await expect(
			actions.commitEmployeeTrackingDateAction({ ...proposal, fingerprint: "f", reason: "Later" }),
		).resolves.toEqual({ success: true, data: { status: "committed", refreshPending: false } });
	});

	it("refuses a scoped manager, one level below an org admin, the preview and commit", async () => {
		mocks.caller = scopedManager;

		await expect(actions.previewEmployeeTrackingDateAction(proposal)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(
			actions.commitEmployeeTrackingDateAction({ ...proposal, fingerprint: "f", reason: "Later" }),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.previewEmployeeTrackingDate).not.toHaveBeenCalled();
		expect(mocks.commitEmployeeTrackingDate).not.toHaveBeenCalled();
	});

	it("returns a domain refusal as the refusal code", async () => {
		mocks.commitEmployeeTrackingDate.mockRejectedValue(
			new TrackingDateRefusal("stale_preview", "Generate a new preview."),
		);

		await expect(
			actions.commitEmployeeTrackingDateAction({ ...proposal, fingerprint: "f", reason: "Later" }),
		).resolves.toEqual({
			success: false,
			error: "Generate a new preview.",
			code: "ValidationError",
			refusal: "stale_preview",
		});
	});
});
