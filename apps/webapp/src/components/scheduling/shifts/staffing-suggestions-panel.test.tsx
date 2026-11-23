/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StaffingSuggestion, StaffingWarning } from "@/lib/scheduling/staffing/types";
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
						expiresAt: "2026-10-15",
						certificateOnFile: false,
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
		expect(screen.queryByText("Certificate on file")).toBeNull();
	});

	it("tells that a skill certificate is on file for an expired required skill", () => {
		renderPanel([
			suggestion("Anna Berg", {
				warnings: [
					{
						type: "expiredRequiredSkill",
						skillId: "s",
						skillName: "Forklift licence",
						expiresAt: "2026-10-15",
						certificateOnFile: true,
					},
				],
			}),
		]);

		const warning = screen.getByText("Forklift licence expired on Oct 15, 2026").closest("li");
		expect(warning?.textContent).toContain("Certificate on file");
	});

	it("names the day of each apprentice release conflict, one line each", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const releaseConflict = (releaseDay: string): StaffingWarning => ({
			type: "compliance",
			findingType: "statutory",
			finding: {
				type: "statutory",
				employeeId: "id-Anna Berg",
				findingId: `bbig_release_day_shift:id-Anna Berg:proposed:night:${releaseDay}`,
				statutoryKind: "bbig_release_day_shift",
				domain: "apprenticeship",
				severity: "warning",
				subjectKey: "proposed:night",
				legalReference: "§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
				summary: { tier: "exceeded" },
				releaseDay,
				acknowledgementStatus: null,
				blocksPublication: false,
			},
		});

		renderPanel([
			suggestion("Anna Berg", {
				warnings: [releaseConflict("2027-03-01"), releaseConflict("2027-03-02")],
			}),
		]);

		const lines = screen.getAllByText(/^Apprentice release day/);
		expect(lines.map((line) => line.textContent)).toEqual([
			"Apprentice release day on Mar 1, 2027: school, block-release or exam day",
			"Apprentice release day on Mar 2, 2027: school, block-release or exam day",
		]);
		expect(consoleError.mock.calls.filter((args) => args.join(" ").includes("same key"))).toEqual(
			[],
		);
		consoleError.mockRestore();
	});

	describe("youth working-time maximums on several shifts past the cap (#1993)", () => {
		const youthMax = (
			statutoryKind: "jarbschg_daily_max" | "jarbschg_weekly_max",
			shift: string,
			day: string,
			used: number,
			limit: number,
		): StaffingWarning => ({
			type: "compliance",
			findingType: "statutory",
			finding: {
				type: "statutory",
				employeeId: "id-Anna Berg",
				findingId: `${statutoryKind}:id-Anna Berg:shift:${shift}`,
				statutoryKind,
				domain: "youth_protection",
				severity: "critical",
				subjectKey: `shift:${shift}`,
				legalReference: "§ 8 JArbSchG",
				summary: {
					used: { unit: "minutes", value: used },
					limit: { unit: "minutes", value: limit },
				},
				day,
				acknowledgementStatus: null,
				blocksPublication: true,
			},
		});

		it("shows one line per week for weekly-maximum findings of that week", () => {
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
			renderPanel([
				suggestion("Anna Berg", {
					warnings: [
						youthMax("jarbschg_weekly_max", "thu", "2027-03-04", 2_700, 2_400),
						youthMax("jarbschg_weekly_max", "fri", "2027-03-05", 2_700, 2_400),
						youthMax("jarbschg_weekly_max", "sat", "2027-03-06", 2_700, 2_400),
					],
				}),
			]);

			expect(screen.getAllByText(/^Under 18/).map((line) => line.textContent)).toEqual([
				"Under 18: 2700 min of work in the week of Mar 1, 2027 exceeds the 2400 min youth limit",
			]);
			expect(consoleError.mock.calls.filter((args) => args.join(" ").includes("same key"))).toEqual(
				[],
			);
			consoleError.mockRestore();
		});

		it("names the day of each daily-maximum finding, one line each", () => {
			renderPanel([
				suggestion("Anna Berg", {
					warnings: [
						youthMax("jarbschg_daily_max", "mon", "2027-03-01", 540, 480),
						youthMax("jarbschg_daily_max", "tue", "2027-03-02", 540, 480),
					],
				}),
			]);

			expect(screen.getAllByText(/^Under 18/).map((line) => line.textContent)).toEqual([
				"Under 18: 540 min of work on Mar 1, 2027 exceeds the 480 min youth limit",
				"Under 18: 540 min of work on Mar 2, 2027 exceeds the 480 min youth limit",
			]);
		});
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
