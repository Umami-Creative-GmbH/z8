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

	it("skips the orphaned compliance segment on /settings/compliance/works-council", () => {
		pathnameMock.mockReturnValue("/settings/compliance/works-council");

		render(<SettingsBreadcrumbs />);

		expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
		expect(screen.getByText("Works Council Mode")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Compliance" })).toBeNull();
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
});
