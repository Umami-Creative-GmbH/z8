/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbsencePlanPreview } from "@/lib/absences/absence-plan-preview";
import { AbsencePlanPreviewPanel } from "./absence-plan-preview-panel";

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
	balance: {
		year: 2026,
		remainingDays: 4,
		remainingAfterRequest: -2,
		countsAgainstVacation: true,
	},
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
		status: "complete",
		gaps: [],
	},
	warnings: ["Vacation balance would be negative after this request."],
	reasons: ["Vacation balance is unavailable for this year.", "This absence type needs approval."],
};

const nonVacationPreview: AbsencePlanPreview = {
	...riskyPreview,
	balance: {
		year: 2026,
		remainingDays: 4,
		remainingAfterRequest: 4,
		countsAgainstVacation: false,
	},
	coverage: { risks: [], status: "complete", gaps: [] },
	warnings: [],
	reasons: ["Policy check passed without using vacation-specific copy."],
};

const affectedShiftPreview: AbsencePlanPreview = {
	...riskyPreview,
	affectedShifts: [
		{
			id: "shift-1",
			subareaId: "kitchen-id",
			subareaName: "Kitchen",
			date: "2026-05-16",
			startTime: "12:00",
			endTime: "18:00",
			affectedStartTime: "12:00",
			affectedEndTime: "18:00",
		},
	],
	coverage: { risks: [], status: "complete", gaps: [] },
	warnings: [],
	reasons: ["Request follows the normal approval path."],
};

const affectedShiftWithRiskPreview: AbsencePlanPreview = {
	...riskyPreview,
	affectedShifts: affectedShiftPreview.affectedShifts,
};

const affectedShiftWithoutRulesPreview: AbsencePlanPreview = {
	...affectedShiftPreview,
	coverage: { risks: [], status: "incomplete", gaps: ["rules_missing", "rules_partial"] },
};

const partialOvernightShiftPreview: AbsencePlanPreview = {
	...affectedShiftPreview,
	affectedShifts: [
		{
			id: "shift-night",
			subareaId: "kitchen-id",
			subareaName: null,
			date: "2026-05-15",
			startTime: "22:00",
			endTime: "06:00",
			affectedStartTime: "00:00",
			affectedEndTime: "02:00",
		},
	],
};

const unreadableCoveragePreview: AbsencePlanPreview = {
	...nonVacationPreview,
	coverage: { risks: [], status: "incomplete", gaps: ["read_failed"] },
};

describe("AbsencePlanPreviewPanel", () => {
	it("renders an advisory preview with a warning and no approval prediction", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(screen.getByRole("heading", { name: "Smart planner" })).toBeTruthy();
		expect(screen.getByText("Vacation balance would be negative after this request.")).toBeTruthy();
		for (const prediction of ["Risky", "Likely", "Needs review"]) {
			expect(screen.queryByText(prediction)).toBeNull();
		}
		expect(screen.getByText(/It does not predict approval\./)).toBeTruthy();
	});

	it("explains the published-schedule limits of coverage evidence", () => {
		render(<AbsencePlanPreviewPanel preview={nonVacationPreview} />);

		const coverage = screen.getByRole("region", { name: "Coverage" });
		expect(coverage.textContent).toContain(
			"Based on published shifts and configured coverage rules. Colleagues' absences and unpublished schedule changes are not considered, so no warning does not guarantee staffing or approval.",
		);
	});

	it("says when none of the requester's published shifts overlap the absence", () => {
		render(<AbsencePlanPreviewPanel preview={nonVacationPreview} />);

		expect(screen.getByText("None of your published shifts overlap this absence.")).toBeTruthy();
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

		expect(screen.getByText("No coverage warnings in the published schedule.")).toBeTruthy();
		expect(screen.getByText("2026-05-16 · Kitchen")).toBeTruthy();
		expect(screen.getByText("12:00-18:00 · whole shift affected")).toBeTruthy();
		expect(screen.queryByText(/kitchen-id/)).toBeNull();
	});

	it("shows the affected part of an overnight shift", () => {
		render(<AbsencePlanPreviewPanel preview={partialOvernightShiftPreview} />);

		expect(screen.getByText("2026-05-15 · Unknown subarea")).toBeTruthy();
		expect(screen.getByText("22:00-06:00 (ends next day) · away 00:00-02:00")).toBeTruthy();
	});

	it("keeps missing and partial coverage rules visibly incomplete", () => {
		render(<AbsencePlanPreviewPanel preview={affectedShiftWithoutRulesPreview} />);

		expect(
			screen.getByText(
				"Coverage evidence is incomplete, so missing warnings don't mean staffing is adequate.",
			),
		).toBeTruthy();
		expect(screen.getByText("No coverage rules apply to some of your affected work.")).toBeTruthy();
		expect(
			screen.getByText("Coverage rules apply to only part of your affected work."),
		).toBeTruthy();
		expect(screen.queryByText("No coverage warnings in the published schedule.")).toBeNull();
		expect(screen.getByText("2026-05-16 · Kitchen")).toBeTruthy();
	});

	it("shows unreadable coverage evidence instead of an all-clear", () => {
		render(<AbsencePlanPreviewPanel preview={unreadableCoveragePreview} />);

		expect(screen.getByText("Published shifts or coverage rules could not be read.")).toBeTruthy();
		expect(screen.queryByText("None of your published shifts overlap this absence.")).toBeNull();
	});

	it("keeps known coverage warnings alongside incomplete evidence", () => {
		render(
			<AbsencePlanPreviewPanel
				preview={{
					...riskyPreview,
					coverage: { ...riskyPreview.coverage, status: "incomplete", gaps: ["unsupported"] },
				}}
			/>,
		);

		expect(screen.getByText("09:00-17:00 · 1/2 staff after request")).toBeTruthy();
		expect(screen.getByText("Some request or schedule times could not be evaluated.")).toBeTruthy();
	});

	it("renders affected published shifts with coverage risk details", () => {
		render(<AbsencePlanPreviewPanel preview={affectedShiftWithRiskPreview} />);

		expect(screen.getByText("2026-05-15 · Front desk")).toBeTruthy();
		expect(screen.getByText("09:00-17:00 · 1/2 staff after request")).toBeTruthy();
		expect(screen.getByText("2026-05-16 · Kitchen")).toBeTruthy();
		expect(screen.getByText("12:00-18:00 · whole shift affected")).toBeTruthy();
	});

	it("renders all explainable approval reasons", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(screen.getByText("Vacation balance is unavailable for this year.")).toBeTruthy();
		expect(screen.getByText("This absence type needs approval.")).toBeTruthy();
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
