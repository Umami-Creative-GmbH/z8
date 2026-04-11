import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const { requireOrgAdminSettingsAccessMock, getComplianceCommandCenterDataMock } = vi.hoisted(() => ({
	requireOrgAdminSettingsAccessMock: vi.fn(),
	getComplianceCommandCenterDataMock: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: requireOrgAdminSettingsAccessMock,
}));

vi.mock("@/lib/compliance-command-center/loader", () => ({
	getComplianceCommandCenterData: getComplianceCommandCenterDataMock,
}));

vi.mock("@/components/compliance-command-center/compliance-command-center-page", () => ({
	ComplianceCommandCenterPage: ({ data }: { data: unknown }) =>
		createElement("div", {
			"data-testid": "compliance-page",
			"data-data": JSON.stringify(data),
		}),
}));

describe("compliance page guard", () => {
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

		requireOrgAdminSettingsAccessMock.mockResolvedValue({ organizationId: "org_123" });
		getComplianceCommandCenterDataMock.mockResolvedValue(data);

		const { default: CompliancePage } = await import("./page");
		const page = await CompliancePage();

		expect(requireOrgAdminSettingsAccessMock).toHaveBeenCalledTimes(1);
		expect(getComplianceCommandCenterDataMock).toHaveBeenCalledWith("org_123");
		expect(page.props.data).toEqual(data);
	});
});
