import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	context: vi.fn(),
	redirect: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mocks.context,
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

import LegacyChangePoliciesPage from "../change-policies/page";
import WorkPoliciesPage from "./page";

function context(accessTier: string, organizationId: string | null = "org-1") {
	return {
		accessTier,
		authContext: { session: { activeOrganizationId: organizationId } },
	};
}
async function content(page: ReturnType<typeof WorkPoliciesPage>) {
	return page.props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.context.mockResolvedValue(context("orgAdmin"));
});
describe("combined Work Policies page", () => {
	it("passes the active organization and admin permissions to both policy views", async () => {
		const page = await content(WorkPoliciesPage());
		expect(page.props.panels.work.props).toMatchObject({
			organizationId: "org-1",
			accessTier: "orgAdmin",
		});
		expect(page.props.panels.changes.props).toMatchObject({
			organizationId: "org-1",
			canManage: true,
		});
		expect(page.key).toBe("org-1");
	});
	it("preserves manager access without granting policy editing", async () => {
		mocks.context.mockResolvedValue(context("manager"));
		const page = await content(WorkPoliciesPage());
		expect(page.props.panels.work.props.accessTier).toBe("manager");
		expect(page.props.panels.changes.props.canManage).toBe(false);
	});
	it.each([null, context("member"), context("orgAdmin", null)])(
		"rejects missing organization or manager access",
		async (routeContext) => {
			mocks.context.mockResolvedValue(routeContext);
			await expect(content(WorkPoliciesPage())).rejects.toThrow(
				"redirect:/settings",
			);
		},
	);
	it("redirects the old Change Policies URL to the correct tab", async () => {
		mocks.context.mockResolvedValue(context("manager"));
		await expect(content(LegacyChangePoliciesPage())).rejects.toThrow(
			"redirect:/settings/work-policies?tab=changes",
		);
	});
	it("keeps members out of the old Change Policies URL", async () => {
		mocks.context.mockResolvedValue(context("member"));
		await expect(content(LegacyChangePoliciesPage())).rejects.toThrow(
			"redirect:/settings",
		);
		expect(mocks.redirect).toHaveBeenCalledWith("/settings");
	});
});
