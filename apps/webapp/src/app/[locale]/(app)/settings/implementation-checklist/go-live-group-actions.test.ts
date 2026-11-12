import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	chooseGoLiveGroupTeams: vi.fn(),
	createGoLiveExclusion: vi.fn(),
	liftGoLiveExclusion: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	// The real query mapping, so a rejected write is a `DatabaseError` as in production.
	const { makeDatabaseService } = await import("@/lib/effect/services/database.service");
	const { query } = makeDatabaseService({});
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { db: { marker: "app-db" }, query }),
	);
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/implementation-checklist/go-live/group-settings", () => ({
	chooseGoLiveGroupTeams: mocks.chooseGoLiveGroupTeams,
	createGoLiveExclusion: mocks.createGoLiveExclusion,
	liftGoLiveExclusion: mocks.liftGoLiveExclusion,
}));

const { chooseGoLiveGroupTeamsAction, createGoLiveExclusionAction, liftGoLiveExclusionAction } =
	await import("./go-live-group-actions");

const TEAM_ID = "6f0f5d1c-9a53-4a8e-9a43-2f6f1c2a9b10";
const EMPLOYEE_ID = "0d5c9a9e-3c51-4c8f-8f6e-6a3f1c2b4d20";
const EXCLUSION_ID = "8e2b7c41-7f0a-4f43-9d0e-1b6c3a5d7e30";

const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-active",
	membershipRole: "admin",
	employee: { id: "employee-admin", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-admin", role: "manager", former: false },
};

describe("go-live group actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.chooseGoLiveGroupTeams.mockResolvedValue({ ok: true });
		mocks.createGoLiveExclusion.mockResolvedValue({ ok: true });
		mocks.liftGoLiveExclusion.mockResolvedValue({ ok: true });
	});

	it("refuses a scoped manager, one level below org admin, and changes nothing", async () => {
		mocks.caller = scopedManager;

		for (const result of [
			await chooseGoLiveGroupTeamsAction([TEAM_ID]),
			await createGoLiveExclusionAction({ employeeId: EMPLOYEE_ID, reason: "Director" }),
			await liftGoLiveExclusionAction(EXCLUSION_ID),
		]) {
			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		}
		expect(mocks.chooseGoLiveGroupTeams).not.toHaveBeenCalled();
		expect(mocks.createGoLiveExclusion).not.toHaveBeenCalled();
		expect(mocks.liftGoLiveExclusion).not.toHaveBeenCalled();
	});

	it("acts in the admin's active organization as the admin", async () => {
		expect(await chooseGoLiveGroupTeamsAction([TEAM_ID])).toEqual({
			success: true,
			data: undefined,
		});
		expect(
			await createGoLiveExclusionAction({ employeeId: EMPLOYEE_ID, reason: "Director" }),
		).toEqual({ success: true, data: undefined });
		expect(await liftGoLiveExclusionAction(EXCLUSION_ID)).toEqual({
			success: true,
			data: undefined,
		});

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

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "reason_required",
			error: "Give a reason for the exclusion.",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("refuses malformed input before reaching the store", async () => {
		const result = await chooseGoLiveGroupTeamsAction("not-a-list" as unknown as string[]);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.chooseGoLiveGroupTeams).not.toHaveBeenCalled();
	});

	it("reports a failed write without leaking its error", async () => {
		mocks.liftGoLiveExclusion.mockRejectedValue(new Error("connection reset"));

		expect(await liftGoLiveExclusionAction(EXCLUSION_ID)).toMatchObject({
			success: false,
			error: "Failed to update the go-live group.",
		});
	});
});
