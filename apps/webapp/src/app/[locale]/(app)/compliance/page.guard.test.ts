import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	requireOrgAdminSettingsAccessMock,
	getComplianceCommandCenterDataMock,
} = vi.hoisted(() => ({
	requireOrgAdminSettingsAccessMock: vi.fn(),
	getComplianceCommandCenterDataMock: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: requireOrgAdminSettingsAccessMock,
}));

vi.mock("@/lib/compliance-command-center/loader", () => ({
	getComplianceCommandCenterData: getComplianceCommandCenterDataMock,
}));

vi.mock(
	"@/components/compliance-command-center/compliance-command-center-page",
	() => ({
		ComplianceCommandCenterPage: () => null,
		CompliancePageLoading: () => null,
	}),
);

describe("compliance page guard", () => {
	beforeEach(() => vi.clearAllMocks());
	it("provides a loading boundary before reading the request session", async () => {
		const { default: CompliancePage } = await import("./page");
		const page = CompliancePage();
		expect(page).not.toBeInstanceOf(Promise);
		expect(requireOrgAdminSettingsAccessMock).not.toHaveBeenCalled();
		expect(page).toHaveProperty("type", Suspense);
	});
	it("loads compliance data for the current org-admin organization", async () => {
		const data = {
			refreshedAt: "2026-04-11T10:00:00.000Z",
			summary: {
				status: "healthy",
				headline: "No active issues detected in monitored signals",
				topRiskKeys: [],
				refreshedAt: "2026-04-11T10:00:00.000Z",
			},
			sections: [],
			recentCriticalEvents: [],
			coverageNotes: [],
		};

		requireOrgAdminSettingsAccessMock.mockResolvedValue({
			organizationId: "org_123",
		});
		getComplianceCommandCenterDataMock.mockResolvedValue(data);

		const { default: CompliancePage } = await import("./page");
		const shell = await CompliancePage();
		const page = await shell.props.children.type(shell.props.children.props);

		expect(requireOrgAdminSettingsAccessMock).toHaveBeenCalledTimes(1);
		expect(getComplianceCommandCenterDataMock).toHaveBeenCalledWith("org_123");
		expect(page.props.data).toEqual(data);
	});
});
