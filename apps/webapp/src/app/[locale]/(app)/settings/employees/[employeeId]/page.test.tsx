/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockState = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	getEmployee: vi.fn(),
	loadPersonnelFilePanelCapability: vi.fn(),
	getEmployeeEquipment: vi.fn(),
	readPersonalDetails: vi.fn(),
	employeeDisplayNames: vi.fn(),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
}));

vi.mock("next/navigation", () => ({ redirect: mockState.redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mockState.getCurrentSettingsAccess,
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
vi.mock("@/lib/organization/personal-details/personal-details", () => ({
	readPersonalDetails: mockState.readPersonalDetails,
}));
vi.mock("@/lib/statutory/employee-display-names", () => ({
	employeeDisplayNames: mockState.employeeDisplayNames,
}));
vi.mock("@/components/settings/personal-details/personal-details-card", () => ({
	PersonalDetailsCard: ({ view }: { view: { employeeId: string } }) => (
		<section aria-label="Personal details card">{view.employeeId}</section>
	),
}));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: vi.fn(async () => "Europe/Berlin"),
}));

const { default: EmployeeDetailPage } = await import("./page");

function getContentElement(page: ReturnType<typeof EmployeeDetailPage>) {
	return page.props.children;
}

describe("EmployeeDetailPage viewer settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.readPersonalDetails.mockResolvedValue(null);
		mockState.getEmployeeEquipment.mockResolvedValue({
			success: false,
			code: "AuthorizationError",
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
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "owner",
			membershipRole: "owner",
			employee: null,
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
		expect(detailPage.props).not.toHaveProperty("accessTier");
	});
	it("loads equipment through its independent permission boundary for an employee profile", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "owner",
			membershipRole: "owner",
			employee: null,
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
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "owner",
			membershipRole: "owner",
			employee: null,
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

		expect(mockState.loadPersonnelFilePanelCapability).toHaveBeenCalledWith("employee-1");
		expect(detailPage.props.personnelFile).toEqual(capability);
	});

	it("passes no personnel file panel to managers the resolver refuses", async () => {
		mockState.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "scopedManager",
			membershipRole: "member",
			employee: { id: "manager-1", role: "manager" },
		});
		mockState.loadPersonnelFilePanelCapability.mockResolvedValue(null);

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);
		const detailPage = await contentElement.type(contentElement.props);

		expect(detailPage.props.personnelFile).toBeNull();
	});

	it.each([
		null,
		{
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: null,
			membershipRole: null,
			employee: null,
		},
		{
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "member",
			membershipRole: "member",
			employee: { id: "employee-1", role: "employee" },
		},
	])("denies detail access without scoped-manager settings access", async (caller) => {
		mockState.getCurrentSettingsAccess.mockResolvedValue(caller);

		const page = EmployeeDetailPage({
			params: Promise.resolve({ employeeId: "employee-1" }),
		});
		const contentElement = getContentElement(page);

		await expect(contentElement.type(contentElement.props)).rejects.toThrow(
			"redirect:/en/settings",
		);
		expect(mockState.getEmployee).not.toHaveBeenCalled();
	});

	describe("a member whose payroll access grant covers the employee (#2071)", () => {
		const member = {
			userId: "holder-1",
			organizationId: "org-1",
			settingsAccess: "member",
			membershipRole: "member",
			employee: { id: "holder-employee", role: "employee" },
		};
		const deciderView = {
			employeeId: "employee-1",
			on: "2026-11-28",
			viewer: { own: false, mayChange: true, revealed: false },
			bankAccount: { current: null, history: [] },
		};

		async function content() {
			const page = EmployeeDetailPage({ params: Promise.resolve({ employeeId: "employee-1" }) });
			const contentElement = getContentElement(page);
			return contentElement.type(contentElement.props);
		}

		it("sees the employee's personal details and nothing else of the record", async () => {
			mockState.getCurrentSettingsAccess.mockResolvedValue(member);
			mockState.readPersonalDetails.mockResolvedValue(deciderView);
			mockState.employeeDisplayNames.mockResolvedValue(
				new Map([["employee-1", "Erika Mustermann"]]),
			);

			render(await content());

			expect(mockState.readPersonalDetails).toHaveBeenCalledWith({
				organizationId: "org-1",
				actorUserId: "holder-1",
				employeeId: "employee-1",
			});
			expect(screen.getByRole("heading", { level: 1, name: "Erika Mustermann" })).toBeTruthy();
			expect(screen.getByRole("region", { name: "Personal details card" }).textContent).toBe(
				"employee-1",
			);
			expect(mockState.getEmployee).not.toHaveBeenCalled();
			expect(mockState.loadPersonnelFilePanelCapability).not.toHaveBeenCalled();
			expect(mockState.getEmployeeEquipment).not.toHaveBeenCalled();
		});

		it("gives a manager outside the employee's scope the personal details their grant covers", async () => {
			mockState.getCurrentSettingsAccess.mockResolvedValue({
				...member,
				settingsAccess: "scopedManager",
				employee: { id: "holder-employee", role: "manager" },
			});
			mockState.getEmployee.mockResolvedValue({ success: false, code: "NotFoundError" });
			mockState.readPersonalDetails.mockResolvedValue(deciderView);
			mockState.employeeDisplayNames.mockResolvedValue(new Map());

			render(await content());

			expect(screen.getByRole("heading", { level: 1, name: "Personal details" })).toBeTruthy();
			expect(screen.getByRole("region", { name: "Personal details card" })).toBeTruthy();
		});

		it("is sent back to settings when the module grants no decision: uncovered, or their own", async () => {
			mockState.getCurrentSettingsAccess.mockResolvedValue(member);
			mockState.readPersonalDetails.mockResolvedValueOnce(null);
			await expect(content()).rejects.toThrow("redirect:/en/settings");

			mockState.readPersonalDetails.mockResolvedValueOnce({
				...deciderView,
				viewer: { own: true, mayChange: false, revealed: true },
			});
			await expect(content()).rejects.toThrow("redirect:/en/settings");

			expect(mockState.employeeDisplayNames).not.toHaveBeenCalled();
			expect(mockState.getEmployee).not.toHaveBeenCalled();
		});
	});
});
