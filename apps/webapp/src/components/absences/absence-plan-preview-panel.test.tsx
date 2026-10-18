/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbsencePlanPreview } from "@/lib/absences/absence-plan-preview";
import { AbsencePlanPreviewPanel } from "./absence-plan-preview-panel";

vi.mock("next-intl", () => ({ useLocale: () => "en-GB" }));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-GB", timezone: "Europe/Berlin", timeFormat: "24h" }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) => {
			if (!fallback) return _key;
			return fallback.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`));
		},
	}),
}));

const riskyPreview: AbsencePlanPreview = {
	requestedAbsenceDays: 6,
	refusal: null,
	countsAgainstVacation: true,
	balances: [
		{
			year: 2026,
			chargedAbsenceDays: 6,
			futureYear: false,
			status: "available",
			remainingDays: 4,
			remainingAfterRequest: -2,
		},
	],
	evaluatedAt: "2026-10-18T08:30:00Z",
	workBalance: null,
	holidays: [
		{
			id: "holiday-1",
			name: "Spring Holiday",
			startDate: "2026-05-14",
			endDate: "2026-05-14",
		},
	],
	overlaps: [],
	affectedShifts: [],
	coverage: {
		risks: [
			{
				date: "2026-05-15",
				subareaId: "front-desk",
				subareaName: "Front desk",
				startTime: "09:00",
				endTime: "17:00",
				minimumStaffCount: 2,
				staffCountAfterAbsence: 1,
			},
		],
		hasConfiguredRulesForAffectedShifts: true,
	},
	approvalSignal: "risky",
	warnings: ["Request overlaps an existing pending absence."],
	reasons: [
		"Coverage rules are not configured for the affected scheduled work.",
		"Request follows the normal approval path.",
	],
};

const nonVacationPreview: AbsencePlanPreview = {
	...riskyPreview,
	countsAgainstVacation: false,
	balances: [],
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
	approvalSignal: "likely",
	warnings: [],
	reasons: ["Policy check passed without using vacation-specific copy."],
};

const affectedShiftPreview: AbsencePlanPreview = {
	...riskyPreview,
	affectedShifts: [
		{
			id: "shift-1",
			subareaId: "kitchen",
			date: "2026-05-16",
			startTime: "12:00",
			endTime: "18:00",
		},
	],
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
	approvalSignal: "likely",
	warnings: [],
	reasons: ["Request follows the normal approval path."],
};

const affectedShiftWithRiskPreview: AbsencePlanPreview = {
	...riskyPreview,
	affectedShifts: affectedShiftPreview.affectedShifts,
};

const affectedShiftWithoutRulesPreview: AbsencePlanPreview = {
	...affectedShiftPreview,
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: false },
	approvalSignal: "needs_review",
	reasons: ["Coverage rules are not configured for the affected scheduled work."],
};

describe("AbsencePlanPreviewPanel", () => {
	it("renders risky advisory preview with a warning", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(screen.getByRole("heading", { name: "Smart planner" })).toBeTruthy();
		expect(screen.getByText("Risky")).toBeTruthy();
		expect(screen.getByText("Request overlaps an existing pending absence.")).toBeTruthy();
	});

	it("shows vacation balance impact for the selected category", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(screen.getByText("Counts against vacation balance")).toBeTruthy();
	});

	it("shows non-vacation balance impact from structured balance data", () => {
		render(<AbsencePlanPreviewPanel preview={nonVacationPreview} />);

		expect(screen.getByText("Does not reduce vacation balance")).toBeTruthy();
		expect(screen.queryByText("Counts against vacation balance")).toBeNull();
	});

	it("renders compact coverage risk details by day and subarea", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(screen.getByText("2026-05-15 · Front desk")).toBeTruthy();
		expect(screen.getByText("09:00-17:00 · 1/2 staff after request")).toBeTruthy();
	});

	it("renders affected published shifts without coverage risk", () => {
		render(<AbsencePlanPreviewPanel preview={affectedShiftPreview} />);

		expect(screen.getByText("No published coverage risk")).toBeTruthy();
		expect(screen.getByText("2026-05-16 · kitchen")).toBeTruthy();
		expect(screen.getByText("12:00-18:00 affected shift")).toBeTruthy();
	});

	it("renders missing coverage rules for affected published shifts", () => {
		render(<AbsencePlanPreviewPanel preview={affectedShiftWithoutRulesPreview} />);

		expect(screen.getByText("No coverage rules configured for affected shifts")).toBeTruthy();
		expect(screen.queryByText("No published coverage risk")).toBeNull();
		expect(screen.getByText("2026-05-16 · kitchen")).toBeTruthy();
	});

	it("renders affected published shifts with coverage risk details", () => {
		render(<AbsencePlanPreviewPanel preview={affectedShiftWithRiskPreview} />);

		expect(screen.getByText("2026-05-15 · Front desk")).toBeTruthy();
		expect(screen.getByText("09:00-17:00 · 1/2 staff after request")).toBeTruthy();
		expect(screen.getByText("2026-05-16 · kitchen")).toBeTruthy();
		expect(screen.getByText("12:00-18:00 affected shift")).toBeTruthy();
	});

	it("renders all explainable approval reasons", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(
			screen.getByText("Coverage rules are not configured for the affected scheduled work."),
		).toBeTruthy();
		expect(screen.getByText("Request follows the normal approval path.")).toBeTruthy();
	});

	it("renders non-blocking unavailable copy for an error", () => {
		render(<AbsencePlanPreviewPanel error="Preview failed" />);

		expect(
			screen.getByText("Planning preview unavailable. You can still submit your request."),
		).toBeTruthy();
	});

	it("renders accessible loading copy", () => {
		const { container } = render(<AbsencePlanPreviewPanel isLoading />);

		expect(screen.getByText("Checking balance, holidays, and coverage…")).toBeTruthy();
		expect(container.querySelector("svg")?.className.baseVal).toContain("motion-safe:animate-spin");
	});

	it("renders nothing without preview, loading state, or error", () => {
		const { container } = render(<AbsencePlanPreviewPanel />);

		expect(container.firstChild).toBeNull();
	});

	it("shows a refusal for vacation that covers no working day", () => {
		render(
			<AbsencePlanPreviewPanel
				preview={{ ...nonVacationPreview, requestedAbsenceDays: 0, refusal: "no_working_days" }}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toBe("This range contains no working days.");
	});
});

describe("AbsencePlanPreviewPanel vacation balance by year (#1340)", () => {
	const acrossNewYear: AbsencePlanPreview = {
		...riskyPreview,
		requestedAbsenceDays: 3,
		balances: [
			{
				year: 2026,
				chargedAbsenceDays: 2,
				futureYear: false,
				status: "available",
				remainingDays: 5,
				remainingAfterRequest: 3,
			},
			{
				year: 2027,
				chargedAbsenceDays: 1,
				futureYear: true,
				status: "available",
				remainingDays: 0.5,
				remainingAfterRequest: -0.5,
			},
		],
	};

	function yearRow(year: number) {
		return screen.getByRole("listitem", { name: String(year) });
	}

	it("shows each year's charged days, recorded balance and estimate after the request", () => {
		render(<AbsencePlanPreviewPanel preview={acrossNewYear} />);

		expect(yearRow(2026).textContent).toContain("2 days charged");
		expect(yearRow(2026).textContent).toContain("Current recorded balance5 days");
		expect(yearRow(2026).textContent).toContain("Estimated after request3 days");
		expect(yearRow(2027).textContent).toContain("1 day charged");
		expect(yearRow(2027).textContent).toContain("Estimated after request-0.5 days");
	});

	it("warns about a year the request exceeds, noting uncounted future carryover and accrual", () => {
		render(<AbsencePlanPreviewPanel preview={acrossNewYear} />);

		expect(yearRow(2027).textContent).toContain(
			"This request exceeds your recorded balance for 2027.",
		);
		expect(yearRow(2027).textContent).toContain(
			"Carryover and accrual for 2027 are not counted yet.",
		);
		expect(yearRow(2026).textContent).not.toContain("exceeds");
	});

	it("names when the balances were read and that they are estimates", () => {
		render(<AbsencePlanPreviewPanel preview={acrossNewYear} />);

		const balance = screen.getByRole("region", { name: "Balance" });
		expect(balance.textContent).toContain("Recorded balances as of 18 Oct 2026, 10:30");
		expect(balance.textContent).toContain("Estimates, not guaranteed future balances.");
	});

	it("shows a year without balance evidence as unavailable, never as zero", () => {
		render(
			<AbsencePlanPreviewPanel
				preview={{
					...acrossNewYear,
					balances: [
						acrossNewYear.balances[0],
						{
							year: 2027,
							chargedAbsenceDays: 1,
							futureYear: true,
							status: "unavailable",
							reason: "missing_policy",
						},
					],
				}}
			/>,
		);

		expect(yearRow(2026).textContent).toContain("Estimated after request3 days");
		expect(yearRow(2027).textContent).toContain(
			"Balance unavailable: no vacation policy covers 2027 yet. You can still submit.",
		);
		expect(yearRow(2027).textContent).not.toContain("0 days");
	});

	it("explains a conflicting policy and a failed read", () => {
		render(
			<AbsencePlanPreviewPanel
				preview={{
					...acrossNewYear,
					balances: [
						{
							year: 2026,
							chargedAbsenceDays: 2,
							futureYear: false,
							status: "unavailable",
							reason: "conflicting_policy",
						},
						{
							year: 2027,
							chargedAbsenceDays: 1,
							futureYear: true,
							status: "unavailable",
							reason: "read_failed",
						},
					],
				}}
			/>,
		);

		expect(yearRow(2026).textContent).toContain(
			"Balance unavailable: conflicting vacation policies for 2026 need review. You can still submit.",
		);
		expect(yearRow(2027).textContent).toContain(
			"Balance unavailable: the 2027 balance could not be read. You can still submit.",
		);
	});
});

describe("AbsencePlanPreviewPanel for time off in lieu", () => {
	it("shows the projected work balance and warns when it would be negative", () => {
		render(
			<AbsencePlanPreviewPanel
				preview={{
					...nonVacationPreview,
					workBalance: {
						currentBalanceMinutes: 240,
						drawnMinutes: 480,
						projectedBalanceMinutes: -240,
						wouldBeNegative: true,
					},
				}}
			/>,
		);

		const section = screen.getByRole("region", { name: "Work balance" });
		expect(section.textContent).toContain("+4:00h");
		expect(section.textContent).toContain("-8:00h");
		expect(section.textContent).toContain("-4:00h");
		expect(section.textContent).toContain(
			"Your work balance would be negative after this request.",
		);
	});
});
