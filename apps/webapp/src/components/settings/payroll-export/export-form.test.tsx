/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getFilterOptionsActionMock, startExportActionMock } = vi.hoisted(() => ({
	getFilterOptionsActionMock: vi.fn(),
	startExportActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	getFilterOptionsAction: getFilterOptionsActionMock,
	startExportAction: startExportActionMock,
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
		<div {...props}>{children}</div>
	),
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => (
		<select value={value} onChange={(event) => onValueChange(event.target.value)}>
			{children}
		</select>
	),
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	SelectValue: () => null,
	SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	SelectItem: ({
		value,
		children,
		disabled,
	}: {
		value: string;
		children: React.ReactNode;
		disabled?: boolean;
	}) => (
		<option value={value} disabled={disabled}>
			{children}
		</option>
	),
}));

vi.mock("@/components/ui/tabs", () => ({
	Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
	TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
	ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert", () => ({
	Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ExportForm } from "./export-form";

const fullyConfiguredAvailability = {
	datev_lohn: { configured: true, reason: null },
	lexware_lohn: { configured: true, reason: null },
	sage_lohn: { configured: true, reason: null },
	personio: { configured: true, reason: null },
	successfactors_api: { configured: true, reason: null },
	successfactors_csv: { configured: true, reason: null },
	workday_api: { configured: true, reason: null },
};

beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
});

describe("ExportForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getFilterOptionsActionMock.mockResolvedValue({
			success: true,
			data: {
				employees: [],
				teams: [],
				projects: [],
			},
		});
		startExportActionMock.mockResolvedValue({
			success: true,
			data: {
				jobId: "job-1",
				isAsync: true,
			},
		});
	});

	it("sends selected formatId and updates export button label", async () => {
		render(
			<ExportForm
				organizationId="org_123"
				exportAvailability={fullyConfiguredAvailability}
				config={{
					id: "cfg_123",
					formatId: "datev_lohn",
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					updatedAt: new Date("2026-01-01T00:00:00.000Z"),
					config: {
						consultantNumber: "1234",
						clientNumber: "5678",
						accountingMonth: 1,
						accountingYear: 2026,
						defaultWageType: "1000",
						includeAbsences: true,
						includeCostCenters: false,
						exportFormat: "csv",
					} as never,
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Export to DATEV" })).toBeTruthy();
		}, { timeout: 5000 });

		const formatSelect = screen
			.getAllByRole("combobox")
			.find((combobox) => within(combobox).queryByRole("option", { name: "Workday" }));

		expect(formatSelect).toBeTruthy();
		fireEvent.change(formatSelect as HTMLSelectElement, { target: { value: "workday_api" } });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Export to Workday" })).toBeTruthy();
		}, { timeout: 5000 });

		fireEvent.click(screen.getByRole("button", { name: "Export to Workday" }));

		await waitFor(() => {
			expect(startExportActionMock).toHaveBeenCalledTimes(1);
		});

		expect(startExportActionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org_123",
				formatId: "workday_api",
			}),
		);
	});

	it("renders all export options and disables unconfigured exporters", async () => {
		render(
			<ExportForm
				organizationId="org_123"
				config={null}
				exportAvailability={{
					datev_lohn: { configured: true, reason: null },
					lexware_lohn: { configured: false, reason: "missingConfiguration" },
					sage_lohn: { configured: false, reason: "missingConfiguration" },
					personio: { configured: false, reason: "missingCredentials" },
					successfactors_api: { configured: false, reason: "missingCredentials" },
					successfactors_csv: { configured: true, reason: null },
					workday_api: { configured: true, reason: null },
				}}
			/>,
		);

		const formatSelect = await waitFor(() => {
			const combobox = screen.getAllByRole("combobox")[0];
			expect(combobox).toBeTruthy();
			return combobox as HTMLSelectElement;
		});

		const optionLabels = Array.from(formatSelect.options).map((option) => option.textContent);
		expect(optionLabels).toEqual([
			"DATEV",
			"Lexware",
			"Sage",
			"Personio",
			"SAP SuccessFactors (API)",
			"SAP SuccessFactors (CSV)",
			"Workday",
		]);

		expect(
			(within(formatSelect).getByRole("option", { name: "DATEV" }) as HTMLOptionElement).disabled,
		).toBe(false);
		expect(
			(within(formatSelect).getByRole("option", { name: "Lexware" }) as HTMLOptionElement)
				.disabled,
		).toBe(true);
		expect(
			(within(formatSelect).getByRole("option", { name: "Sage" }) as HTMLOptionElement).disabled,
		).toBe(true);
		expect(
			(within(formatSelect).getByRole("option", { name: "Personio" }) as HTMLOptionElement)
				.disabled,
		).toBe(true);
		expect(
			(
				within(formatSelect).getByRole("option", {
					name: "SAP SuccessFactors (API)",
				}) as HTMLOptionElement
			).disabled,
		).toBe(true);
		expect(
			(
				within(formatSelect).getByRole("option", {
					name: "SAP SuccessFactors (CSV)",
				}) as HTMLOptionElement
			).disabled,
		).toBe(false);
		expect(
			(within(formatSelect).getByRole("option", { name: "Workday" }) as HTMLOptionElement)
				.disabled,
		).toBe(false);
		expect(screen.getByText("Lexware - config")).toBeTruthy();
		expect(screen.getByText("Sage - config")).toBeTruthy();
		expect(screen.getByText("Personio - credentials")).toBeTruthy();
		expect(screen.getByText("SAP SuccessFactors (API) - credentials")).toBeTruthy();
	});

	it("renders export flow without DATEV config and allows Workday selection", async () => {
		render(
			<ExportForm
				organizationId="org_123"
				config={null}
				exportAvailability={{
					datev_lohn: { configured: false, reason: "missingConfiguration" },
					lexware_lohn: { configured: false, reason: "missingConfiguration" },
					sage_lohn: { configured: false, reason: "missingConfiguration" },
					personio: { configured: false, reason: "missingConfiguration" },
					successfactors_api: { configured: false, reason: "missingConfiguration" },
					successfactors_csv: { configured: false, reason: "missingConfiguration" },
					workday_api: { configured: true, reason: null },
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Export to Workday" })).toBeTruthy();
		}, { timeout: 5000 });

		const formatSelect = screen
			.getAllByRole("combobox")
			.find((combobox) => within(combobox).queryByRole("option", { name: "Workday" }));

		expect(formatSelect).toBeTruthy();
		fireEvent.change(formatSelect as HTMLSelectElement, { target: { value: "workday_api" } });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Export to Workday" })).toBeTruthy();
		}, { timeout: 5000 });

		fireEvent.click(screen.getByRole("button", { name: "Export to Workday" }));

		await waitFor(() => {
			expect(startExportActionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org_123",
					formatId: "workday_api",
				}),
			);
		});
	});

	it("allows separate SAP SuccessFactors CSV export selection", async () => {
		render(
			<ExportForm
				organizationId="org_123"
				config={null}
				exportAvailability={{
					datev_lohn: { configured: true, reason: null },
					lexware_lohn: { configured: false, reason: "missingConfiguration" },
					sage_lohn: { configured: false, reason: "missingConfiguration" },
					personio: { configured: false, reason: "missingConfiguration" },
					successfactors_api: { configured: false, reason: "missingCredentials" },
					successfactors_csv: { configured: true, reason: null },
					workday_api: { configured: false, reason: "missingConfiguration" },
				}}
			/>,
		);

		const formatSelect = screen
			.getAllByRole("combobox")
			.find((combobox) =>
				within(combobox).queryByRole("option", { name: "SAP SuccessFactors (CSV)" }),
			);

		fireEvent.change(formatSelect as HTMLSelectElement, {
			target: { value: "successfactors_csv" },
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Export SAP SuccessFactors CSV" })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: "Export SAP SuccessFactors CSV" }));

		await waitFor(() => {
			expect(startExportActionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org_123",
					formatId: "successfactors_csv",
				}),
			);
		});
	});
});
