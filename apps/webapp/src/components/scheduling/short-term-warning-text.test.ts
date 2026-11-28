import { describe, expect, it } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { statutoryWarningText } from "./statutory-warning-text";

/** Renders the English default with its parameters, like Tolgee without a catalog. */
const t = ((_key: string, fallback: string, params: Record<string, unknown> = {}) =>
	fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
		String(params[name]),
	)) as unknown as Parameters<typeof statutoryWarningText>[1];

function finding(
	statutoryKind: string,
	summary: StatutoryComplianceFinding["summary"],
): StatutoryComplianceFinding {
	return {
		type: "statutory",
		employeeId: "e1",
		findingId: `${statutoryKind}:e1:2026`,
		statutoryKind,
		domain: "short_term",
		severity: "warning",
		subjectKey: "2026",
		legalReference: "§ 8 Abs. 1 Nr. 2 SGB IV",
		summary,
		acknowledgementStatus: null,
		blocksPublication: false,
	};
}

describe("short-term warning text (#1990)", () => {
	it("tells planners how many working days or months remain", () => {
		expect(
			statutoryWarningText(
				finding("short_term_work_days", {
					tier: "warning",
					usedPercent: 87,
					used: { unit: "days", value: 61 },
					limit: { unit: "days", value: 70 },
					remaining: { unit: "days", value: 9 },
				}),
				t,
			),
		).toBe("Short-term employment: 9 of 70 working days left this year");
		expect(
			statutoryWarningText(
				finding("short_term_months", {
					tier: "critical",
					usedPercent: 98,
					used: { unit: "days", value: 90 },
					limit: { unit: "days", value: 92 },
					remaining: { unit: "days", value: 2 },
				}),
				t,
			),
		).toBe("Short-term employment (3-month limit): 2 of 92 calendar days left this year");
	});

	it.each(["warning", "critical", "exceeded"] as const)(
		"renders agricultural duration in calendar days at %s",
		(tier) => {
			const used = tier === "exceeded" ? 106 : tier === "critical" ? 104 : 90;
			expect(
				statutoryWarningText(
					finding("short_term_weeks", {
						tier,
						used: { unit: "days", value: used },
						limit: { unit: "days", value: 105 },
						remaining: { unit: "days", value: Math.max(0, 105 - used) },
					}),
					t,
				),
			).toContain("105 calendar days");
		},
	);
	it("says when the 3-month limit is exceeded, in calendar days", () => {
		expect(
			statutoryWarningText(
				finding("short_term_months", {
					tier: "exceeded",
					usedPercent: 101,
					used: { unit: "days", value: 91 },
					limit: { unit: "days", value: 90 },
					remaining: { unit: "days", value: 0 },
				}),
				t,
			),
		).toBe("Short-term 3-month limit exceeded: 91 of 90 calendar days this year");
	});

	it("says when the limit is exceeded", () => {
		expect(
			statutoryWarningText(
				finding("short_term_work_days", {
					tier: "exceeded",
					usedPercent: 101,
					used: { unit: "days", value: 71 },
					limit: { unit: "days", value: 70 },
					remaining: { unit: "days", value: 0 },
				}),
				t,
			),
		).toBe("Short-term day limit exceeded: 71 of 70 working days this year");
	});

	it("falls back to the generic text without quantities", () => {
		expect(statutoryWarningText(finding("short_term_work_days", { tier: "exceeded" }), t)).toBe(
			"Short-term employment limit: statutory limit exceeded",
		);
	});
});
