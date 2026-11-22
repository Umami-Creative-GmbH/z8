/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameMock } = vi.hoisted(() => ({
	pathnameMock: vi.fn<() => string>(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
	usePathname: () => pathnameMock(),
}));

import { SettingsBreadcrumbs } from "./settings-breadcrumbs";

describe("SettingsBreadcrumbs", () => {
	beforeEach(() => {
		pathnameMock.mockReset();
	});

	it("names /settings/vacation/employees as Employee Allowances rather than Employees", () => {
		pathnameMock.mockReturnValue("/settings/vacation/employees");

		render(<SettingsBreadcrumbs />);

		expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
		expect(screen.getByRole("link", { name: "Absences" }).getAttribute("href")).toBe(
			"/settings/vacation",
		);
		expect(screen.getByText("Employee Allowances")).toBeTruthy();
		expect(screen.queryByText("Employees")).toBeNull();
	});

	it("skips the intermediate compliance segment on any /settings/compliance/* child", () => {
		pathnameMock.mockReturnValue("/settings/compliance/works-council");

		const { unmount } = render(<SettingsBreadcrumbs />);

		expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
		expect(screen.getByText("Works Council Mode")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Compliance" })).toBeNull();
		unmount();

		pathnameMock.mockReturnValue("/settings/compliance/other");
		render(<SettingsBreadcrumbs />);
		expect(screen.queryByRole("link", { name: "Compliance" })).toBeNull();
		expect(screen.getByText("Other")).toBeTruthy();
	});

	it("skips the non-routable /settings/export/history intermediate segment", () => {
		pathnameMock.mockReturnValue("/settings/export/history/11111111-1111-4111-8111-111111111111");

		render(<SettingsBreadcrumbs />);

		expect(screen.getByRole("link", { name: "Data Export" }).getAttribute("href")).toBe(
			"/settings/export",
		);
		expect(screen.queryByRole("link", { name: "History" })).toBeNull();
		expect(screen.getByText("Details")).toBeTruthy();
	});

	it("renders contextual labels for UUID detail pages and billable-time subpages", () => {
		pathnameMock.mockReturnValue("/settings/employees/11111111-1111-4111-8111-111111111111");

		const { unmount } = render(<SettingsBreadcrumbs />);
		expect(screen.getByRole("link", { name: "Employees" }).getAttribute("href")).toBe(
			"/settings/employees",
		);
		expect(screen.getByText("Employee Details")).toBeTruthy();
		unmount();

		pathnameMock.mockReturnValue("/settings/billable-time/rates");
		render(<SettingsBreadcrumbs />);
		expect(screen.getByRole("link", { name: "Billable Time" }).getAttribute("href")).toBe(
			"/settings/billable-time",
		);
		expect(screen.getByText("Billable rates")).toBeTruthy();
	});

	it("names /settings/payroll-export as Payroll Connectors & Wage Types (#1958)", () => {
		pathnameMock.mockReturnValue("/settings/payroll-export");

		render(<SettingsBreadcrumbs />);

		expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
		expect(screen.getByText("Payroll Connectors & Wage Types")).toBeTruthy();
	});
});
