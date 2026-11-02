import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAccess: vi.fn(),
	loadGoLiveViewer: vi.fn(),
	rehearse: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { marker: "db" } }));
vi.mock("@/lib/auth-helpers", () => ({ requireOrgAdminSettingsAccess: mocks.requireAccess }));
vi.mock("./queries", () => ({ loadGoLiveViewer: mocks.loadGoLiveViewer }));
vi.mock("@/lib/implementation-checklist/go-live/rehearsal", () => ({
	rehearseGoLiveMember: mocks.rehearse,
}));

import { rehearseGoLiveMemberAction } from "./go-live-rehearsal-actions";

const viewer = { asOf: { timezone: "Europe/Berlin" }, fixLink: () => null };

describe("rehearseGoLiveMemberAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAccess.mockResolvedValue({
			authContext: { user: { id: "user-1" } },
			organizationId: "org-1",
		});
		mocks.loadGoLiveViewer.mockResolvedValue(viewer);
	});

	it("rehearses the member in the caller's own organization", async () => {
		mocks.rehearse.mockResolvedValue({ ok: true, rehearsal: { marker: "trace" } });

		await expect(rehearseGoLiveMemberAction("employee:e-1")).resolves.toEqual({
			success: true,
			data: { marker: "trace" },
		});
		expect(mocks.loadGoLiveViewer).toHaveBeenCalledWith("org-1", expect.anything());
		expect(mocks.rehearse).toHaveBeenCalledWith(
			{ marker: "db" },
			expect.objectContaining({
				organizationId: "org-1",
				memberKey: "employee:e-1",
				asOf: viewer.asOf,
				fixLink: viewer.fixLink,
			}),
		);
	});

	it("never rehearses for someone who is not an org admin", async () => {
		mocks.requireAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(rehearseGoLiveMemberAction("employee:e-1")).rejects.toThrow("NEXT_REDIRECT");
		expect(mocks.rehearse).not.toHaveBeenCalled();
	});

	it("refuses a member who isn't checked", async () => {
		mocks.rehearse.mockResolvedValue({ ok: false, refusal: "member_not_checked" });

		await expect(rehearseGoLiveMemberAction("employee:elsewhere")).resolves.toEqual({
			success: false,
			error: "member_not_checked",
		});
	});

	it.each([42, null, "x".repeat(201)])("refuses a malformed member key %#", async (memberKey) => {
		await expect(rehearseGoLiveMemberAction(memberKey as string)).resolves.toEqual({
			success: false,
			error: "member_not_checked",
		});
		expect(mocks.rehearse).not.toHaveBeenCalled();
	});

	it("is unavailable, never a partial trace, when a lookup fails", async () => {
		mocks.rehearse.mockRejectedValue(new Error("connection terminated"));

		await expect(rehearseGoLiveMemberAction("employee:e-1")).resolves.toEqual({
			success: false,
			error: "unavailable",
		});
	});
});
