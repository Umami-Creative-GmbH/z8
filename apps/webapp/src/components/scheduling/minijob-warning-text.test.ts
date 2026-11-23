import { describe, expect, it } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { statutoryWarningText } from "./statutory-warning-text";

const t = (_key: string, fallback: string, params?: Record<string, unknown>) =>
	Object.entries(params ?? {}).reduce(
		(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
		fallback,
	);

function finding(overrides: Partial<StatutoryComplianceFinding>): StatutoryComplianceFinding {
	return {
		type: "statutory",
		employeeId: "e1",
		findingId: "minijob_monthly_cap:e1:2026-12",
		statutoryKind: "minijob_monthly_cap",
		domain: "minijob",
		severity: "critical",
		subjectKey: "2026-12",
		legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
		summary: { tier: "exceeded" },
		acknowledgementStatus: "none",
		blocksPublication: false,
		...overrides,
	};
}

describe("Minijob warning text (#1989)", () => {
	it.each([
		[finding({}), "Minijob monthly limit exceeded"],
		[
			finding({ acknowledgementStatus: "current", severity: "info" }),
			"Minijob monthly limit exceeded (documented as unforeseeable)",
		],
		// Acknowledged once, but now above twice the cap or one exceedance too many: not documented.
		[
			finding({ acknowledgementStatus: "current", severity: "critical" }),
			"Minijob monthly limit exceeded",
		],
		[
			finding({ summary: { tier: "warning" }, severity: "warning" }),
			"Minijob monthly limit approaching",
		],
		[
			finding({ statutoryKind: "minijob_rolling_12m_cap", acknowledgementStatus: null }),
			"Minijob 12-month earnings limit exceeded",
		],
	])("words %# for planners", (input, text) => {
		expect(statutoryWarningText(input, t as never)).toBe(text);
	});
});
