import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	preview: vi.fn(),
	commit: vi.fn(),
	refresh: vi.fn(),
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: { stub: "db" } }));
});
vi.mock("@/lib/time-tracking/tracking-date-review", () => ({
	previewOrganizationTrackingDate: mocks.preview,
	commitOrganizationTrackingDate: mocks.commit,
}));
vi.mock("@/lib/time-tracking/tracking-date-refresh", () => ({
	refreshTrackingDateResults: mocks.refresh,
}));

const { commitOrganizationTrackingDateAction, previewOrganizationTrackingDateAction } =
	await import("./tracking-date-actions");

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const commitInput = { trackingStartDate: "2026-05-21", fingerprint: "fp", reason: "Reviewed" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.preview.mockResolvedValue({ fingerprint: "fp", blockers: [] });
	mocks.commit.mockResolvedValue({ employees: [] });
	mocks.refresh.mockResolvedValue(false);
});

describe("organization tracking-date actions", () => {
	it.each([
		["preview", () => previewOrganizationTrackingDateAction({ trackingStartDate: "2026-05-21" })],
		["commit", () => commitOrganizationTrackingDateAction(commitInput)],
	])("refuses the %s to a workforce admin, who is a scoped manager", async (_name, run) => {
		mocks.caller = {
			...orgAdmin,
			membershipRole: "member",
			employee: { id: "employee-admin", role: "admin", former: false },
		};

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.preview).not.toHaveBeenCalled();
		expect(mocks.commit).not.toHaveBeenCalled();
	});

	it("previews and commits for the session's organization, then refreshes", async () => {
		expect(
			await previewOrganizationTrackingDateAction({ trackingStartDate: "2026-05-21" }),
		).toEqual({ success: true, data: { fingerprint: "fp", blockers: [] } });
		expect(mocks.preview).toHaveBeenCalledWith(
			{ stub: "db" },
			expect.objectContaining({
				trackingStartDate: "2026-05-21",
				organizationId: "org-1",
				actorUserId: "user-admin",
			}),
		);

		expect(await commitOrganizationTrackingDateAction(commitInput)).toEqual({
			success: true,
			data: { status: "committed", refreshPending: false },
		});
		expect(mocks.refresh).toHaveBeenCalledWith("org-1", { employees: [] });
	});

	it.each(["stale_preview", "blocked", "invalid_input"] as const)(
		"reports a %s refusal by its code",
		async (code) => {
			mocks.commit.mockRejectedValue(new TrackingDateRefusal(code, `Refused: ${code}`));

			expect(await commitOrganizationTrackingDateAction(commitInput)).toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: code,
				error: `Refused: ${code}`,
			});
			expect(mocks.refresh).not.toHaveBeenCalled();
		},
	);

	it("refuses a submitted organization ID", async () => {
		expect(
			await previewOrganizationTrackingDateAction({
				trackingStartDate: "2026-05-21",
				organizationId: "org-other",
			} as never),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.preview).not.toHaveBeenCalled();
	});
});
