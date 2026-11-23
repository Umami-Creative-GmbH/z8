import { describe, expect, it } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { statutoryWarningText } from "./statutory-warning-text";

const t = (_key: string, fallback: string, params?: Record<string, unknown>) =>
	Object.entries(params ?? {}).reduce(
		(text, [name, value]) => text.replace(`{${name}}`, String(value)),
		fallback,
	);

function finding(overrides: Partial<StatutoryComplianceFinding>): StatutoryComplianceFinding {
	return {
		type: "statutory",
		employeeId: "e1",
		findingId: "f1",
		statutoryKind: "working_student_lecture_week",
		domain: "working_student",
		severity: "warning",
		subjectKey: "2026-W10",
		legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
		summary: {},
		acknowledgementStatus: "none",
		blocksPublication: false,
		...overrides,
	};
}

describe("working-student warning text (#1991)", () => {
	it("names the lecture-week daytime hours against the 20-hour limit", () => {
		expect(
			statutoryWarningText(
				finding({
					summary: {
						tier: "exceeded",
						usedPercent: 130,
						used: { unit: "minutes", value: 1560 },
						limit: { unit: "minutes", value: 1200 },
					},
				}),
				t as never,
			),
		).toBe("Working student >20 h in lecture week: 26 h of weekday daytime work (limit 20 h)");
	});

	it("counts the rolling weeks above 20 hours", () => {
		expect(
			statutoryWarningText(
				finding({
					statutoryKind: "working_student_26_week_ceiling",
					summary: {
						tier: "exceeded",
						used: { unit: "weeks", value: 27 },
						limit: { unit: "weeks", value: 26 },
					},
				}),
				t as never,
			),
		).toBe("Working student: 27 of 26 weeks above 20 h in 12 months");
	});

	it("falls back to the generic text without the quantities", () => {
		expect(statutoryWarningText(finding({ summary: { tier: "warning" } }), t as never)).toBe(
			"Working student limit: approaching the statutory limit",
		);
	});
});
