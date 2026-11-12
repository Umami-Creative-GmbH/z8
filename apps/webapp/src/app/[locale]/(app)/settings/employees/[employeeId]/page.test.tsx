/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockState = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	getCurrentSettingsRouteContext: vi.fn(),
	getEmployee: vi.fn(),
	loadPersonnelFilePanelCapability: vi.fn(),
	getEmployeeEquipment: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mockState.getCurrentSettingsAccess,
	getCurrentSettingsRouteContext: mockState.getCurrentSettingsRouteContext,
}));
vi.mock("../actions", () => ({ getEmployee: mockState.getEmployee }));
vi.mock("@/lib/personnel-file/panel", () => ({
	loadPersonnelFilePanelCapability: mockState.loadPersonnelFilePanelCapability,
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	getEmployeeEquipment: mockState.getEmployeeEquipment,
}));
vi.mock("./employee-detail-page-client", () => ({
	EmployeeDetailPageClient: "EmployeeDetailPageClient",
}));

const { default: EmployeeDetailPage } = await import("./page");

function getContentElement(page: ReturnType<typeof EmployeeDetailPage>) {
	return page.props.children;
}

describe("EmployeeDetailPage viewer settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getEmployeeEquipment.mockResolvedValue({
			success: false,
			code: "AuthorizationError",
		});
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			accessTier: "orgAdmin",
		});
		mockState.getEmployee.mockResolvedValue({
			success: true,
			data: { id: "employee-1", organizationId: "org-1" },
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

	it("passes the viewer's settings access to detail controls", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "owner",
		});

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(mockState.getCurrentSettingsAccess).toHaveBeenCalledTimes(1);
		expect(detailPage.props).toMatchObject({
			currentUserId: "user-1",
			settingsAccess: "owner",
			organizationId: "org-1",
			initialSnapshot: {
				scope: { userId: "user-1", organizationId: "org-1" },
				data: { id: "employee-1" },
				updatedAt: expect.any(Number),
			},
		});
	});
	it("loads equipment through its independent permission boundary for an employee profile", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "owner",
		});
		const equipment = {
			assignments: [{ identifier: "L-01" }],
			canManage: true,
		};
		mockState.getEmployeeEquipment.mockResolvedValue({
			success: true,
			data: equipment,
		});
		const element = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		}).props.children;
		const detail = await element.type(element.props);
		expect(mockState.getEmployeeEquipment).toHaveBeenCalledWith("employee-1");
		expect(detail.props.equipment).toEqual(equipment);
	});

	it("passes the personnel file panel only when the resolver grants it (#865)", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "owner",
		});
		const capability = {
			employeeId: "employee-1",
			categories: ["contract", "payslip"],
			today: "2026-10-09",
		};
		mockState.loadPersonnelFilePanelCapability.mockResolvedValue(capability);

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(mockState.loadPersonnelFilePanelCapability).toHaveBeenCalledWith(
			"employee-1",
		);
		expect(detailPage.props.personnelFile).toEqual(capability);
	});

	it("passes no personnel file panel to managers the resolver refuses", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "scopedManager",
		});
		mockState.getCurrentSettingsRouteContext.mockResolvedValue({
			authContext: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			accessTier: "manager",
		});
		mockState.loadPersonnelFilePanelCapability.mockResolvedValue(null);

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(detailPage.props.personnelFile).toBeNull();
	});

	it("denies detail access when the viewer has no settings access", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: null,
		});

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
