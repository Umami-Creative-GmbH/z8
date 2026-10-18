import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsRouteContext: vi.fn(),
	getAbility: vi.fn(),
	loadApprovalSettings: vi.fn(),
	getEffectiveApprovalTriagePolicy: vi.fn(),
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
vi.mock("@/lib/approvals/triage-policy", () => ({
	getEffectiveApprovalTriagePolicy: mocks.getEffectiveApprovalTriagePolicy,
}));
vi.mock("@/components/settings/approval-settings/triage-settings-form", () => ({
	ApprovalTriageSettingsForm: () => null,
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
	mocks.getEffectiveApprovalTriagePolicy.mockResolvedValue({
		staleAfterHours: 72,
		smallCorrectionMinutes: 15,
	});
	mocks.getCurrentSettingsRouteContext.mockResolvedValue(context());
	mocks.getAbility.mockResolvedValue({ can: () => true });
	mocks.loadApprovalSettings.mockResolvedValue({
		deputyDecisionsEnabled: true,
	});
});

describe("combined Approval settings access", () => {
	it("composes all seven panels for an org admin who manages approvals", async () => {
		const page = await content(ApprovalSettingsPage());
		expect(Object.keys(page.props.panels)).toEqual([
			"policies",
			"groups",
			"triage",
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
		expect(Object.keys(page.props.panels)).toEqual([
			"policies",
			"groups",
			"triage",
		]);
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});
	it("preserves escalation access through custom permissions without exposing org-admin triage settings", async () => {
		mocks.getCurrentSettingsRouteContext.mockResolvedValue(context("member"));
		const page = await content(ApprovalSettingsPage());
		expect(Object.keys(page.props.panels)).toEqual([
			"escalation",
			"attention",
			"channels",
			"history",
		]);
		expect(mocks.getEffectiveApprovalTriagePolicy).not.toHaveBeenCalled();
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
