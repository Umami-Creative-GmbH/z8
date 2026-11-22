/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAdmin: vi.fn(),
	datev: vi.fn(),
	lexware: vi.fn(),
	sage: vi.fn(),
	personio: vi.fn(),
	successfactors: vi.fn(),
	workday: vi.fn(),
	history: vi.fn(),
	identifierFields: vi.fn(),
	timezone: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAdmin,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.timezone,
}));
vi.mock("./actions", () => ({
	getDatevConfigAction: mocks.datev,
	getLexwareConfigAction: mocks.lexware,
	getSageConfigAction: mocks.sage,
	getPersonioConfigAction: mocks.personio,
	getSuccessFactorsConfigAction: mocks.successfactors,
	getWorkdayConfigAction: mocks.workday,
	getExportHistoryAction: mocks.history,
	getPayrollIdentifierFieldsAction: mocks.identifierFields,
}));
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(
				useSyncExternalStore(
					(listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					() => window.location.search,
				),
			),
	};
});
vi.mock("@/components/settings/payroll-export/export-form", () => ({
	ExportForm: () => <input aria-label="Export draft" defaultValue="" />,
}));
vi.mock("@/components/settings/payroll-export/datev-config-form", () => ({
	DatevConfigForm: () => <input aria-label="DATEV draft" defaultValue="" />,
}));
vi.mock("@/components/settings/payroll-export/lexware-config-form", () => ({
	LexwareConfigForm: () => <p>Lexware config panel</p>,
}));
vi.mock("@/components/settings/payroll-export/sage-config-form", () => ({
	SageConfigForm: () => <p>Sage config panel</p>,
}));
vi.mock("@/components/settings/payroll-export/personio-config-form", () => ({
	PersonioConfigForm: () => <p>Personio config panel</p>,
}));
vi.mock("@/components/settings/payroll-export/successfactors-config-form", () => ({
	SuccessFactorsConfigForm: () => <p>SuccessFactors config panel</p>,
}));
vi.mock("@/components/settings/payroll-export/workday-config-form", () => ({
	WorkdayConfigForm: () => <p>Workday config panel</p>,
}));
vi.mock("@/components/settings/payroll-export/wage-type-mappings", () => ({
	WageTypeMappings: ({ hasMappingFormat }: { hasMappingFormat: boolean }) => (
		<p data-has-mapping={String(hasMappingFormat)}>Wage type mappings panel</p>
	),
}));
vi.mock("@/components/settings/payroll-export/expense-wage-type-mappings", () => ({
	ExpenseWageTypeMappings: () => <p>Expense wage type mappings panel</p>,
}));
vi.mock("@/components/settings/payroll-export/export-history", () => ({
	ExportHistory: ({ organizationTimezone }: { organizationTimezone: string }) => (
		<p>History panel ({organizationTimezone})</p>
	),
}));

import PayrollExportPage from "./page";

async function renderPayrollPage() {
	const element = await PayrollExportPage().props.children.type();
	return render(element);
}

beforeEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/en/settings/payroll-export");
	mocks.requireAdmin.mockResolvedValue({ organizationId: "org-1" });
	mocks.datev.mockResolvedValue({ success: true, data: null });
	mocks.lexware.mockResolvedValue({ success: true, data: null });
	mocks.sage.mockResolvedValue({ success: true, data: null });
	mocks.personio.mockResolvedValue({ success: true, data: null });
	mocks.successfactors.mockResolvedValue({ success: true, data: null });
	mocks.workday.mockResolvedValue({ success: true, data: null });
	mocks.history.mockResolvedValue({ success: true, data: [] });
	mocks.identifierFields.mockResolvedValue({ success: true, data: [] });
	mocks.timezone.mockResolvedValue("Europe/Berlin");
});

afterEach(() => {
	cleanup();
});

describe("Payroll Export settings page", () => {
	it("renders all nine tabs in a horizontally scrollable measured frame and defaults to DATEV when unconfigured", async () => {
		const { container } = await renderPayrollPage();

		expect(container.querySelector(".page-frame .page-measure")).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByRole("heading", { level: 1, name: "Payroll Export" })).toBeTruthy();

		const tablist = screen.getByRole("tablist", { name: "Payroll Export" });
		expect(tablist.parentElement?.className).toContain("max-w-full");
		expect(tablist.parentElement?.className).toContain("overflow-x-auto");

		const tabNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
		expect(tabNames).toEqual([
			"Export",
			"DATEV",
			"Lexware",
			"Sage",
			"Personio",
			"SAP SuccessFactors",
			"Workday",
			"Wage Types",
			"History",
		]);

		expect(screen.getByRole("tab", { name: "DATEV" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByLabelText("DATEV draft")).toBeTruthy();
		expect(screen.queryByLabelText("Export draft")).toBeNull();
		expect(screen.queryByText("History panel (Europe/Berlin)")).toBeNull();
	});

	it("defaults to Export when any export target is configured", async () => {
		mocks.datev.mockResolvedValue({ success: true, data: { id: "datev-1" } });

		await renderPayrollPage();

		expect(screen.getByRole("tab", { name: "Export" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByLabelText("Export draft")).toBeTruthy();
		expect(screen.queryByLabelText("DATEV draft")).toBeNull();
	});

	it.each([
		["lexware", "Lexware", "Lexware config panel"],
		["sage", "Sage", "Sage config panel"],
		["personio", "Personio", "Personio config panel"],
		["successfactors", "SAP SuccessFactors", "SuccessFactors config panel"],
		["workday", "Workday", "Workday config panel"],
		["mappings", "Wage Types", "Wage type mappings panel"],
		["history", "History", "History panel (Europe/Berlin)"],
	] as const)(
		"honors ?tab=%s deep link without mounting inactive panels",
		async (tab, label, text) => {
			window.history.replaceState(null, "", `/en/settings/payroll-export?tab=${tab}`);

			await renderPayrollPage();

			expect(screen.getByRole("tab", { name: label }).getAttribute("aria-selected")).toBe("true");
			expect(screen.getByText(text)).toBeTruthy();
			expect(screen.queryByLabelText("DATEV draft")).toBeNull();
			expect(screen.queryByLabelText("Export draft")).toBeNull();
		},
	);

	it("falls back to the smart default for an unknown ?tab= value", async () => {
		mocks.personio.mockResolvedValue({
			success: true,
			data: { id: "personio-1", hasCredentials: true },
		});
		window.history.replaceState(null, "", "/en/settings/payroll-export?tab=invalid");

		await renderPayrollPage();

		expect(screen.getByRole("tab", { name: "Export" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByLabelText("Export draft")).toBeTruthy();
	});

	it("updates ?tab= via replaceState, preserves other URL state, and keeps visited edits mounted", async () => {
		window.history.replaceState(null, "", "/de/settings/payroll-export?from=sidebar#top");

		await renderPayrollPage();

		fireEvent.change(screen.getByLabelText("DATEV draft"), {
			target: { value: "Consultant 12345" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "History" }));

		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe("History panel (Europe/Berlin)"),
		);
		expect(window.location.pathname).toBe("/de/settings/payroll-export");
		expect(window.location.hash).toBe("#top");
		expect(new URLSearchParams(window.location.search).get("from")).toBe("sidebar");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("history");

		fireEvent.click(screen.getByRole("tab", { name: "DATEV" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe("Consultant 12345"),
		);
	});
});
