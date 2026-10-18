// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PayrollBaselinesCard } from "./payroll-baselines-card";

const actions = vi.hoisted(() => ({
	listPayrollBaselinesAction: vi.fn(),
	inspectPayrollBaselineAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/payroll/baseline-actions", () => actions);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

const summary = {
	id: "baseline-a",
	jobId: "historical-job",
	formatId: "datev_lohn" as const,
	destination: {
		configId: "old-config",
		mandantennummer: "12345",
		beraternummer: "67890",
	},
	period: { startDate: "2026-09-01", endDate: "2026-09-30" },
	employeeIds: ["historical-employee"],
	createdAt: "2026-09-30T10:00:00Z",
	completedAt: "2026-09-30T10:01:00Z",
	expiresAt: "2028-09-30T10:01:00Z",
	availability: "available" as const,
};

const evidenceMetadata = {
	version: 1,
	destination: summary.destination,
	period: summary.period,
	employeeIds: summary.employeeIds,
	fileDigest: "retained-file-digest",
	attemptId: "retained-attempt",
};
function renderBaselines() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<PayrollBaselinesCard startDate="2026-09-01" endDate="2026-09-30" />
		</QueryClientProvider>,
	);
}

describe("Payroll workspace baseline inspection", () => {
	it("selects the latest available DATEV baseline deterministically and exposes its retained metadata", async () => {
		actions.listPayrollBaselinesAction.mockResolvedValue({
			success: true,
			data: [
				{
					...summary,
					id: "legacy",
					completedAt: "2026-10-01T10:00:00Z",
					availability: "legacy",
				},
				{ ...summary, id: "baseline-z" },
				summary,
			],
		});
		actions.inspectPayrollBaselineAction.mockImplementation(
			async (id: string) => ({
				success: true,
				data: { summary: { ...summary, id }, evidence: null },
			}),
		);
		renderBaselines();
		const selector = await screen.findByRole("combobox", {
			name: "Baseline export",
		});
		expect((selector as HTMLSelectElement).value).toBe("baseline-z");
		await screen.findByText("baseline-z", { selector: "dd" });
		expect(actions.listPayrollBaselinesAction).toHaveBeenCalledWith({
			startDate: "2026-09-01",
			endDate: "2026-09-30",
		});
		expect(actions.inspectPayrollBaselineAction).toHaveBeenCalledWith(
			"baseline-z",
		);
		expect(
			screen.getByText(
				"Expense reimbursements are excluded. Only supported work, absence and overtime payout hours are shown.",
			),
		).toBeTruthy();
		expect(screen.getByText("12345 / 67890")).toBeTruthy();
		expect(screen.getByText("2026-09-30 10:01:00 UTC")).toBeTruthy();
		expect(screen.getByText("historical-employee")).toBeTruthy();
	});
});

it("shows exact exported quantities and retained mixed source contributions without live links", async () => {
	const evidence = {
		...evidenceMetadata,
		version: 1,
		destination: summary.destination,
		config: { includeZeroHours: false },
		filters: {
			dateRange: { start: "2026-09-01", end: "2026-09-30" },
			includeAbsences: true,
		},
		employeeWindows: [
			{
				employeeId: "historical-employee",
				timezone: "Europe/Berlin",
				startUtc: "2026-08-31T22:00:00Z",
				endExclusiveUtc: "2026-09-30T22:00:00Z",
			},
		],
		output: {
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [
				{
					personnelNumber: "OLD-42",
					wageTypeCode: "OLD-100",
					date: "2026-09-03",
					quantity: "10.33",
					unit: "hours",
					note: "Retained payroll note",
					contributions: [
						{
							kind: "work",
							sourceId: "deleted-work",
							sourceRevision: "revision-1",
							sourceActorId: "captured-actor",
							employeeId: "historical-employee",
							firstName: "Historical",
							lastName: "Person",
							hours: 1.333333,
							reason: "Original correction reason",
							facts: {
								startAt: "2026-09-03T05:00:00Z",
								endAt: "2026-09-03T06:20:00Z",
								durationMinutes: 80,
								workCategoryId: "cat-old",
								workCategoryName: "Old category",
								projectId: null,
								projectName: null,
								mappingId: "mapping-old",
							},
						},
						{
							kind: "absence",
							sourceId: "deleted-absence",
							sourceRevision: null,
							employeeId: "historical-employee",
							firstName: "Historical",
							lastName: "Person",
							hours: 8,
							reason: null,
							facts: {
								startDate: "2026-09-03",
								endDate: "2026-09-03",
								absenceCategoryId: "absence-old",
								absenceCategoryName: "Historical leave",
								absenceType: "vacation",
								status: "approved",
								mappingId: "absence-mapping-old",
							},
						},
						{
							kind: "overtime_payout",
							sourceId: "cancelled-payout",
							sourceRevision: null,
							employeeId: "historical-employee",
							firstName: "Historical",
							lastName: "Person",
							hours: 1,
							reason: null,
							facts: {
								day: "2026-09-03",
								minutes: 60,
								mappingId: "payout-mapping-old",
							},
						},
					],
				},
			],
		},
	};
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [summary],
	});
	actions.inspectPayrollBaselineAction.mockResolvedValue({
		success: true,
		data: { summary, evidence },
	});
	const { container } = renderBaselines();
	const row = (await screen.findByText("OLD-42")).closest("tr");
	if (!row) throw new Error("Exported row not found");
	expect(within(row).getByText("OLD-100")).toBeTruthy();
	expect(within(row).getByText("10.33")).toBeTruthy();
	expect(within(row).getByText("Retained payroll note")).toBeTruthy();
	fireEvent.click(within(row).getByText("Source contributions"));
	expect(await screen.findByText("deleted-work")).toBeTruthy();
	expect(screen.getByText("deleted-absence")).toBeTruthy();
	expect(screen.getByText("cancelled-payout")).toBeTruthy();
	expect(screen.getAllByText("Historical Person").length).toBe(3);
	expect(screen.getByText("revision-1")).toBeTruthy();
	expect(screen.getByText("captured-actor")).toBeTruthy();
	expect(screen.getByText("Original correction reason")).toBeTruthy();
	expect(screen.getAllByText("Reason unavailable").length).toBe(2);
	expect(screen.getByText("1.333333")).toBeTruthy();
	expect(screen.getByText("2026-08-31 22:00:00 UTC")).toBeTruthy();
	expect(screen.getByText("Europe/Berlin")).toBeTruthy();
	expect(container.querySelectorAll("a").length).toBe(0);
});

it.each([
	[
		"empty",
		"This is a valid empty baseline: the successful export contained no supported work, absence or overtime payout rows.",
	],
	[
		"legacy",
		"This export predates retained comparison evidence. Historical values cannot be reconstructed.",
	],
	[
		"expired",
		"The 24-month retention period has ended. Historical evidence is unavailable.",
	],
	[
		"erased",
		"Employee erasure made this baseline incomplete. Historical rows are unavailable.",
	],
	[
		"corrupt",
		"The retained evidence failed its integrity check. Historical rows are unavailable.",
	],
	[
		"unsupported_version",
		"This evidence version cannot be read. Historical rows are unavailable.",
	],
])(
	"explains the %s baseline state without presenting unavailable rows",
	async (availability, message) => {
		const stateSummary = { ...summary, availability };
		actions.listPayrollBaselinesAction.mockResolvedValue({
			success: true,
			data: [stateSummary],
		});
		actions.inspectPayrollBaselineAction.mockResolvedValue({
			success: true,
			data: {
				summary: stateSummary,
				evidence:
					availability === "empty"
						? {
								version: 1,
								destination: summary.destination,
								config: {},
								filters: {},
								employeeWindows: [],
								output: {
									version: 1,
									formatId: "datev_lohn",
									formatterVersion: "2024.1",
									excludedLineKinds: ["expense"],
									rows: [],
								},
							}
						: null,
			},
		});
		renderBaselines();
		expect(await screen.findByText(message)).toBeTruthy();
		expect(
			screen.queryByRole("table", { name: "Actual supported exported rows" }),
		).toBeNull();
	},
);

it("distinguishes no successful baselines from a valid empty export", async () => {
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [],
	});
	renderBaselines();
	expect(
		await screen.findByText(
			"No successful Payroll baseline exports are available for this period.",
		),
	).toBeTruthy();
	expect(screen.queryByRole("combobox")).toBeNull();
});

it("hides protected metadata when listing is denied", async () => {
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: false,
		error: "internal protected details",
	});
	renderBaselines();
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"Baseline exports could not be loaded.",
	);
	expect(screen.queryByText("internal protected details")).toBeNull();
	expect(screen.queryByRole("combobox")).toBeNull();
});

it("keeps a late detail response from replacing the operator's newer selection", async () => {
	let resolveFirst!: (value: unknown) => void;
	const firstDetail = new Promise((resolve) => {
		resolveFirst = resolve;
	});
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [
			summary,
			{ ...summary, id: "older", completedAt: "2026-09-29T10:00:00Z" },
		],
	});
	actions.inspectPayrollBaselineAction.mockImplementation((id: string) =>
		id === summary.id
			? firstDetail
			: Promise.resolve({
					success: true,
					data: { summary: { ...summary, id }, evidence: null },
				}),
	);
	renderBaselines();
	const selector = await screen.findByRole("combobox", {
		name: "Baseline export",
	});
	fireEvent.change(selector, { target: { value: "older" } });
	await screen.findByText("older", { selector: "dd" });
	resolveFirst({ success: true, data: { summary, evidence: null } });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(screen.queryByText("baseline-a", { selector: "dd" })).toBeNull();
	expect((selector as HTMLSelectElement).value).toBe("older");
});

it("lets an operator inspect every retained row without mounting an entire large export at once", async () => {
	const rows = Array.from({ length: 51 }, (_unused, index) => ({
		personnelNumber: `ROW-${index + 1}`,
		wageTypeCode: "100",
		date: "2026-09-03",
		quantity: "1.00",
		unit: "hours",
		note: "",
		contributions: [],
	}));
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [summary],
	});
	actions.inspectPayrollBaselineAction.mockResolvedValue({
		success: true,
		data: {
			summary,
			evidence: {
				...evidenceMetadata,
				version: 1,
				destination: summary.destination,
				config: {},
				filters: {},
				employeeWindows: [],
				output: {
					version: 1,
					formatId: "datev_lohn",
					formatterVersion: "2024.1",
					excludedLineKinds: ["expense"],
					rows,
				},
			},
		},
	});
	renderBaselines();
	await screen.findByText("ROW-1");
	expect(screen.getByText("ROW-50")).toBeTruthy();
	expect(screen.queryByText("ROW-51")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Next exported rows" }));
	expect(await screen.findByText("ROW-51")).toBeTruthy();
	expect(screen.queryByText("ROW-1")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Previous exported rows" }),
	);
	expect(await screen.findByText("ROW-1")).toBeTruthy();
});

it("retains the full employee scope and each explicit UTC window even for employees without exported rows", async () => {
	const completeSummary = {
		...summary,
		employeeIds: ["historical-employee", "no-output-employee"],
	};
	const evidence = {
		...evidenceMetadata,
		version: 1,
		employeeIds: completeSummary.employeeIds,
		destination: summary.destination,
		config: {},
		filters: {},
		employeeWindows: [
			{
				employeeId: "historical-employee",
				timezone: "Europe/Berlin",
				startUtc: "2026-08-31T22:00:00Z",
				endExclusiveUtc: "2026-09-30T22:00:00Z",
			},
			{
				employeeId: "no-output-employee",
				timezone: "America/New_York",
				startUtc: "2026-09-01T04:00:00Z",
				endExclusiveUtc: "2026-10-01T04:00:00Z",
			},
		],
		output: {
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [],
		},
	};
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [completeSummary],
	});
	actions.inspectPayrollBaselineAction.mockResolvedValue({
		success: true,
		data: { summary: completeSummary, evidence },
	});
	renderBaselines();
	await screen.findByText("Complete retained employee scope");
	expect(
		screen.getByText("no-output-employee", { selector: "li" }),
	).toBeTruthy();
	fireEvent.click(
		screen.getByText("Retained employee boundaries, filters and configuration"),
	);
	expect(screen.getByText("America/New_York")).toBeTruthy();
	expect(screen.getByText("2026-09-01 04:00:00 UTC")).toBeTruthy();
	expect(screen.getByText("2026-10-01 04:00:00 UTC")).toBeTruthy();
});

it("mounts retained sources only when requested and pages large contribution lists", async () => {
	const contributions = Array.from({ length: 51 }, (_, index) => ({
		kind: "overtime_payout",
		sourceId: `source-${index}`,
		sourceRevision: null,
		employeeId: "historical-employee",
		firstName: null,
		lastName: null,
		hours: 1,
		reason: null,
		facts: { day: "2026-09-03", minutes: 60, mappingId: null },
	}));
	actions.listPayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [summary],
	});
	actions.inspectPayrollBaselineAction.mockResolvedValue({
		success: true,
		data: {
			summary,
			evidence: {
				...evidenceMetadata,
				config: {},
				filters: {},
				employeeWindows: [],
				output: {
					version: 1,
					formatId: "datev_lohn",
					formatterVersion: "2024.1",
					excludedLineKinds: ["expense"],
					rows: [
						{
							personnelNumber: "BOUNDED",
							wageTypeCode: "100",
							date: "2026-09-03",
							quantity: "51.00",
							unit: "hours",
							note: "",
							contributions,
						},
					],
				},
			},
		},
	});
	renderBaselines();
	await screen.findByText("BOUNDED");
	expect(screen.queryByText("source-0")).toBeNull();
	fireEvent.click(
		screen.getByText("Source contributions", { selector: "summary" }),
	);
	expect(await screen.findByText("source-0")).toBeTruthy();
	expect(screen.queryByText("source-50")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Next source contributions" }),
	);
	expect(screen.getByText("source-50")).toBeTruthy();
	expect(screen.queryByText("source-0")).toBeNull();
});
