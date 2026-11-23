/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getStatutorySettingsAction: vi.fn(),
	updateStatutoryPreferencesAction: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/statutory-actions", () => ({
	getStatutorySettingsAction: mocks.getStatutorySettingsAction,
	updateStatutoryPreferencesAction: mocks.updateStatutoryPreferencesAction,
}));

const { ContractsStatutoryTab } = await import("./contracts-statutory-tab");

function baseline(
	key: string,
	value: number,
	unit: string,
	effectiveFromDate: string,
	effectiveUntilDate: string | null,
	status: "past" | "current" | "upcoming",
) {
	return {
		key,
		countryCode: "DE",
		value,
		unit,
		currency: unit === "cents" ? "EUR" : null,
		effectiveFromDate,
		effectiveUntilDate,
		legalReference: "§ 8 Abs. 1a SGB IV",
		notes: null,
		domain: "minijob",
		status,
	};
}

function renderTab() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ContractsStatutoryTab organizationId="org-1" />
		</QueryClientProvider>,
	);
}

describe("ContractsStatutoryTab (#1988)", () => {
	afterEach(cleanup);

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStatutorySettingsAction.mockResolvedValue({
			success: true,
			data: {
				today: "2026-11-23",
				preferences: {
					warningThresholdPercent: 80,
					criticalThresholdPercent: 95,
					blockJarbschgShiftPublish: false,
					isDefault: true,
				},
				baselines: [
					baseline(
						"de_minijob_monthly_limit_cents",
						55_600,
						"cents",
						"2025-01-01",
						"2026-01-01",
						"past",
					),
					baseline(
						"de_minijob_monthly_limit_cents",
						60_300,
						"cents",
						"2026-01-01",
						"2027-01-01",
						"current",
					),
					baseline(
						"de_minijob_monthly_limit_cents",
						63_300,
						"cents",
						"2027-01-01",
						null,
						"upcoming",
					),
				],
			},
		});
		mocks.updateStatutoryPreferencesAction.mockResolvedValue({
			success: true,
			data: {
				warningThresholdPercent: 70,
				criticalThresholdPercent: 95,
				blockJarbschgShiftPublish: true,
				isDefault: false,
			},
		});
	});

	it("lists current and upcoming baselines and reveals earlier ones on request", async () => {
		renderTab();

		expect(await screen.findByText("€603.00")).toBeTruthy();
		expect(screen.getByText("€633.00")).toBeTruthy();
		expect(screen.getByText("Upcoming")).toBeTruthy();
		expect(screen.queryByText("€556.00")).toBeNull();

		fireEvent.click(screen.getByRole("checkbox", { name: "Show earlier values" }));

		expect(screen.getByText("€556.00")).toBeTruthy();
	});

	it("saves the organization's warning settings", async () => {
		renderTab();
		const warning = await screen.findByLabelText("Warning at");

		fireEvent.change(warning, { target: { value: "70" } });
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.click(screen.getByRole("button", { name: "Save warning settings" }));

		await waitFor(() =>
			expect(mocks.updateStatutoryPreferencesAction).toHaveBeenCalledWith({
				warningThresholdPercent: 70,
				criticalThresholdPercent: 95,
				blockJarbschgShiftPublish: true,
			}),
		);
		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
	});

	it("keeps a warning tier at or above the critical tier from being saved", async () => {
		renderTab();
		const warning = await screen.findByLabelText("Warning at");

		fireEvent.change(warning, { target: { value: "95" } });
		fireEvent.click(screen.getByRole("button", { name: "Save warning settings" }));

		expect(
			await screen.findByText("The warning percentage must be below the critical percentage."),
		).toBeTruthy();
		expect(mocks.updateStatutoryPreferencesAction).not.toHaveBeenCalled();
	});
});
