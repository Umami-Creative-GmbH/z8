/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockState = vi.hoisted(() => ({
	getCurrentApprovedMembership: vi.fn(),
	getCurrentSettingsRouteContext: vi.fn(),
	getEmployee: vi.fn(),
	loadPersonnelFilePanelCapability: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mockState.getCurrentSettingsRouteContext,
}));
vi.mock("../current-approved-membership", () => ({
	getCurrentApprovedMembership: mockState.getCurrentApprovedMembership,
}));
vi.mock("../actions", () => ({ getEmployee: mockState.getEmployee }));
vi.mock("@/lib/personnel-file/panel", () => ({
	loadPersonnelFilePanelCapability: mockState.loadPersonnelFilePanelCapability,
}));
vi.mock("./employee-detail-page-client", () => ({
	EmployeeDetailPageClient: "EmployeeDetailPageClient",
}));

const { default: EmployeeDetailPage } = await import("./page");

function getContentElement(page: ReturnType<typeof EmployeeDetailPage>) {
	return page.props.children;
}

describe("EmployeeDetailPage actor membership", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			accessTier: "orgAdmin",
		});
		mockState.getEmployee.mockResolvedValue({
			success: true,
			data: { id: "employee-1" },
		});
	});

	it("renders the settings fallback while params remain unresolved", () => {
		const page = EmployeeDetailPage({
			params: new Promise<never>(() => {}),
		});

		expect(page).not.toBeInstanceOf(Promise);
		render(page);

		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
		expect(mockState.getEmployee).not.toHaveBeenCalled();
	});

	it("passes the approved membership role to detail controls", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue({ role: "owner" });

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(mockState.getCurrentApprovedMembership).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
		});
		expect(detailPage.props).toMatchObject({
			currentUserId: "user-1",
			currentMemberRole: "owner",
		});
	});

	it("passes the personnel file panel only when the resolver grants it (#865)", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue({ role: "owner" });
		const capability = {
			employeeId: "employee-1",
			categories: ["contract", "payslip"],
			today: "2026-10-09",
		};
		mockState.loadPersonnelFilePanelCapability.mockResolvedValue(capability);

		const page = EmployeeDetailPage({ params: Promise.resolve({ employeeId: "employee-1" }) });
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(mockState.loadPersonnelFilePanelCapability).toHaveBeenCalledWith("employee-1");
		expect(detailPage.props.personnelFile).toEqual(capability);
	});

	it("passes no personnel file panel to managers the resolver refuses", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue({ role: "member" });
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			accessTier: "manager",
		});
		mockState.loadPersonnelFilePanelCapability.mockResolvedValue(null);

		const page = EmployeeDetailPage({ params: Promise.resolve({ employeeId: "employee-1" }) });
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(detailPage.props.personnelFile).toBeNull();
	});

	it("denies detail access when no approved membership exists", async () => {
		mockState.getCurrentApprovedMembership.mockResolvedValue(null);

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);

		await expect(contentElement.type(contentElement.props)).rejects.toThrow(
			"redirect:/en/settings",
		);
		expect(mockState.getEmployee).not.toHaveBeenCalled();
	});
});
