import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authContext: null as null | { user: { id: string }; session: { activeOrganizationId: string } },
	canManageApprovals: true,
	saveDeputyDecisionsEnabled: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { marker: "db" } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => mocks.authContext,
	getAbility: async () => ({
		cannot: (action: string, subject: string) =>
			!(mocks.canManageApprovals && action === "manage" && subject === "Approval"),
	}),
}));
vi.mock("@/lib/approvals/approval-settings", () => ({
	saveDeputyDecisionsEnabled: mocks.saveDeputyDecisionsEnabled,
}));

const { saveDeputyDecisionsEnabledAction } = await import("./deputy-decisions-actions");

describe("saveDeputyDecisionsEnabledAction", () => {
	beforeEach(() => {
		mocks.authContext = { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } };
		mocks.canManageApprovals = true;
		mocks.saveDeputyDecisionsEnabled.mockReset();
		mocks.revalidatePath.mockReset();
	});

	it("saves the switch for the active organization as the signed-in user", async () => {
		mocks.saveDeputyDecisionsEnabled.mockResolvedValue({
			changed: true,
			deputyDecisionsEnabled: false,
		});

		expect(await saveDeputyDecisionsEnabledAction({ enabled: false })).toEqual({
			success: true,
			data: { deputyDecisionsEnabled: false },
		});
		expect(mocks.saveDeputyDecisionsEnabled).toHaveBeenCalledWith(
			{ marker: "db" },
			{ organizationId: "org-1", enabled: false, actorUserId: "user-1" },
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/approval-escalation");
	});

	it("refuses users who cannot manage approvals, and signed-out users", async () => {
		mocks.canManageApprovals = false;
		expect(await saveDeputyDecisionsEnabledAction({ enabled: false })).toMatchObject({
			success: false,
		});
		mocks.canManageApprovals = true;
		mocks.authContext = null;
		expect(await saveDeputyDecisionsEnabledAction({ enabled: false })).toMatchObject({
			success: false,
		});
		expect(mocks.saveDeputyDecisionsEnabled).not.toHaveBeenCalled();
	});

	it("refuses a value that is not a boolean", async () => {
		expect(await saveDeputyDecisionsEnabledAction({ enabled: "false" })).toMatchObject({
			success: false,
		});
		expect(mocks.saveDeputyDecisionsEnabled).not.toHaveBeenCalled();
	});
});
