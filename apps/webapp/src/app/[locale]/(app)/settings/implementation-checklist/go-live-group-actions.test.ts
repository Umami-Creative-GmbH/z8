import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAccess: vi.fn(),
	revalidatePath: vi.fn(),
	chooseGoLiveGroupTeams: vi.fn(),
	createGoLiveExclusion: vi.fn(),
	liftGoLiveExclusion: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/db", () => ({ db: { marker: "app-db" } }));
vi.mock("@/lib/auth-helpers", () => ({ requireOrgAdminSettingsAccess: mocks.requireAccess }));
vi.mock("@/lib/implementation-checklist/go-live/group-settings", () => ({
	chooseGoLiveGroupTeams: mocks.chooseGoLiveGroupTeams,
	createGoLiveExclusion: mocks.createGoLiveExclusion,
	liftGoLiveExclusion: mocks.liftGoLiveExclusion,
}));

import {
	chooseGoLiveGroupTeamsAction,
	createGoLiveExclusionAction,
	liftGoLiveExclusionAction,
} from "./go-live-group-actions";

const TEAM_ID = "6f0f5d1c-9a53-4a8e-9a43-2f6f1c2a9b10";
const EMPLOYEE_ID = "0d5c9a9e-3c51-4c8f-8f6e-6a3f1c2b4d20";
const EXCLUSION_ID = "8e2b7c41-7f0a-4f43-9d0e-1b6c3a5d7e30";

describe("go-live group actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAccess.mockResolvedValue({
			authContext: { user: { id: "admin-user" } },
			organizationId: "org-active",
		});
		mocks.chooseGoLiveGroupTeams.mockResolvedValue({ ok: true });
		mocks.createGoLiveExclusion.mockResolvedValue({ ok: true });
		mocks.liftGoLiveExclusion.mockResolvedValue({ ok: true });
	});

	it("changes nothing for someone who isn't an org admin", async () => {
		mocks.requireAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(chooseGoLiveGroupTeamsAction([TEAM_ID])).rejects.toThrow("NEXT_REDIRECT");
		await expect(
			createGoLiveExclusionAction({ employeeId: EMPLOYEE_ID, reason: "Director" }),
		).rejects.toThrow("NEXT_REDIRECT");
		await expect(liftGoLiveExclusionAction(EXCLUSION_ID)).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.chooseGoLiveGroupTeams).not.toHaveBeenCalled();
		expect(mocks.createGoLiveExclusion).not.toHaveBeenCalled();
		expect(mocks.liftGoLiveExclusion).not.toHaveBeenCalled();
	});

	it("acts in the admin's active organization as the admin", async () => {
		expect(await chooseGoLiveGroupTeamsAction([TEAM_ID])).toEqual({ success: true });
		expect(
			await createGoLiveExclusionAction({ employeeId: EMPLOYEE_ID, reason: "Director" }),
		).toEqual({ success: true });
		expect(await liftGoLiveExclusionAction(EXCLUSION_ID)).toEqual({ success: true });

		const scope = { organizationId: "org-active", actorUserId: "admin-user" };
		expect(mocks.chooseGoLiveGroupTeams).toHaveBeenCalledWith(
			{ marker: "app-db" },
			{ ...scope, teamIds: [TEAM_ID] },
		);
		expect(mocks.createGoLiveExclusion).toHaveBeenCalledWith(
			{ marker: "app-db" },
			{ ...scope, employeeId: EMPLOYEE_ID, reason: "Director" },
		);
		expect(mocks.liftGoLiveExclusion).toHaveBeenCalledWith(
			{ marker: "app-db" },
			{ ...scope, exclusionId: EXCLUSION_ID },
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/implementation-checklist");
	});

	it("passes a refusal back without revalidating", async () => {
		mocks.createGoLiveExclusion.mockResolvedValue({ ok: false, refusal: "reason_required" });

		const result = await createGoLiveExclusionAction({ employeeId: EMPLOYEE_ID, reason: " " });

		expect(result).toEqual({
			success: false,
			refusal: "reason_required",
			error: "Give a reason for the exclusion.",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("refuses malformed input before reaching the store", async () => {
		const result = await chooseGoLiveGroupTeamsAction("not-a-list" as unknown as string[]);

		expect(result).toMatchObject({ success: false, refusal: "team_not_found" });
		expect(mocks.chooseGoLiveGroupTeams).not.toHaveBeenCalled();
	});

	it("reports a failed write without leaking its error", async () => {
		mocks.liftGoLiveExclusion.mockRejectedValue(new Error("connection reset"));

		expect(await liftGoLiveExclusionAction(EXCLUSION_ID)).toEqual({
			success: false,
			error: "Failed to update the go-live group.",
		});
	});
});
