/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportActions = vi.hoisted(() => ({
	getMyTravelExpenseReport: vi.fn(),
	getTravelExpenseReportSubmission: vi.fn(),
	submitTravelExpenseReportAction: vi.fn(),
	saveReceiptItemDraftAction: vi.fn(),
	removeReportReceiptAction: vi.fn(),
	saveTripDetailsDraftAction: vi.fn(),
	addTripReportItemAction: vi.fn(),
	removeTripReportItemAction: vi.fn(),
}));
const mileageActions = vi.hoisted(() => ({
	saveMileageItemDraftAction: vi.fn(),
	addTripMileageItemAction: vi.fn(),
	createStandaloneMileageReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
vi.mock("@/app/[locale]/(app)/travel-expenses/mileage-actions", () => mileageActions);
const projectActions = vi.hoisted(() => ({
	getReportProjectChoicesAction: vi.fn(),
	getReportProjectIssuesAction: vi.fn(),
	saveItemProjectAction: vi.fn(),
	saveTripProjectAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-project-actions", () => projectActions);
// A native select stands in for the popover select, so the test drives the field, not the widget.
vi.mock("@/components/ui/select", () => ({
	Select: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (value: string) => void;
		children: React.ReactNode;
	}) => (
		<select
			aria-label="Project"
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
		>
			{children}
		</select>
	),
	SelectTrigger: () => null,
	SelectValue: () => null,
	SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
		<option value={value}>{children}</option>
	),
}));
vi.mock("@/hooks/use-travel-expense-file-upload", () => ({
	useTravelExpenseFileUpload: () => ({
		addFile: vi.fn(),
		progress: 0,
		isUploading: false,
		isProcessing: false,
		reset: vi.fn(),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
const viewer = vi.hoisted(() => ({ locale: "en-US" }));
vi.mock("next-intl", () => ({ useLocale: () => viewer.locale }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-review-actions", () => ({
	withdrawTravelExpenseReportAction: vi.fn(),
}));
// #615: the adjustment notices find no adjustment for these reports.
vi.mock("@/app/[locale]/(app)/travel-expenses/adjustment-actions", () => ({
	createTravelExpenseAdjustmentAction: vi.fn(),
	getTravelExpenseReportAdjustments: async () => ({
		success: false,
		error: "Expense report not found",
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

import { TravelExpenseReportEditor } from "./travel-expense-report-editor";

const reportId = "6a060000-0000-4000-8000-000000000001";
const itemId = "6a060000-0000-4000-8000-000000000002";

const policy = {
	policyId: "6a060000-0000-4000-8000-0000000000a1",
	versionId: "6a060000-0000-4000-8000-0000000000a2",
	effectiveFrom: "2026-01-01",
	vehicle: "car",
	ratePerKm: "0.3000",
	currency: "EUR",
	source: {
		kind: "statutory_default",
		reference: "§ 9 EStG",
		version: "LStH 2026, Anhang 25 III",
		defaultKey: "de-mileage-estg-9-1-4a",
	},
};

function mileageItem(calculation: unknown, overrides: Record<string, unknown> = {}) {
	return {
		id: itemId,
		type: "mileage",
		version: 3,
		updatedAt: "2026-10-05T10:00:00.000Z",
		expenseDate: "2026-09-15",
		category: null,
		description: null,
		amount: null,
		currency: null,
		paidBy: "employee",
		accountingReference: null,
		receipts: [],
		mileage: {
			route: "Berlin – Potsdam – back",
			distanceKm: "123.45",
			vehicle: "car",
			calculation,
			amount: (calculation as { status: string }).status === "calculated" ? "37.04" : null,
			currency: (calculation as { status: string }).status === "calculated" ? "EUR" : null,
		},
		...overrides,
	};
}

const calculated = {
	status: "calculated",
	distanceKm: "123.45",
	ratePerKm: "0.3000",
	currency: "EUR",
	exactAmount: "37.035000",
	amount: "37.04",
	rounding: "half_up",
	policy,
};

function standalone(item: unknown) {
	return {
		success: true,
		data: {
			id: reportId,
			kind: "standalone",
			status: "draft",
			reimbursementCurrency: "EUR",
			createdAt: "2026-10-05T09:00:00.000Z",
			updatedAt: "2026-10-05T10:00:00.000Z",
			trip: null,
			items: [item],
		},
	};
}

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseReportEditor reportId={reportId} maxReceiptBytes={1024} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	reportActions.getMyTravelExpenseReport.mockResolvedValue(standalone(mileageItem(calculated)));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	viewer.locale = "en-US";
});

describe("mileage expenses (#606)", () => {
	it("shows the server's calculation with the applied dated rate and counts it", async () => {
		mount();
		const calculation = await screen.findByRole("region", { name: "Calculated mileage" });
		expect(within(calculation).getByText(/123\.45 km × €0\.30 per km = €37\.04/)).toBeTruthy();
		expect(within(calculation).getByText(/exactly €37\.035, rounded to the cent/)).toBeTruthy();
		expect(
			within(calculation).getByText(
				"Rate valid from Jan 1, 2026 · German statutory flat rate (LStH 2026, Anhang 25 III)",
			),
		).toBeTruthy();
		const totals = screen.getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("Reimbursed to you").nextElementSibling?.textContent).toBe(
			"€37.04",
		);
		expect(
			(screen.getByRole("button", { name: "Review and submit" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("makes missing policy coverage actionable and blocks submission without inventing a rate", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			standalone(
				mileageItem({ status: "policy_missing", expenseDate: "2026-09-15", vehicle: "car" }),
			),
		);
		mount();
		expect(await screen.findByText("No mileage rate applies")).toBeTruthy();
		expect(
			screen.getByText(
				"Your organization has no mileage rate for Car on Sep 15, 2026. Ask an expense administrator to add a dated rate in the travel expense settings. Nothing is calculated until then.",
			),
		).toBeTruthy();
		const totals = screen.getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("Reimbursed to you").nextElementSibling?.textContent).toBe(
			"€0.00",
		);
		expect(
			(screen.getByRole("button", { name: "Review and submit" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("saves only the entered facts and never sends an amount", async () => {
		mileageActions.saveMileageItemDraftAction.mockResolvedValue({
			success: true,
			data: {
				status: "saved",
				item: mileageItem(
					{ ...calculated, distanceKm: "130.00", exactAmount: "39.000000", amount: "39.00" },
					{
						version: 4,
					},
				),
			},
		});
		mount();
		const distance = (await screen.findByLabelText("Kilometres driven")) as HTMLInputElement;
		fireEvent.change(distance, { target: { value: "130" } });
		expect(
			await screen.findByText(
				"Calculated with your organization's rate once your changes are saved.",
			),
		).toBeTruthy();

		await waitFor(() => expect(mileageActions.saveMileageItemDraftAction).toHaveBeenCalled(), {
			timeout: 3000,
		});
		expect(mileageActions.saveMileageItemDraftAction).toHaveBeenCalledWith({
			reportId,
			itemId,
			expectedVersion: 3,
			values: {
				expenseDate: "2026-09-15",
				route: "Berlin – Potsdam – back",
				distanceKm: "130",
				vehicle: "car",
				accountingReference: null,
			},
		});
	});
	it("shows the distance in the viewer's locale without saving again for the format (#688)", async () => {
		viewer.locale = "de";
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			standalone(
				mileageItem(calculated, {
					mileage: { ...mileageItem(calculated).mileage, distanceKm: "289.70" },
				}),
			),
		);
		mileageActions.saveMileageItemDraftAction.mockResolvedValue({
			success: true,
			data: { status: "saved", item: mileageItem(calculated, { version: 4 }) },
		});
		mount();
		const distance = (await screen.findByLabelText("Kilometres driven")) as HTMLInputElement;
		// A reload shows the saved distance as the locale writes it.
		expect(distance.value).toBe("289,7");

		fireEvent.change(distance, { target: { value: "289.70" } });
		// What is typed stays as typed until the field loses focus.
		expect(distance.value).toBe("289.70");
		await waitFor(
			() => expect(mileageActions.saveMileageItemDraftAction).toHaveBeenCalledTimes(1),
			{
				timeout: 3000,
			},
		);
		fireEvent.blur(distance);
		expect(distance.value).toBe("289,7");
		await new Promise((resolve) => setTimeout(resolve, 1200));
		expect(mileageActions.saveMileageItemDraftAction).toHaveBeenCalledTimes(1);
	});
	it("lets a standalone drive name its own project (#688)", async () => {
		const project = "6a060000-0000-4000-8000-0000000000c1";
		projectActions.getReportProjectChoicesAction.mockResolvedValue({
			success: true,
			data: {
				timeZone: "Europe/Berlin",
				choices: [
					{
						id: project,
						name: "Potsdam rollout",
						customerName: null,
						status: "active",
						basis: "employee_assignment",
					},
				],
				selected: null,
			},
		});
		projectActions.saveItemProjectAction.mockResolvedValue({
			success: true,
			data: { status: "saved", version: 4 },
		});
		mount();
		await screen.findByRole("option", { name: "Potsdam rollout" });
		const select = screen.getByLabelText("Project") as HTMLSelectElement;
		expect(select.value).toBe("none");
		// Projects are offered for the date of the drive.
		expect(projectActions.getReportProjectChoicesAction).toHaveBeenCalledWith(
			expect.objectContaining({ from: "2026-09-15", to: "2026-09-15" }),
		);
		fireEvent.change(select, { target: { value: `project:${project}` } });
		await waitFor(() =>
			expect(projectActions.saveItemProjectAction).toHaveBeenCalledWith({
				reportId,
				itemId,
				expectedVersion: 3,
				choice: { mode: "project", projectId: project },
			}),
		);
	});
});
