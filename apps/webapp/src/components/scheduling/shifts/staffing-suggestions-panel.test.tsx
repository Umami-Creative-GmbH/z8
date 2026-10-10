/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StaffingSuggestion } from "@/lib/scheduling/staffing/types";
import { StaffingSuggestionsPanel } from "./staffing-suggestions-panel";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

function suggestion(
	displayName: string,
	overrides: Partial<StaffingSuggestion> = {},
): StaffingSuggestion {
	return {
		employeeId: `id-${displayName}`,
		displayName,
		warnings: [],
		notes: [],
		reasons: [],
		requestedThisShift: false,
		remainingContractedMinutes: null,
		...overrides,
	};
}

function renderPanel(suggestions: StaffingSuggestion[] | undefined, onPick = vi.fn()) {
	render(
		<StaffingSuggestionsPanel
			suggestions={suggestions}
			isLoading={false}
			isError={false}
			organizationTimezone="Europe/Berlin"
			onPick={onPick}
		/>,
	);
	return onPick;
}

describe("StaffingSuggestionsPanel", () => {
	it("shows the top five and the rest behind Show all", () => {
		renderPanel(["A", "B", "C", "D", "E", "F", "G"].map((name) => suggestion(name)));

		expect(screen.getAllByRole("button", { name: /^Assign / })).toHaveLength(5);
		expect(screen.queryByText("F")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Show all (7)" }));

		expect(screen.getAllByRole("button", { name: /^Assign / })).toHaveLength(7);
		expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
	});

	it("shows reasons, warnings, notes and the pickup marker without a score", () => {
		renderPanel([
			suggestion("Anna Berg", {
				requestedThisShift: true,
				remainingContractedMinutes: 480,
				reasons: [
					{ type: "skillsHeld", skillNames: ["Forklift"] },
					{ type: "plannedHours", plannedMinutes: 1920, targetMinutes: 2400 },
					{ type: "restPeriodOk" },
					{ type: "requestedThisShift" },
				],
				warnings: [
					{
						type: "expiredRequiredSkill",
						skillId: "s",
						skillName: "First aid",
						expiresAt: "2026-10-15T00:00:00Z",
					},
					{
						type: "compliance",
						findingType: "overtime",
						finding: {
							type: "overtime",
							employeeId: "id-Anna Berg",
							period: "weekly",
							periodKey: "2026-10-05",
							totalMinutes: 2520,
							thresholdMinutes: 2400,
						},
					},
					{
						type: "pendingAbsence",
						categoryName: "Vacation",
						startDate: "2026-10-09",
						endDate: "2026-10-09",
					},
				],
				notes: [{ type: "missingPreferredSkill", skillId: "p", skillName: "French" }],
			}),
		]);

		expect(screen.getByText("Requested this shift")).toBeTruthy();
		expect(
			screen.getByText("Has Forklift · 32 of 40 h planned this week · Rest period OK"),
		).toBeTruthy();
		expect(screen.getByText("First aid expired on Oct 15, 2026")).toBeTruthy();
		expect(screen.getByText(/overtime \(42 of 40 h\)/)).toBeTruthy();
		expect(screen.getByText("Pending absence: Vacation")).toBeTruthy();
		expect(screen.getByText("Lacks preferred skill: French")).toBeTruthy();
		expect(screen.queryByText(/480/)).toBeNull();
	});

	it("passes the picked employee on", () => {
		const onPick = renderPanel([suggestion("Anna Berg")]);

		fireEvent.click(screen.getByRole("button", { name: "Assign Anna Berg" }));

		expect(onPick).toHaveBeenCalledWith("id-Anna Berg");
	});

	it("says when no one is available", () => {
		renderPanel([]);

		expect(screen.getByText("No available employees for this shift")).toBeTruthy();
	});
});
