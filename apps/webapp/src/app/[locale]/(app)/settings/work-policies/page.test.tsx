import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	context: vi.fn(),
	redirect: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
	loadOrganizationTimezone: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mocks.context,
}));
vi.mock("@/db", () => ({ db: { marker: "db" } }));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.loadOrganizationTimezone,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirect,
}));
vi.mock("@/components/settings/work-policy/work-policy-management", () => ({
	WorkPolicyManagement: () => null,
}));
vi.mock("@/components/settings/change-policy/change-policy-management", () => ({
	ChangePolicyManagement: () => null,
}));
vi.mock("@/components/settings/work-policy/work-policy-settings-tabs", () => ({
	WorkPolicySettingsTabs: () => null,
}));

import WorkPoliciesPage from "./page";

function caller(
	settingsAccess: "member" | "scopedManager" | "orgAdmin" | "owner" | null,
	organizationId = "org-1",
) {
	return {
		userId: "user-1",
		organizationId,
		settingsAccess,
		membershipRole: settingsAccess ? "admin" : null,
		employee: null,
	};
}
async function content(page: ReturnType<typeof WorkPoliciesPage>) {
	return page.props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.context.mockResolvedValue(caller("orgAdmin"));
	mocks.loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
});
describe("combined Work Policies page", () => {
	it("passes the active organization and admin permissions to both policy views", async () => {
		const page = await content(WorkPoliciesPage());
		expect(page.props.panels.work.props).toMatchObject({
			organizationId: "org-1",
			settingsAccess: "orgAdmin",
			organizationTimezone: "Europe/Berlin",
		});
		expect(mocks.loadOrganizationTimezone).toHaveBeenCalledWith({ marker: "db" }, "org-1");
		expect(page.props.panels.changes.props).toMatchObject({
			organizationId: "org-1",
			canManage: true,
		});
		expect(page.key).toBe("org-1");
	});
	it("preserves manager access without granting policy editing", async () => {
		mocks.context.mockResolvedValue(caller("scopedManager"));
		const page = await content(WorkPoliciesPage());
		expect(page.props.panels.work.props.settingsAccess).toBe("scopedManager");
		expect(page.props.panels.changes.props.canManage).toBe(false);
	});
	it.each([null, caller("member"), caller(null)])(
		"rejects missing organization or scoped-manager access",
		async (routeContext) => {
			mocks.context.mockResolvedValue(routeContext);
			await expect(content(WorkPoliciesPage())).rejects.toThrow("redirect:/settings");
		},
	);
});
