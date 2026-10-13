import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsRouteContext: vi.fn(),
	dismissProrationNotice: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/db", () => ({ db: { name: "db" } }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mocks.getCurrentSettingsRouteContext,
}));
vi.mock("@/lib/absences/proration-notice-store", () => ({
	dismissProrationNotice: mocks.dismissProrationNotice,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

const { dismissProrationNoticeAction } = await import("./proration-notice-actions");

function settingsContext(accessTier: "orgAdmin" | "manager" | "member") {
	return {
		accessTier,
		authContext: {
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		},
	};
}

describe("dismissProrationNoticeAction (#1112)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("dismisses the notice for the actor's active organization", async () => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValue(settingsContext("orgAdmin"));

		await expect(dismissProrationNoticeAction()).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.dismissProrationNotice).toHaveBeenCalledWith(
			{ name: "db" },
			{ organizationId: "org-1", actorUserId: "user-1" },
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/vacation");
	});

	it.each(["manager", "member"] as const)("refuses a %s", async (accessTier) => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValue(settingsContext(accessTier));

		await expect(dismissProrationNoticeAction()).resolves.toMatchObject({ success: false });
		expect(mocks.dismissProrationNotice).not.toHaveBeenCalled();
	});

	it("refuses without a session or an active organization", async () => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValueOnce(null);
		await expect(dismissProrationNoticeAction()).resolves.toMatchObject({ success: false });

		mocks.getCurrentSettingsRouteContext.mockResolvedValueOnce({
			...settingsContext("orgAdmin"),
			authContext: { user: { id: "user-1" }, session: { activeOrganizationId: null } },
		});
		await expect(dismissProrationNoticeAction()).resolves.toMatchObject({ success: false });
		expect(mocks.dismissProrationNotice).not.toHaveBeenCalled();
	});
});
