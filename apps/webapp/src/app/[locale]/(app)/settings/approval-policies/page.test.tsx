import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsRouteContext: vi.fn(),
	getAbility: vi.fn(),
	loadApprovalSettings: vi.fn(),
	redirectWithLocale: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mocks.getCurrentSettingsRouteContext,
	getAbility: mocks.getAbility,
}));
vi.mock("@/lib/approvals/approval-settings", () => ({
	loadApprovalSettings: mocks.loadApprovalSettings,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock(
	"@/components/settings/approval-policy/approval-policy-management",
	() => ({ ApprovalPolicyManagement: () => null }),
);
vi.mock("@/components/settings/employee-group-management", () => ({
	EmployeeGroupManagement: () => null,
}));
vi.mock(
	"@/components/settings/approval-settings/approval-settings-tabs",
	() => ({ ApprovalSettingsTabs: () => null }),
);
vi.mock(
	"@/components/settings/approval-escalation/approval-escalation-management",
	() => ({ ApprovalEscalationManagement: () => null }),
);
vi.mock(
	"@/components/settings/approval-escalation/deputy-decisions-setting",
	() => ({ DeputyDecisionsSetting: () => null }),
);

import ApprovalSettingsPage from "./page";

function context(
	accessTier = "orgAdmin",
	organizationId: string | null = "org-1",
) {
	return {
		accessTier,
		authContext: { session: { activeOrganizationId: organizationId } },
	};
}
async function content(page: ReturnType<typeof ApprovalSettingsPage>) {
	return page.props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.getCurrentSettingsRouteContext.mockResolvedValue(context());
	mocks.getAbility.mockResolvedValue({ can: () => true });
	mocks.loadApprovalSettings.mockResolvedValue({
		deputyDecisionsEnabled: true,
	});
});

describe("combined Approval settings access", () => {
	it("composes all six panels for an org admin who manages approvals", async () => {
		const page = await content(ApprovalSettingsPage());
		expect(Object.keys(page.props.panels)).toEqual([
			"policies",
			"groups",
			"escalation",
			"attention",
			"channels",
			"history",
		]);
		for (const tab of [
			"policies",
			"groups",
			"attention",
			"channels",
			"history",
		]) {
			expect(page.props.panels[tab].props.organizationId).toBe("org-1");
		}
		expect(
			page.props.panels.escalation.props.children[0].props.organizationId,
		).toBe("org-1");
		expect(page.props.panels.escalation.props.children[1].props.enabled).toBe(
			true,
		);
	});
	it("withholds escalation panels and data from admins without approval management permission", async () => {
		mocks.getAbility.mockResolvedValue({ can: () => false });
		const page = await content(ApprovalSettingsPage());
		expect(Object.keys(page.props.panels)).toEqual(["policies", "groups"]);
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});
	it("preserves escalation access through custom permissions without exposing org-admin policies", async () => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValue(context("member"));
		const page = await content(ApprovalSettingsPage());
		expect(Object.keys(page.props.panels)).toEqual([
			"escalation",
			"attention",
			"channels",
			"history",
		]);
	});
	it("redirects callers without either permission", async () => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValue(context("member"));
		mocks.getAbility.mockResolvedValue({ can: () => false });
		await expect(content(ApprovalSettingsPage())).rejects.toThrow(
			"redirect:/settings",
		);
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});
	it("requires an active organization", async () => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValue(
			context("orgAdmin", null),
		);
		await expect(content(ApprovalSettingsPage())).rejects.toThrow(
			"redirect:/settings",
		);
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});
});
