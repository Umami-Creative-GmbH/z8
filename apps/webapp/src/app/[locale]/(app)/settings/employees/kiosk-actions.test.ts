import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	issueKioskPin: vi.fn(),
	resetKioskPin: vi.fn(),
	unlockKioskPin: vi.fn(),
	issueKioskBadge: vi.fn(),
	replaceKioskBadge: vi.fn(),
	revokeKioskBadge: vi.fn(),
	removeKioskFob: vi.fn(),
	createKioskOnlyEmployee: vi.fn(),
	addEmailToKioskOnlyEmployee: vi.fn(),
	db: { name: "db" },
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("@/lib/time-tracking/kiosk/pin-store", () => ({
	canManageEmployeeKioskPin: vi.fn(),
	issueKioskPin: mocks.issueKioskPin,
	readKioskPinStatus: vi.fn(),
	resetKioskPin: mocks.resetKioskPin,
	unlockKioskPin: mocks.unlockKioskPin,
}));
vi.mock("@/lib/time-tracking/kiosk/badge-store", () => ({
	issueKioskBadge: mocks.issueKioskBadge,
	readKioskBadgeStatus: vi.fn(),
	replaceKioskBadge: mocks.replaceKioskBadge,
	revokeKioskBadge: mocks.revokeKioskBadge,
}));
vi.mock("@/lib/time-tracking/kiosk/fob-management", () => ({
	kioskFobViewState: vi.fn(),
	readKioskFobStatus: vi.fn(),
	removeKioskFob: mocks.removeKioskFob,
}));
vi.mock("@/lib/time-tracking/kiosk/kiosk-only-employee", () => ({
	createKioskOnlyEmployee: mocks.createKioskOnlyEmployee,
	addEmailToKioskOnlyEmployee: mocks.addEmailToKioskOnlyEmployee,
}));
vi.mock("@/lib/time-tracking/kiosk/kiosk-only-email-upgrade", () => ({
	kioskOnlyEmailUpgradeDeps: {},
}));

const actions = await import("./kiosk-actions");
const { KioskPinRefusal } = await import("@/lib/time-tracking/kiosk/pin-errors");
const { KioskBadgeRefusal } = await import("@/lib/time-tracking/kiosk/badge-errors");

const member: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
/** A pending membership: no settings access, one level below org member. */
const pending: StubCaller = { ...member, membershipRole: null };

const memberActions = [
	["get kiosk state", () => actions.getEmployeeKioskStateAction(EMPLOYEE_ID)],
	[
		"remove fob",
		() => actions.removeEmployeeKioskFobAction({ employeeId: EMPLOYEE_ID, expectedFobId: "f" }),
	],
	["issue badge", () => actions.issueEmployeeKioskBadgeAction(EMPLOYEE_ID)],
	[
		"replace badge",
		() =>
			actions.replaceEmployeeKioskBadgeAction({ employeeId: EMPLOYEE_ID, expectedBadgeId: "b" }),
	],
	[
		"revoke badge",
		() => actions.revokeEmployeeKioskBadgeAction({ employeeId: EMPLOYEE_ID, expectedBadgeId: "b" }),
	],
	["issue PIN", () => actions.issueEmployeeKioskPinAction(EMPLOYEE_ID)],
	["reset PIN", () => actions.resetEmployeeKioskPinAction(EMPLOYEE_ID)],
	["unlock PIN", () => actions.unlockEmployeeKioskPinAction(EMPLOYEE_ID)],
	[
		"create kiosk-only employee",
		() =>
			actions.createKioskOnlyEmployeeAction({
				firstName: "Kim",
				lastName: "Kiosk",
				teamId: null,
				locationIds: [],
			}),
	],
	[
		"add kiosk-only email",
		() =>
			actions.addKioskOnlyEmployeeEmailAction({ employeeId: EMPLOYEE_ID, email: "k@example.test" }),
	],
] as const;

describe("employee kiosk actions (#857, #1364, #1508)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = null;
	});

	it("issues a PIN through the store as the session's organization", async () => {
		mocks.caller = member;
		mocks.issueKioskPin.mockResolvedValue({ pin: "4821" });

		await expect(actions.issueEmployeeKioskPinAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: { pin: "4821" },
		});
		expect(mocks.issueKioskPin).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			actorUserId: "user-1",
			employeeId: EMPLOYEE_ID,
		});
	});

	it("returns the store's refusal code as the refusal", async () => {
		mocks.caller = member;
		mocks.issueKioskPin.mockRejectedValue(new KioskPinRefusal("not_allowed", "No."));
		mocks.replaceKioskBadge.mockRejectedValue(new KioskBadgeRefusal("badge_changed", "Reload."));

		await expect(actions.issueEmployeeKioskPinAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "not_allowed",
		});
		await expect(
			actions.replaceEmployeeKioskBadgeAction({ employeeId: EMPLOYEE_ID, expectedBadgeId: "b" }),
		).resolves.toMatchObject({ success: false, refusal: "badge_changed" });
	});

	it.each(memberActions)("refuses %s to a pending membership", async (_label, run) => {
		mocks.caller = pending;

		await expect(run()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		for (const store of [
			mocks.issueKioskPin,
			mocks.issueKioskBadge,
			mocks.removeKioskFob,
			mocks.createKioskOnlyEmployee,
			mocks.addEmailToKioskOnlyEmployee,
		]) {
			expect(store).not.toHaveBeenCalled();
		}
	});

	it("refuses the kiosk-only locations to a scoped manager, one level below org admin", async () => {
		mocks.caller = member;

		await expect(actions.getKioskOnlyEmployeeLocationsAction()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});
});
