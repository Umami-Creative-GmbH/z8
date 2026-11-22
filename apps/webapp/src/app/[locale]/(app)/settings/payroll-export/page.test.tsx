/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireOrgAdminSettingsAccess: vi.fn(),
	getDatevConfigAction: vi.fn(),
	getLexwareConfigAction: vi.fn(),
	getSageConfigAction: vi.fn(),
	getPersonioConfigAction: vi.fn(),
	getSuccessFactorsConfigAction: vi.fn(),
	getWorkdayConfigAction: vi.fn(),
	getPayrollIdentifierFieldsAction: vi.fn(),
	connectorsSpy: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mockState.requireOrgAdminSettingsAccess,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("./actions", () => ({
	getDatevConfigAction: mockState.getDatevConfigAction,
	getLexwareConfigAction: mockState.getLexwareConfigAction,
	getSageConfigAction: mockState.getSageConfigAction,
	getPersonioConfigAction: mockState.getPersonioConfigAction,
	getSuccessFactorsConfigAction: mockState.getSuccessFactorsConfigAction,
	getWorkdayConfigAction: mockState.getWorkdayConfigAction,
	getPayrollIdentifierFieldsAction: mockState.getPayrollIdentifierFieldsAction,
}));

vi.mock("@/components/settings/payroll-export/payroll-connectors-settings", () => ({
	PayrollConnectorsSettings: (props: Record<string, unknown>) => {
		mockState.connectorsSpy(props);
		return <div data-testid="payroll-connectors-settings" />;
	},
}));

const { default: PayrollExportPage } = await import("./page");

describe("PayrollExportPage (#1958)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireOrgAdminSettingsAccess.mockResolvedValue({ organizationId: "org-1" });
		mockState.getDatevConfigAction.mockResolvedValue({ success: true, data: null });
		mockState.getLexwareConfigAction.mockResolvedValue({ success: true, data: null });
		mockState.getSageConfigAction.mockResolvedValue({ success: true, data: null });
		mockState.getPersonioConfigAction.mockResolvedValue({ success: true, data: null });
		mockState.getSuccessFactorsConfigAction.mockResolvedValue({ success: true, data: null });
		mockState.getWorkdayConfigAction.mockResolvedValue({ success: true, data: null });
		mockState.getPayrollIdentifierFieldsAction.mockResolvedValue({ success: true, data: [] });
	});

	it("renders Payroll Connectors & Wage Types title and links to /payroll?tab=export", async () => {
		const page = PayrollExportPage();
		const content = page.props.children;
		render(await content.type(content.props));

		expect(mockState.requireOrgAdminSettingsAccess).toHaveBeenCalledTimes(1);
		expect(
			screen.getByRole("heading", { level: 1, name: "Payroll Connectors & Wage Types" }),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Run exports in Payroll" }).getAttribute("href"),
		).toBe("/payroll?tab=export");
		expect(screen.getByTestId("payroll-connectors-settings")).toBeTruthy();
	});
});
