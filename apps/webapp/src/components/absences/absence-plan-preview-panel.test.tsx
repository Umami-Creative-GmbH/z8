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
	requestedDays: 6,
	balance: {
		year: 2026,
		remainingDays: 4,
		remainingAfterRequest: -2,
	},
	holidays: [
		{
			id: "holiday-1",
			name: "Spring Holiday",
			startDate: "2026-05-14",
			endDate: "2026-05-14",
		},
	],
	overlaps: [],
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
	warnings: ["Vacation balance would be negative after this request."],
	reasons: ["Request follows the normal approval path."],
};

describe("AbsencePlanPreviewPanel", () => {
	it("renders risky advisory preview with a warning", () => {
		render(<AbsencePlanPreviewPanel preview={riskyPreview} />);

		expect(screen.getByRole("heading", { name: "Smart planner" })).toBeTruthy();
		expect(screen.getByText("Risky")).toBeTruthy();
		expect(screen.getByText("Vacation balance would be negative after this request.")).toBeTruthy();
	});

	it("renders non-blocking unavailable copy for an error", () => {
		render(<AbsencePlanPreviewPanel error="Preview failed" />);

		expect(
			screen.getByText("Planning preview unavailable. You can still submit your request."),
		).toBeTruthy();
	});

	it("renders accessible loading copy", () => {
		render(<AbsencePlanPreviewPanel isLoading />);

		expect(screen.getByText("Checking balance, holidays, and coverage…")).toBeTruthy();
	});

	it("renders nothing without preview, loading state, or error", () => {
		const { container } = render(<AbsencePlanPreviewPanel />);

		expect(container.firstChild).toBeNull();
	});
});
