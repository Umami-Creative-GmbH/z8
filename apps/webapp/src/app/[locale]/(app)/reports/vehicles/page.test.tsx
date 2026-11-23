/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentEmployeeMock, getAuthContextMock, getCurrentSettingsAccessMock } = vi.hoisted(
	() => ({
		getCurrentEmployeeMock: vi.fn(),
		getAuthContextMock: vi.fn(),
		getCurrentSettingsAccessMock: vi.fn(),
	}),
);

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		Suspense: ({ children }: { children: ReactNode }) => children,
	};
});

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, defaultValue: string) => defaultValue,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("../actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: getAuthContextMock,
	getCurrentSettingsAccess: getCurrentSettingsAccessMock,
}));

vi.mock("@/components/reports/vehicles/vehicle-distance-report-container", () => ({
	VehicleDistanceReportContainer: () => <div data-testid="vehicle-distance-report" />,
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: ({ feature }: { feature: string }) => (
		<div data-testid="no-employee-error">{feature}</div>
	),
}));

import VehicleDistanceReportPage from "./page";

async function renderPage() {
	const element = VehicleDistanceReportPage();
	const content = await element.props.children.type();
	return render(content);
}

describe("VehicleDistanceReportPage cross-link (#1952)", () => {
	beforeEach(() => {
		getCurrentEmployeeMock.mockReset();
		getAuthContextMock.mockReset();
		getCurrentSettingsAccessMock.mockReset();
	});

	it("shows a contextual link to Missing vehicle logs for managers and org admins", async () => {
		getCurrentEmployeeMock.mockResolvedValue({
			id: "emp-1",
			organizationId: "org-1",
			role: "manager",
		});
		getAuthContextMock.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			employee: { id: "emp-1", organizationId: "org-1" },
		});
		getCurrentSettingsAccessMock.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "scopedManager",
		});

		await renderPage();

		const link = screen.getByRole("link", { name: "Missing vehicle logs" });
		expect(link.getAttribute("href")).toBe("/team/driving");
	});

	it("hides the Missing vehicle logs link for plain employees", async () => {
		getCurrentEmployeeMock.mockResolvedValue({
			id: "emp-1",
			organizationId: "org-1",
			role: "employee",
		});
		getAuthContextMock.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			employee: { id: "emp-1", organizationId: "org-1" },
		});
		getCurrentSettingsAccessMock.mockResolvedValue({
			organizationId: "org-1",
			settingsAccess: "member",
		});

		await renderPage();

		expect(screen.queryByRole("link", { name: "Missing vehicle logs" })).toBeNull();
	});
});
