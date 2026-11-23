/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameMock, getCurrentEmployeeProjectReportAccessMock, getCurrentEmployeeMock } =
	vi.hoisted(() => ({
		pathnameMock: vi.fn(() => "/reports"),
		getCurrentEmployeeProjectReportAccessMock: vi.fn(),
		getCurrentEmployeeMock: vi.fn(),
	}));

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
	usePathname: () => pathnameMock(),
}));

vi.mock("./projects/actions", () => ({
	getCurrentEmployeeProjectReportAccess: getCurrentEmployeeProjectReportAccessMock,
}));

vi.mock("./actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/components/reports/reports-container", () => ({
	ReportsContainer: () => <div data-testid="reports-container" />,
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: ({ feature }: { feature: string }) => (
		<div data-testid="no-employee-error">{feature}</div>
	),
}));

import { ReportsNavTabs } from "./layout";
import ReportsPage from "./page";
import { resolveReportsTab } from "./reports-tabs";

describe("shared /reports tabbed layout (#1954)", () => {
	beforeEach(() => {
		pathnameMock.mockReturnValue("/reports");
		getCurrentEmployeeProjectReportAccessMock.mockReset();
		getCurrentEmployeeMock.mockReset();
	});

	it.each([
		["/reports", "time-and-absences"],
		["/en/reports", "time-and-absences"],
		["/reports/projects", "projects"],
		["/de/reports/projects/", "projects"],
		["/reports/vehicles", "vehicles"],
		["/en/reports/vehicles", "vehicles"],
	])("resolves active tab for %s as %s", (pathname, expected) => {
		expect(resolveReportsTab(pathname)).toBe(expected);
	});

	it("shows Time & Absences, Projects, and Vehicles tabs when projects are enabled and viewer is authorized", async () => {
		pathnameMock.mockReturnValue("/reports/projects");
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: { id: "emp-1", role: "employee" },
			projectsEnabled: true,
			canViewProjectReports: true,
		});

		render(await ReportsNavTabs());

		const timeTab = screen.getByRole("tab", { name: "Time & Absences" });
		const projectsTab = screen.getByRole("tab", { name: "Projects" });
		const vehiclesTab = screen.getByRole("tab", { name: "Vehicles" });

		expect(timeTab.getAttribute("href")).toBe("/reports");
		expect(projectsTab.getAttribute("href")).toBe("/reports/projects");
		expect(vehiclesTab.getAttribute("href")).toBe("/reports/vehicles");
		expect(projectsTab.getAttribute("aria-selected")).toBe("true");
		expect(timeTab.getAttribute("aria-selected")).toBe("false");
		expect(vehiclesTab.getAttribute("aria-selected")).toBe("false");
	});

	it("hides the Projects tab when projectsEnabled is false", async () => {
		pathnameMock.mockReturnValue("/reports/vehicles");
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: { id: "emp-1", role: "admin" },
			projectsEnabled: false,
			canViewProjectReports: false,
		});

		render(await ReportsNavTabs());

		expect(screen.getByRole("tab", { name: "Time & Absences" })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Projects" })).toBeNull();
		const vehiclesTab = screen.getByRole("tab", { name: "Vehicles" });
		expect(vehiclesTab.getAttribute("aria-selected")).toBe("true");
	});

	it("hides the Projects tab for plain employees without project-report permission", async () => {
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: { id: "emp-1", role: "employee" },
			projectsEnabled: true,
			canViewProjectReports: false,
		});

		render(await ReportsNavTabs());

		expect(screen.getByRole("tab", { name: "Time & Absences" })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Projects" })).toBeNull();
		expect(screen.getByRole("tab", { name: "Vehicles" })).toBeTruthy();
	});

	it("removes the standalone Distance per Vehicle header button from /reports", async () => {
		getCurrentEmployeeMock.mockResolvedValue({
			id: "emp-1",
			organizationId: "org-1",
			userId: "user-1",
		});

		const element = ReportsPage();
		const content = await element.props.children.type();
		render(content);

		expect(screen.getByTestId("reports-container")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Distance per Vehicle" })).toBeNull();
	});
});
