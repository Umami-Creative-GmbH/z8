// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { PayrollWorkspace } from "./payroll-workspace";

const actionMocks = vi.hoisted(() => ({
	dismissPayrollBlockerAction: vi.fn(),
	exportPayrollPdfAction: vi.fn(),
	getPayrollWorkspaceSummaryAction: vi.fn(),
	startScopedPayrollExportAction: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

let translateOverrides: Record<string, string> = {};
let activeLocale = "en";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, string | number>) => {
			const template = translateOverrides[key] ?? fallback;

			return Object.entries(params ?? {}).reduce(
				(message, [paramKey, value]) => message.replaceAll(`{${paramKey}}`, String(value)),
				template,
			);
		},
	}),
}));
vi.mock("next-intl", () => ({
	useLocale: () => activeLocale,
}));
vi.mock("sonner", () => ({ toast: toastMocks }));
vi.mock("@/app/[locale]/(app)/payroll/actions", () => ({
	dismissPayrollBlockerAction: actionMocks.dismissPayrollBlockerAction,
	exportPayrollPdfAction: actionMocks.exportPayrollPdfAction,
	getPayrollWorkspaceSummaryAction: actionMocks.getPayrollWorkspaceSummaryAction,
	startScopedPayrollExportAction: actionMocks.startScopedPayrollExportAction,
}));

const baseSummary: PayrollWorkspaceSummary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: "2026-06-30T12:00:00.000Z",
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 2 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 8,
			absenceDaysByCategory: [],
			hasBlockers: true,
		},
		{
			id: "employee-2",
			name: "Grace Hopper",
			employeeNumber: "E-2",
			teamName: "Engineering",
			contractType: "fixed",
			workedHours: 0,
			absenceDaysByCategory: [],
			hasBlockers: false,
		},
	],
	absenceDetails: [],
	blockers: [
		{
			id: "blocker-1",
			employeeId: "employee-1",
			type: "missing_clock_out",
			label: "Missing clock-out",
			date: "2026-06-03",
			time: "09:00",
		},
		{
			id: "blocker-2",
			employeeId: "employee-1",
			type: "pending_absence",
			label: "Pending absence approval",
			date: "2026-06-04",
			time: null,
		},
	],
};

function buildSummary(overrides: Partial<PayrollWorkspaceSummary> = {}): PayrollWorkspaceSummary {
	return {
		...baseSummary,
		...overrides,
		period: overrides.period ?? baseSummary.period,
		totals: overrides.totals ?? baseSummary.totals,
		employees: overrides.employees ?? baseSummary.employees,
		absenceDetails: overrides.absenceDetails ?? baseSummary.absenceDetails,
		blockers: overrides.blockers ?? baseSummary.blockers,
	};
}

const summary = buildSummary();

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, reject, resolve };
}

describe("PayrollWorkspace", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		translateOverrides = {};
		activeLocale = "en";
		actionMocks.dismissPayrollBlockerAction.mockResolvedValue({
			success: true,
			data: { dismissed: true },
		});
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValue({
			success: true,
			data: summary,
		});
	});

	it("renders payroll workspace labels through Tolgee translations", () => {
		translateOverrides = {
			"payroll.title": "Translated payroll",
			"payroll.description": "Translated payroll description",
			"payroll.period.selected": "Translated selected period",
			"payroll.actions.downloadPdf": "Translated download PDF",
			"payroll.actions.triggerExport": "Translated trigger export",
		};

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		expect(screen.getByText("Translated payroll")).toBeTruthy();
		expect(screen.getByText("Translated payroll description")).toBeTruthy();
		expect(screen.getByText("Translated selected period")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Translated download PDF" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Translated trigger export" })).toBeTruthy();
	});

	it("renders summary cards, employee rows, period controls, and blockers", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		expect(screen.getByText("Payroll")).toBeTruthy();
		expect(
			screen.getByText("Review payroll totals, readiness, and exports for the selected period."),
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "June 2026" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Previous period" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Next period" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Current period" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Month" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Week" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
		expect(screen.getByLabelText("Start")).toBeTruthy();
		expect(screen.getByLabelText("End")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
		expect(screen.getByText("Employees")).toBeTruthy();
		expect(screen.getByText("Worked hours")).toBeTruthy();
		expect(screen.getByText("8.00 h")).toBeTruthy();
		expect(screen.getByText("Ready")).toBeTruthy();
		const readySummaryCard = screen.getByText("Ready").closest('[data-slot="card"]');
		expect(readySummaryCard).toBeTruthy();
		expect(within(readySummaryCard as HTMLElement).getByText("1")).toBeTruthy();
		expect(screen.getByText("Blockers")).toBeTruthy();
		expect(screen.getAllByText("Selected period")).toHaveLength(1);
		expect(screen.getByText("Payroll scope")).toBeTruthy();
		expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Specific teams" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Specific employees" })).toBeTruthy();
		expect(screen.queryByLabelText("Ada Lovelace")).toBeNull();
		expect(screen.queryByLabelText("Grace Hopper")).toBeNull();
		expect(screen.queryByLabelText("Ops")).toBeNull();
		expect(screen.queryByLabelText("Engineering")).toBeNull();
		expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("Missing clock-out")).toBeTruthy();
		expect(screen.getByText("Download PDF")).toBeTruthy();
		expect(screen.getByText("Trigger export")).toBeTruthy();
	});

	it("renders blocker exceptions with employee context and authorized workflow links", () => {
		activeLocale = "de-DE";
		translateOverrides = {
			"payroll.blockers.missingClockOut": "Fehlende Ausstempelung",
			"payroll.blockers.needReview": "{count} Lohnblocker prüfen",
			"payroll.blockers.openApprovals": "Genehmigungen öffnen",
			"payroll.blockers.openCalendar": "Kalender öffnen",
			"payroll.blockers.pendingAbsence": "Ausstehende Abwesenheit",
			"payroll.blockers.pendingTimeCorrection": "Ausstehende Zeitkorrektur",
		};
		const blockersSummary = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 4 },
			blockers: [
				{
					id: "missing-ada",
					employeeId: "employee-1",
					type: "missing_clock_out",
					label: "Backend label must not be displayed",
					date: "2026-06-03",
					time: "09:00",
				},
				{
					id: "missing-grace",
					employeeId: "employee-2",
					type: "missing_clock_out",
					label: "Another backend label",
					date: "2026-06-05",
					time: "17:30",
				},
				{
					id: "correction-ada",
					employeeId: "employee-1",
					type: "pending_time_correction",
					label: "Correction backend label",
					date: "2026-06-07",
					time: "14:15",
				},
				{
					id: "absence-grace",
					employeeId: "employee-2",
					type: "pending_absence",
					label: "Absence backend label",
					date: "2026-06-08",
					time: null,
				},
			],
		});

		render(
			<PayrollWorkspace
				initialSummary={blockersSummary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const blockersRegion = screen.getByRole("region", {
			name: "4 Lohnblocker prüfen",
		});
		expect(screen.queryByRole("alert")).toBeNull();

		const adaMissingRow = blockersRegion.querySelector(
			'[data-payroll-blocker-id="missing-ada"]',
		);
		expect(adaMissingRow).toBeTruthy();
		expect(adaMissingRow?.className).toContain(
			"lg:grid-cols-[minmax(0,1fr)_auto]",
		);
		expect(adaMissingRow?.className).not.toContain("sm:grid-cols");
		expect(
			within(adaMissingRow as HTMLElement).getByText("Ada Lovelace"),
		).toBeTruthy();
		expect(
			within(adaMissingRow as HTMLElement).getByText("Fehlende Ausstempelung"),
		).toBeTruthy();
		expect(
			within(adaMissingRow as HTMLElement).getByText("03.06.2026, 09:00"),
		).toBeTruthy();
		expect(
			within(adaMissingRow as HTMLElement)
				.getByRole("link", {
					name: /Kalender öffnen.*Ada Lovelace.*Fehlende Ausstempelung.*03.06.2026, 09:00/,
				})
				.getAttribute("href"),
		).toBe("/calendar/employee-1?date=2026-06-03");

		const graceMissingRow = blockersRegion.querySelector(
			'[data-payroll-blocker-id="missing-grace"]',
		);
		expect(graceMissingRow).toBeTruthy();
		expect(
			within(graceMissingRow as HTMLElement).getByText("Grace Hopper"),
		).toBeTruthy();
		expect(
			within(graceMissingRow as HTMLElement).getByText(
				"Fehlende Ausstempelung",
			),
		).toBeTruthy();
		expect(
			within(graceMissingRow as HTMLElement).getByText("05.06.2026, 17:30"),
		).toBeTruthy();
		expect(
			within(graceMissingRow as HTMLElement)
				.getByRole("link", {
					name: /Kalender öffnen.*Grace Hopper.*05.06.2026, 17:30/,
				})
				.getAttribute("href"),
		).toBe("/calendar/employee-2?date=2026-06-05");

		const correctionRow = blockersRegion.querySelector(
			'[data-payroll-blocker-id="correction-ada"]',
		);
		expect(correctionRow).toBeTruthy();
		expect(
			within(correctionRow as HTMLElement).getByText("Ada Lovelace"),
		).toBeTruthy();
		expect(
			within(correctionRow as HTMLElement).getByText(
				"Ausstehende Zeitkorrektur",
			),
		).toBeTruthy();
		expect(
			within(correctionRow as HTMLElement).getByText("07.06.2026, 14:15"),
		).toBeTruthy();
		expect(
			within(correctionRow as HTMLElement)
				.getByRole("link", {
					name: /Genehmigungen öffnen.*Ada Lovelace.*07.06.2026, 14:15/,
				})
				.getAttribute("href"),
		).toBe("/approvals/inbox?types=time_entry");

		const absenceRow = blockersRegion.querySelector(
			'[data-payroll-blocker-id="absence-grace"]',
		);
		expect(absenceRow).toBeTruthy();
		expect(
			within(absenceRow as HTMLElement).getByText("Grace Hopper"),
		).toBeTruthy();
		expect(
			within(absenceRow as HTMLElement).getByText("Ausstehende Abwesenheit"),
		).toBeTruthy();
		expect(
			within(absenceRow as HTMLElement).getByText("08.06.2026"),
		).toBeTruthy();
		expect(
			within(absenceRow as HTMLElement)
				.getByRole("link", {
					name: /Genehmigungen öffnen.*Grace Hopper.*08.06.2026/,
				})
				.getAttribute("href"),
		).toBe("/approvals/inbox?types=absence_entry");

		expect(
			within(blockersRegion).queryByText("Backend label must not be displayed"),
		).toBeNull();
		expect(
			within(blockersRegion).queryByText("Another backend label"),
		).toBeNull();
		expect(
			within(blockersRegion).queryByText("Correction backend label"),
		).toBeNull();
		expect(
			within(blockersRegion).queryByText("Absence backend label"),
		).toBeNull();
	});

	it("renders a distinguishable clear control beside every blocker workflow link", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const missingRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const absenceRow = document.querySelector('[data-payroll-blocker-id="blocker-2"]');
		expect(missingRow).toBeTruthy();
		expect(absenceRow).toBeTruthy();
		expect(
			within(missingRow as HTMLElement).getByRole("link", { name: /Open calendar/ }),
		).toBeTruthy();
		expect(
			within(missingRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		).toBeTruthy();
		expect(
			within(absenceRow as HTMLElement).getByRole("link", { name: /Open approvals/ }),
		).toBeTruthy();
		expect(
			within(absenceRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Pending absence/,
			}),
		).toBeTruthy();
	});

	it("sends only the clicked blocker and current period and filter request", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));
		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ada Lovelace" }));
		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));
		await waitFor(() => expect(screen.getByText("1 employees selected")).toBeTruthy());
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);

		await waitFor(() => {
			expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledWith({
				blockerId: "blocker-1",
				blockerType: "missing_clock_out",
				startDate: "2026-06-01",
				endDate: "2026-06-30",
				label: "June 2026",
				employeeIds: ["employee-1"],
			});
		});
		expect(Object.keys(actionMocks.dismissPayrollBlockerAction.mock.calls[0][0]).sort()).toEqual([
			"blockerId",
			"blockerType",
			"employeeIds",
			"endDate",
			"label",
			"startDate",
		]);
	});

	it("keeps pending state on only the clicked blocker and prevents a duplicate click", async () => {
		const dismissal = deferred<{ success: true; data: { dismissed: true } }>();
		actionMocks.dismissPayrollBlockerAction.mockReturnValueOnce(dismissal.promise);

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const missingRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const absenceRow = document.querySelector('[data-payroll-blocker-id="blocker-2"]');
		const clickedButton = within(missingRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		}) as HTMLButtonElement;
		fireEvent.click(clickedButton);

		await waitFor(() => {
			expect(
				within(missingRow as HTMLElement).getByRole("button", {
					name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			).toBeTruthy();
		});
		const pendingButton = within(missingRow as HTMLElement).getByRole("button", {
			name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
		}) as HTMLButtonElement;
		const otherButton = within(absenceRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Pending absence/,
		}) as HTMLButtonElement;
		expect(pendingButton.disabled).toBe(true);
		expect(otherButton.disabled).toBe(false);
		expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeTruthy();
		fireEvent.click(pendingButton);
		expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledTimes(1);

		dismissal.resolve({ success: true, data: { dismissed: true } });
		await waitFor(() => expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalled());
	});

	it("keeps concurrent rows pending independently and finishes with the last server refresh", async () => {
		const firstDismissal = deferred<{ success: true; data: { dismissed: true } }>();
		const secondDismissal = deferred<{ success: true; data: { dismissed: true } }>();
		const firstRefresh = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const secondRefresh = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const thirdBlocker = {
			id: "blocker-3",
			employeeId: "employee-2",
			type: "pending_time_correction" as const,
			label: "Pending time correction",
			date: "2026-06-05",
			time: "10:00",
		};
		const concurrentSummary = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 3 },
			blockers: [...baseSummary.blockers, thirdBlocker],
		});
		const afterFirstRefresh = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 2 },
			blockers: [baseSummary.blockers[1], thirdBlocker],
		});
		const finalSummary = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
			employees: baseSummary.employees.map((employee) => ({
				...employee,
				hasBlockers: employee.id === "employee-2",
			})),
			blockers: [thirdBlocker],
		});
		actionMocks.dismissPayrollBlockerAction.mockImplementation(
			(request: { blockerId: string }) =>
				request.blockerId === "blocker-1" ? firstDismissal.promise : secondDismissal.promise,
		);
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockReturnValueOnce(firstRefresh.promise)
			.mockReturnValueOnce(secondRefresh.promise);

		render(
			<PayrollWorkspace
				initialSummary={concurrentSummary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const firstRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const secondRow = document.querySelector('[data-payroll-blocker-id="blocker-2"]');
		const untouchedRow = document.querySelector('[data-payroll-blocker-id="blocker-3"]');
		fireEvent.click(
			within(firstRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		fireEvent.click(
			within(secondRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Pending absence/,
			}),
		);

		await waitFor(() => {
			expect(
				within(firstRow as HTMLElement).getByRole("button", {
					name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			).toBeTruthy();
			expect(
				within(secondRow as HTMLElement).getByRole("button", {
					name: /Clearing false positive.*Ada Lovelace.*Pending absence/,
				}),
			).toBeTruthy();
		});
		expect(
			(within(untouchedRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Grace Hopper.*Pending time correction/,
			}) as HTMLButtonElement).disabled,
		).toBe(false);
		expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledTimes(1);

		firstDismissal.resolve({ success: true, data: { dismissed: true } });
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);
		expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledTimes(1);
		firstRefresh.resolve({ success: true, data: afterFirstRefresh });

		await waitFor(() => {
			expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledTimes(2);
			expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeNull();
		});
		const stillPendingSecondRow = document.querySelector(
			'[data-payroll-blocker-id="blocker-2"]',
		);
		expect(
			within(stillPendingSecondRow as HTMLElement).getByRole("button", {
				name: /Clearing false positive.*Ada Lovelace.*Pending absence/,
			}),
		).toBeTruthy();
		expect(
			(within(
				document.querySelector('[data-payroll-blocker-id="blocker-3"]') as HTMLElement,
			).getByRole("button", {
				name: /Clear false positive.*Grace Hopper.*Pending time correction/,
			}) as HTMLButtonElement).disabled,
		).toBe(false);

		secondDismissal.resolve({ success: true, data: { dismissed: true } });
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(2),
		);
		secondRefresh.resolve({ success: true, data: finalSummary });

		await waitFor(() => {
			expect(document.querySelector('[data-payroll-blocker-id="blocker-2"]')).toBeNull();
		});
		const blockerSummaryCard = screen.getByText("Blockers").closest('[data-slot="card"]');
		expect(within(blockerSummaryCard as HTMLElement).getByText("1")).toBeTruthy();
		expect(document.querySelector('[data-payroll-blocker-id="blocker-3"]')).toBeTruthy();
	});

	it("refreshes from server truth with the same request after dismissal", async () => {
		const refreshedSummary = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 0 },
			employees: baseSummary.employees.map((employee) => ({ ...employee, hasBlockers: false })),
			blockers: [],
		});
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: refreshedSummary,
		});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith({
				startDate: "2026-06-01",
				endDate: "2026-06-30",
				label: "June 2026",
				employeeIds: undefined,
			});
		});
		await waitFor(() => {
			expect(screen.queryByRole("region", { name: /payroll blockers need review/ })).toBeNull();
		});
		const blockerSummaryCard = screen.getByText("Blockers").closest('[data-slot="card"]');
		expect(within(blockerSummaryCard as HTMLElement).getByText("0")).toBeTruthy();
		expect(screen.getAllByText("Ready for payroll")).toHaveLength(2);
	});

	it("refreshes the latest requested period after dismissal and ignores the older navigation response", async () => {
		const dismissal = deferred<{ success: true; data: { dismissed: true } }>();
		const navigation = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const dismissalRefresh = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const staleJulySummary = buildSummary({
			period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
		});
		const currentJulySummary = buildSummary({
			period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
			blockers: [baseSummary.blockers[1]],
		});
		actionMocks.dismissPayrollBlockerAction.mockReturnValueOnce(dismissal.promise);
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockReturnValueOnce(navigation.promise)
			.mockReturnValueOnce(dismissalRefresh.promise);

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Next period" }));
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);

		dismissal.resolve({ success: true, data: { dismissed: true } });
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(2),
		);
		expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledWith({
			blockerId: "blocker-1",
			blockerType: "missing_clock_out",
			startDate: "2026-06-01",
			endDate: "2026-06-30",
			label: "June 2026",
			employeeIds: undefined,
		});
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith({
			startDate: "2026-07-01",
			endDate: "2026-07-31",
			label: "July 2026",
			employeeIds: undefined,
		});

		dismissalRefresh.resolve({ success: true, data: currentJulySummary });
		await waitFor(() =>
			expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeNull(),
		);
		await act(async () => {
			navigation.resolve({ success: true, data: staleJulySummary });
			await navigation.promise;
		});
		expect(screen.getByRole("heading", { name: "July 2026" })).toBeTruthy();
		expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeNull();
	});

	it("does not let an older dismissal refresh overwrite navigation started afterward", async () => {
		const dismissalRefresh = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const navigation = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const juneAfterDismissal = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
			blockers: [baseSummary.blockers[1]],
		});
		const julySummary = buildSummary({
			period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 0 },
			blockers: [],
		});
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockReturnValueOnce(dismissalRefresh.promise)
			.mockReturnValueOnce(navigation.promise);

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);
		fireEvent.click(screen.getByRole("button", { name: "Next period" }));
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(2),
		);

		navigation.resolve({ success: true, data: julySummary });
		await waitFor(() => expect(screen.getByRole("heading", { name: "July 2026" })).toBeTruthy());
		await act(async () => {
			dismissalRefresh.resolve({ success: true, data: juneAfterDismissal });
			await dismissalRefresh.promise;
		});
		expect(screen.getByRole("heading", { name: "July 2026" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "June 2026" })).toBeNull();
	});

	it("applies only the latest ordinary period refresh when responses resolve out of order", async () => {
		const nextPeriod = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const previousPeriod = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		const julySummary = buildSummary({
			period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
		});
		const maySummary = buildSummary({
			period: { start: "2026-05-01", end: "2026-05-31", label: "May 2026" },
		});
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockReturnValueOnce(nextPeriod.promise)
			.mockReturnValueOnce(previousPeriod.promise);

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Next period" }));
			fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
		});
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(2);

		previousPeriod.resolve({ success: true, data: maySummary });
		await waitFor(() => expect(screen.getByRole("heading", { name: "May 2026" })).toBeTruthy());
		await act(async () => {
			nextPeriod.resolve({ success: true, data: julySummary });
			await nextPeriod.promise;
		});

		expect(screen.getByRole("heading", { name: "May 2026" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "July 2026" })).toBeNull();
	});

	it("suppresses in-flight dismissal effects and discards queued clears after unmount", async () => {
		const firstDismissal = deferred<{ success: true; data: { dismissed: true } }>();
		actionMocks.dismissPayrollBlockerAction.mockReturnValueOnce(firstDismissal.promise);
		const view = render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const firstRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const secondRow = document.querySelector('[data-payroll-blocker-id="blocker-2"]');
		fireEvent.click(
			within(firstRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		fireEvent.click(
			within(secondRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Pending absence/,
			}),
		);
		await waitFor(() => expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledTimes(1));

		view.unmount();
		await act(async () => {
			firstDismissal.resolve({ success: true, data: { dismissed: true } });
			await firstDismissal.promise;
		});

		expect(actionMocks.dismissPayrollBlockerAction).toHaveBeenCalledTimes(1);
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
		expect(toastMocks.error).not.toHaveBeenCalled();
	});

	it("suppresses refresh result effects after unmount", async () => {
		const refresh = deferred<{ success: false; error: string }>();
		actionMocks.getPayrollWorkspaceSummaryAction.mockReturnValueOnce(refresh.promise);
		const view = render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);

		view.unmount();
		await act(async () => {
			refresh.resolve({ success: false, error: "Do not show after unmount" });
			await refresh.promise;
		});

		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1);
		expect(toastMocks.error).not.toHaveBeenCalled();
	});

	it("focuses the next blocker clear control after successful removal", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
				blockers: [baseSummary.blockers[1]],
			}),
		});
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const firstRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const clearButton = within(firstRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		}) as HTMLButtonElement;
		clearButton.focus();
		fireEvent.click(clearButton);

		await waitFor(() => {
			const nextRow = document.querySelector('[data-payroll-blocker-id="blocker-2"]');
			expect(document.activeElement).toBe(
				within(nextRow as HTMLElement).getByRole("button", {
					name: /Clear false positive.*Ada Lovelace.*Pending absence/,
				}),
			);
		});
	});

	it("preserves focus moved elsewhere before a deferred removal completes", async () => {
		const refresh = deferred<{ success: true; data: PayrollWorkspaceSummary }>();
		actionMocks.getPayrollWorkspaceSummaryAction.mockReturnValueOnce(refresh.promise);
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const firstRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const clearButton = within(firstRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		}) as HTMLButtonElement;
		clearButton.focus();
		fireEvent.click(clearButton);
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);
		const chosenControl = screen.getByRole("button", { name: "Download PDF" });
		chosenControl.focus();
		expect(document.activeElement).toBe(chosenControl);

		await act(async () => {
			refresh.resolve({
				success: true,
				data: buildSummary({
					totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
					blockers: [baseSummary.blockers[1]],
				}),
			});
			await refresh.promise;
		});
		await waitFor(() =>
			expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeNull(),
		);
		expect(document.activeElement).toBe(chosenControl);
	});

	it("focuses the previous blocker clear control when the last row is removed", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
				blockers: [baseSummary.blockers[0]],
			}),
		});
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const secondRow = document.querySelector('[data-payroll-blocker-id="blocker-2"]');
		const clearButton = within(secondRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Pending absence/,
		}) as HTMLButtonElement;
		clearButton.focus();
		fireEvent.click(clearButton);

		await waitFor(() => {
			const previousRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
			expect(document.activeElement).toBe(
				within(previousRow as HTMLElement).getByRole("button", {
					name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			);
		});
	});

	it("focuses the visible blockers summary card when successful removal leaves no row", async () => {
		const singleBlockerSummary = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
			blockers: [baseSummary.blockers[0]],
		});
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 0 },
				blockers: [],
			}),
		});
		render(
			<PayrollWorkspace
				initialSummary={singleBlockerSummary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const clearButton = within(blockerRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		}) as HTMLButtonElement;
		clearButton.focus();
		fireEvent.click(clearButton);

		await waitFor(() => {
			const blockerSummaryCard = screen.getByText("Blockers").closest('[data-slot="card"]');
			expect(document.activeElement).toBe(blockerSummaryCard);
			expect(blockerSummaryCard?.getAttribute("tabindex")).toBe("-1");
			expect(blockerSummaryCard?.className).toContain("focus-visible:ring");
		});
		expect(screen.queryByRole("heading", { name: "0 payroll blockers need review" })).toBeNull();
	});

	it("keeps focus on the activated clear control when dismissal fails", async () => {
		const dismissal = deferred<{ success: false; error: string }>();
		actionMocks.dismissPayrollBlockerAction.mockReturnValueOnce(dismissal.promise);
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);
		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		const clearButton = within(blockerRow as HTMLElement).getByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		}) as HTMLButtonElement;
		clearButton.focus();
		fireEvent.click(clearButton);
		dismissal.resolve({ success: false, error: "Still blocked" });

		await waitFor(() => {
			expect(document.activeElement).toBe(
				within(blockerRow as HTMLElement).getByRole("button", {
					name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			);
		});
	});

	it("keeps the blocker and shows the safe dismissal error when clearing fails", async () => {
		const dismissal = deferred<{ success: false; error: string }>();
		actionMocks.dismissPayrollBlockerAction.mockReturnValueOnce(dismissal.promise);
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		expect(
			await within(blockerRow as HTMLElement).findByRole("button", {
				name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		).toBeTruthy();

		dismissal.resolve({
			success: false,
			error: "This blocker can no longer be cleared",
		});

		await waitFor(() =>
			expect(toastMocks.error).toHaveBeenCalledWith("This blocker can no longer be cleared"),
		);
		const resetButton = await within(blockerRow as HTMLElement).findByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		});
		expect((resetButton as HTMLButtonElement).disabled).toBe(false);
		expect(
			within(blockerRow as HTMLElement).queryByRole("button", {
				name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		).toBeNull();
		expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeTruthy();
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
	});

	it("keeps the blocker, clears pending state, and shows a localized error on dismissal rejection", async () => {
		const dismissal = deferred<never>();
		actionMocks.dismissPayrollBlockerAction.mockReturnValueOnce(dismissal.promise);
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
		fireEvent.click(
			within(blockerRow as HTMLElement).getByRole("button", {
				name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		);
		const pendingButton = await within(blockerRow as HTMLElement).findByRole("button", {
			name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
		});
		expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

		dismissal.reject(new Error("network detail"));

		await waitFor(() =>
			expect(toastMocks.error).toHaveBeenCalledWith("Could not clear payroll blocker"),
		);
		const resetButton = await within(blockerRow as HTMLElement).findByRole("button", {
			name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
		});
		expect((resetButton as HTMLButtonElement).disabled).toBe(false);
		expect(
			within(blockerRow as HTMLElement).queryByRole("button", {
				name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
			}),
		).toBeNull();
		expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeTruthy();
		const blockerSummaryCard = screen.getByText("Blockers").closest('[data-slot="card"]');
		expect(within(blockerSummaryCard as HTMLElement).getByText("2")).toBeTruthy();
	});

	it.each([
		["result failure", { success: false, error: "Unsafe refresh detail" }],
		["rejection", new Error("network detail")],
	])(
		"preserves the summary and uses the refresh-specific error after dismissal on %s",
		async (_case, refreshOutcome) => {
			const refresh = deferred<{ success: false; error: string }>();
			actionMocks.getPayrollWorkspaceSummaryAction.mockReturnValueOnce(refresh.promise);
			render(
				<PayrollWorkspace
					initialSummary={summary}
					exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
				/>,
			);

			const blockerRow = document.querySelector('[data-payroll-blocker-id="blocker-1"]');
			fireEvent.click(
				within(blockerRow as HTMLElement).getByRole("button", {
					name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			);
			expect(
				await within(blockerRow as HTMLElement).findByRole("button", {
					name: /Clearing false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			).toBeTruthy();
			await waitFor(() =>
				expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
			);

			if (refreshOutcome instanceof Error) {
				refresh.reject(refreshOutcome);
			} else {
				refresh.resolve(refreshOutcome);
			}

			await waitFor(() =>
				expect(toastMocks.error).toHaveBeenCalledWith(
					"Blocker cleared, but payroll could not be refreshed",
				),
			);
			expect(document.querySelector('[data-payroll-blocker-id="blocker-1"]')).toBeTruthy();
			expect(
				within(blockerRow as HTMLElement).getByRole("button", {
					name: /Clear false positive.*Ada Lovelace.*Missing clock-out/,
				}),
			).toBeTruthy();
		},
	);

	it("falls back for an unscoped employee and an invalid blocker date", () => {
		translateOverrides = {
			"payroll.blockers.dateUnavailable": "Datum nicht verfügbar",
			"payroll.blockers.missingClockOut": "Fehlende Ausstempelung",
			"payroll.blockers.openCalendar": "Kalender öffnen",
			"payroll.blockers.unknownEmployee": "Unbekannter Mitarbeiter",
		};
		const blockersSummary = buildSummary({
			totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 1 },
			blockers: [
				{
					id: "missing-unknown",
					employeeId: "employee-outside-scope",
					type: "missing_clock_out",
					label: "Backend label",
					date: "2026-02-30",
					time: null,
				},
			],
		});

		render(
			<PayrollWorkspace
				initialSummary={blockersSummary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const blockersRegion = screen.getByRole("region", {
			name: "1 payroll blockers need review",
		});
		const blockerRow = blockersRegion.querySelector(
			'[data-payroll-blocker-id="missing-unknown"]',
		);
		expect(blockerRow).toBeTruthy();
		expect(
			within(blockerRow as HTMLElement).getByText("Unbekannter Mitarbeiter"),
		).toBeTruthy();
		expect(
			within(blockerRow as HTMLElement).getByText("Fehlende Ausstempelung"),
		).toBeTruthy();
		expect(
			within(blockerRow as HTMLElement).getByText("Datum nicht verfügbar"),
		).toBeTruthy();
		expect(
			within(blockerRow as HTMLElement).queryByText("Backend label"),
		).toBeNull();
		expect(
			within(blockerRow as HTMLElement)
				.getByRole("link", {
					name: /Kalender öffnen.*Unbekannter Mitarbeiter.*Fehlende Ausstempelung.*Datum nicht verfügbar/,
				})
				.getAttribute("href"),
		).toBe("/calendar/employee-outside-scope");
	});

	it("hides an employee ID used as the blocker employee name", () => {
		const employeeId = "550e8400-e29b-41d4-a716-446655440000";
		translateOverrides = {
			"payroll.blockers.unknownEmployee": "Unbekannter Mitarbeiter",
		};
		const blockersSummary = buildSummary({
			employees: [
				{
					...baseSummary.employees[0],
					id: employeeId,
					name: employeeId,
				},
			],
			blockers: [
				{
					id: "uuid-name-blocker",
					employeeId,
					type: "missing_clock_out",
					label: "Backend label",
					date: "2026-06-09",
					time: "08:00",
				},
			],
		});

		render(
			<PayrollWorkspace
				initialSummary={blockersSummary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const blockersRegion = screen.getByRole("region", {
			name: "1 payroll blockers need review",
		});
		const blockerRow = blockersRegion.querySelector(
			'[data-payroll-blocker-id="uuid-name-blocker"]',
		);
		expect(blockerRow).toBeTruthy();
		expect(
			within(blockerRow as HTMLElement).getByText("Unbekannter Mitarbeiter"),
		).toBeTruthy();
		expect(blockerRow?.textContent).not.toContain(employeeId);
	});

	it("keeps payroll period controls on aligned grid rails", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		const periodCard = screen.getByText("Selected period").closest('[data-slot="card"]');
		expect(periodCard).toBeTruthy();

		const controlsRail = (periodCard as HTMLElement).querySelector(
			"[data-payroll-period-controls]",
		);
		expect(controlsRail).toBeTruthy();
		expect(controlsRail?.className).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(22rem,auto)]");

		const dateControls = (periodCard as HTMLElement).querySelector("[data-payroll-date-controls]");
		expect(dateControls).toBeTruthy();
		expect(dateControls?.className).toContain("lg:grid-cols-[auto_minmax(0,1fr)]");

		const exportControls = (periodCard as HTMLElement).querySelector(
			"[data-payroll-export-controls]",
		);
		expect(exportControls).toBeTruthy();
		expect(exportControls?.className).toContain("sm:grid-cols-[minmax(0,1fr)]");
	});

	it("disables export controls when no export formats are configured", () => {
		render(<PayrollWorkspace initialSummary={summary} exportFormats={[]} />);

		const exportLabel = screen.getByText("Payroll export target");
		const exportTarget = screen.getByLabelText("Payroll export target") as HTMLButtonElement;
		const triggerExportButton = screen.getByRole("button", {
			name: "Trigger export",
		}) as HTMLButtonElement;

		expect(exportLabel.getAttribute("for")).toBe("payroll-export-target");
		expect(exportTarget.id).toBe("payroll-export-target");
		expect(exportTarget.disabled).toBe(true);
		expect(triggerExportButton.disabled).toBe(true);
		expect(screen.getByText("No configured payroll export target")).toBeTruthy();
	});

	it("keeps payroll actions available at the default managed scope", () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Specific teams" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Specific employees" })).toBeTruthy();
		expect(screen.queryByLabelText("Ada Lovelace")).toBeNull();
		expect(screen.queryByLabelText("Engineering")).toBeNull();
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
		expect(
			(screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled,
		).toBe(false);
		expect(
			(screen.getByRole("button", { name: "Trigger export" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("opens scope sheets with visible checkbox labels", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

		expect(screen.getAllByText("Specific teams").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Choose teams to include in this payroll scope.")).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Ops" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Engineering" })).toBeTruthy();
		expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Specific teams" })).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

		expect(screen.getAllByText("Specific employees").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Choose employees to include in this payroll scope.")).toBeTruthy();
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Specific employees" })).toBeNull();
		});
	});

	it("applies team scope selections from the team sheet", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ops" }));
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();

		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1"] }),
			);
		});
		expect(screen.getByText("1 teams selected")).toBeTruthy();
	});

	it("applies multiple team scope selections at once", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ops" }));
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Engineering" }));

		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();

		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1", "employee-2"] }),
			);
		});
		expect(screen.getByText("2 teams selected")).toBeTruthy();
	});

	it("discards team draft selections when cancelled", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ops" }));
		fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
		expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
	});

	it("keeps the committed scope when applying a team filter fails", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: false,
			error: "Unable to refresh",
		});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ops" }));
		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1"] }),
			);
		});
		expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
		expect(screen.queryByText("1 teams selected")).toBeNull();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("opens employee scope selection without refreshing until apply", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

		const sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByRole("heading", { name: "Specific employees" })).toBeTruthy();
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ada Lovelace" }));

		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();

		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1"] }),
			);
		});
		expect(screen.getByText("1 employees selected")).toBeTruthy();
	});

	it("applies multiple employee draft selections at once", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ada Lovelace" }));
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Grace Hopper" }));

		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();

		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeIds: ["employee-1", "employee-2"] }),
			);
		});
	});

	it("discards employee draft selections when cancelled", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

		const sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ada Lovelace" }));
		fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
		expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
	});

	it("filters produce no matches when selected employees and teams do not overlap", async () => {
		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

		let sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Ada Lovelace" }));
		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(screen.getByText("1 employees selected")).toBeTruthy();
		});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

		sheet = await screen.findByRole("dialog");
		fireEvent.click(within(sheet).getByRole("checkbox", { name: "Engineering" }));
		fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(screen.getAllByText("No employees match the selected payroll filters.").length).toBeGreaterThan(
			0,
		);
		const employeeSummaryCard = screen.getByText("Employees").closest('[data-slot="card"]');
		expect(employeeSummaryCard).toBeTruthy();
		expect(within(employeeSummaryCard as HTMLElement).getByText("0")).toBeTruthy();
		expect(screen.queryByText("E-1")).toBeNull();
		expect((screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect((screen.getByRole("button", { name: "Trigger export" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("shows empty states when no teams or employees are assigned", async () => {
		const emptySummary = buildSummary({
			totals: { employeeCount: 0, totalWorkedHours: 0, blockerCount: 0 },
			employees: [],
			blockers: [],
		});

		render(<PayrollWorkspace initialSummary={emptySummary} exportFormats={[]} />);

		fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));
		let sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByText("No assigned teams in this payroll scope.")).toBeTruthy();
		fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));
		sheet = await screen.findByRole("dialog");
		expect(within(sheet).getByText("No assigned employees in this payroll scope.")).toBeTruthy();
		fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("moves to the previous month from the selected month", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-05-01", end: "2026-05-31", label: "May 2026" },
			}),
		});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({
					startDate: "2026-05-01",
					endDate: "2026-05-31",
					label: "May 2026",
				}),
			);
		});
	});

	it("moves to the next month from the selected month", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
			}),
		});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Next period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
				expect.objectContaining({
					startDate: "2026-07-01",
					endDate: "2026-07-31",
					label: "July 2026",
				}),
			);
		});
	});

	it("moves to the previous week from the selected week", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-06-01", end: "2026-06-07", label: "Jun 1 - Jun 7, 2026" },
				}),
			})
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-05-25", end: "2026-05-31", label: "May 25 - May 31, 2026" },
				}),
			});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		await waitFor(() =>
			expect(screen.getAllByText("Jun 1 - Jun 7, 2026").length).toBeGreaterThan(0),
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Previous period" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					startDate: "2026-05-25",
					endDate: "2026-05-31",
					label: "May 25 - May 31, 2026",
				}),
			);
		});
	});

	it("keeps month mode when switching to week fails", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockResolvedValueOnce({
				success: false,
				error: "Unable to load week",
			})
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-05-01", end: "2026-05-31", label: "May 2026" },
				}),
			});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		await waitFor(() =>
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1),
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Previous period" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					startDate: "2026-05-01",
					endDate: "2026-05-31",
					label: "May 2026",
				}),
			);
		});
	});

	it("moves to the next week from the selected week", async () => {
		actionMocks.getPayrollWorkspaceSummaryAction
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-06-01", end: "2026-06-07", label: "Jun 1 - Jun 7, 2026" },
				}),
			})
			.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-06-08", end: "2026-06-14", label: "Jun 8 - Jun 14, 2026" },
				}),
			});

		render(
			<PayrollWorkspace
				initialSummary={summary}
				exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		await waitFor(() =>
			expect(screen.getAllByText("Jun 1 - Jun 7, 2026").length).toBeGreaterThan(0),
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Next period" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Next period" }));

		await waitFor(() => {
			expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					startDate: "2026-06-08",
					endDate: "2026-06-14",
					label: "Jun 8 - Jun 14, 2026",
				}),
			);
		});
	});

	it("returns to the current month", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));

		try {
			actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
				success: true,
				data: buildSummary({
					period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
				}),
			});

			render(
				<PayrollWorkspace
					initialSummary={summary}
					exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Current period" }));

			await waitFor(() => {
				expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
					expect.objectContaining({
						startDate: "2026-08-01",
						endDate: "2026-08-31",
						label: "August 2026",
					}),
				);
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
