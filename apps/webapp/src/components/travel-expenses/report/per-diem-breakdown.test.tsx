/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerDiemDayBreakdown } from "@/lib/travel-expenses/per-diem";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { PerDiemBreakdown, type PerDiemBreakdownFacts } from "./per-diem-breakdown";

afterEach(cleanup);

const noMeal = { provided: false, employeePayment: null, deduction: "0.00" };

function day(date: string, overrides: Partial<PerDiemDayBreakdown> = {}): PerDiemDayBreakdown {
	return {
		date,
		dayType: "travel_day",
		absenceMinutes: 600,
		allowance: "partial",
		basis: "travel_day_with_overnight",
		rate: "14.00",
		versionId: "v1",
		meals: { breakfast: noMeal, lunch: noMeal, dinner: noMeal },
		mealsCountToward: null,
		deductions: "0.00",
		amount: "14.00",
		...overrides,
	} as PerDiemDayBreakdown;
}

const facts: PerDiemBreakdownFacts = {
	days: [
		day("2026-09-14"),
		day("2026-09-15", {
			absenceMinutes: 1440,
			basis: "absence_24h",
			rate: "28.00",
			meals: {
				breakfast: { provided: true, employeePayment: null, deduction: "5.60" },
				lunch: noMeal,
				dinner: noMeal,
			},
			mealsCountToward: "2026-09-15",
			deductions: "5.60",
			amount: "22.40",
		}),
	],
	currency: "EUR",
	amount: "36.40",
	rules: { reference: "§ 9 Abs. 4a EStG", version: "2026" },
	policies: [],
} as unknown as PerDiemBreakdownFacts;

describe("PerDiemBreakdown on narrow screens (#688)", () => {
	it("stacks one labelled card per day, with the total under the cards", () => {
		render(<PerDiemBreakdown facts={facts} />);
		const list = screen.getByRole("list", { name: "Per diem by calendar day" });
		expect(list.parentElement?.className).toContain("md:hidden");
		const cards = within(list).getAllByRole("listitem");
		expect(cards).toHaveLength(2);

		const second = cards[1] as HTMLElement;
		expect(within(second).getByRole("heading", { name: "Sep 15, 2026" })).toBeTruthy();
		expect(second.textContent).toContain("Full day away (24 hours)");
		expect(second.textContent).toContain("24:00 h away");
		const values = Object.fromEntries(
			within(second)
				.getAllByRole("term")
				.map((term) => [term.textContent, term.nextElementSibling?.textContent]),
		);
		expect(values).toEqual({
			Allowance: "€28.00",
			"Provided meals": "Breakfast: −€5.60",
			Amount: "€22.40",
		});
		expect(list.nextElementSibling?.textContent).toBe("Per diem€36.40");
	});

	it("keeps the table from md up", () => {
		render(<PerDiemBreakdown facts={facts} />);
		const table = screen.getByRole("table", { name: "Per diem by calendar day" });
		expect(table.parentElement?.className).toContain("hidden");
		expect(table.parentElement?.className).toContain("md:block");
		expect(within(table).getAllByRole("row")).toHaveLength(4);
	});
});
