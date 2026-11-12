import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	dismissProrationNotice: vi.fn(async (_database: unknown, _input: unknown) => undefined),
	revalidatePath: vi.fn(),
	scopedDb: { name: "scoped-db" },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.scopedDb }));
});
vi.mock("@/lib/absences/proration-notice-store", () => ({
	dismissProrationNotice: mocks.dismissProrationNotice,
}));

const { dismissProrationNoticeAction } = await import("./proration-notice-actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...scopedManager,
	employee: { id: "employee-1", role: "employee", former: false },
};

describe("dismissProrationNoticeAction (#1112)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = null;
	});

	it("dismisses the notice for the caller's active organization through the action's database", async () => {
		mocks.caller = orgAdmin;

		await expect(dismissProrationNoticeAction()).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.dismissProrationNotice).toHaveBeenCalledWith(mocks.scopedDb, {
			organizationId: "org-1",
			actorUserId: "user-1",
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/vacation");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/vacation/employees");
	});

	it.each([
		["a scoped manager", scopedManager],
		["an org member", orgMember],
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		["a signed-out caller", null],
		["a caller without an active organization", { ...orgAdmin, activeOrganizationId: null }],
	])("refuses %s", async (_case, caller) => {
		mocks.caller = caller;

		await expect(dismissProrationNoticeAction()).resolves.toMatchObject({ success: false });
		expect(mocks.dismissProrationNotice).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("reports a failed dismissal", async () => {
		mocks.caller = orgAdmin;
		mocks.dismissProrationNotice.mockRejectedValueOnce(new Error("connection lost"));

		await expect(dismissProrationNoticeAction()).resolves.toMatchObject({ success: false });
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});
