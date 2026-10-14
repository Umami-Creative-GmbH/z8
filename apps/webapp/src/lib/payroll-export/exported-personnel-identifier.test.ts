/**
 * #1198/#1199: the value each export target writes or matches an employee by,
 * one rule per format, so the duplicate-identifier check compares exactly what
 * the target sends, fallbacks included.
 */

import { describe, expect, it } from "vitest";
import { exportedPersonnelIdentifier } from "./exported-personnel-identifier";
import type { PayrollExportFormatId } from "./format-registry";
import { findDuplicatePersonnelIdentifiers } from "./personnel-identifier";

const anna = {
	employeeId: "employee-anna",
	employeeNumber: "E-42",
	email: "anna@example.test",
	personnelIdentifier: "LG-7",
};
const withoutValues = {
	employeeId: "employee-ben",
	employeeNumber: null,
	email: null,
	personnelIdentifier: null,
};

function ruleOf(formatId: PayrollExportFormatId, config: unknown) {
	const rule = exportedPersonnelIdentifier(formatId, config);
	if (!rule) throw new Error(`no identifier rule for ${formatId}`);
	return rule;
}

describe("exportedPersonnelIdentifier for Personio", () => {
	it("matches by employee number unless the configuration says otherwise", () => {
		expect(ruleOf("personio", {})(anna)).toBe("E-42");
		expect(ruleOf("personio", { employeeMatchStrategy: "employeeNumber" })(anna)).toBe("E-42");
		expect(ruleOf("personio", {})(withoutValues)).toBeNull();
	});

	it("matches by email or by the custom field value, never falling back", () => {
		const byEmail = ruleOf("personio", { employeeMatchStrategy: "email" });
		const byField = ruleOf("personio", {
			employeeMatchStrategy: "customField",
			employeeMatchCustomFieldId: "field-1",
		});

		expect(byEmail(anna)).toBe("anna@example.test");
		expect(byEmail({ ...anna, email: null })).toBeNull();
		expect(byField(anna)).toBe("LG-7");
		expect(byField({ ...anna, personnelIdentifier: null })).toBeNull();
	});
});

describe("exportedPersonnelIdentifier for Workday", () => {
	it("matches by employee number unless the configuration says otherwise", () => {
		expect(ruleOf("workday_api", {})(anna)).toBe("E-42");
		expect(ruleOf("workday_api", {})({ ...anna, employeeNumber: "  " })).toBeNull();
	});

	it("matches by email or by the custom field value, never falling back", () => {
		const byEmail = ruleOf("workday_api", { employeeMatchStrategy: "email" });
		const byField = ruleOf("workday_api", {
			employeeMatchStrategy: "customField",
			employeeMatchCustomFieldId: "field-1",
		});

		expect(byEmail(anna)).toBe("anna@example.test");
		expect(byEmail(withoutValues)).toBeNull();
		expect(byField(anna)).toBe("LG-7");
		expect(byField(withoutValues)).toBeNull();
	});
});

describe.each(["datev_lohn", "lexware_lohn", "sage_lohn"] as const)(
	"exportedPersonnelIdentifier for %s",
	(formatId) => {
		it("writes the employee number, falling back to the employee ID", () => {
			const byNumber = ruleOf(formatId, { personnelNumberType: "employeeNumber" });

			expect(byNumber(anna)).toBe("E-42");
			expect(byNumber(withoutValues)).toBe("employee-ben");
		});

		it("writes the employee ID when configured so", () => {
			expect(ruleOf(formatId, { personnelNumberType: "employeeId" })(anna)).toBe("employee-anna");
		});

		it("writes the custom field value, leaving a missing one to the missing-value check", () => {
			const byField = ruleOf(formatId, {
				personnelNumberType: "customField",
				personnelNumberCustomFieldId: "field-1",
			});

			expect(byField(anna)).toBe("LG-7");
			expect(byField(withoutValues)).toBeNull();
		});

		// The export service compares every row a file carries: work, absences,
		// overtime payouts and expense lines alike.
		it("finds an employee number that equals the ID another employee falls back to", () => {
			const rows = [
				{ ...withoutValues, employeeId: "employee-ben" },
				{ ...anna, employeeNumber: " EMPLOYEE-BEN" },
			];

			expect(
				findDuplicatePersonnelIdentifiers(
					rows,
					ruleOf(formatId, { personnelNumberType: "employeeNumber" }),
				),
			).toEqual([
				{
					employees: [
						{ employeeId: "employee-anna", identifier: " EMPLOYEE-BEN" },
						{ employeeId: "employee-ben", identifier: "employee-ben" },
					],
				},
			]);
		});
	},
);

describe.each(["successfactors_api", "successfactors_csv"] as const)(
	"exportedPersonnelIdentifier for %s",
	(formatId) => {
		it("matches the user ID by employee number, falling back to the employee ID", () => {
			const byUserId = ruleOf(formatId, {});

			expect(byUserId(anna)).toBe("E-42");
			expect(byUserId(withoutValues)).toBe("employee-ben");
		});

		it("matches personIdExternal and email by employee number, without a fallback", () => {
			for (const employeeMatchStrategy of ["personIdExternal", "email"]) {
				const rule = ruleOf(formatId, { employeeMatchStrategy });

				expect(rule(anna)).toBe("E-42");
				expect(rule(withoutValues)).toBeNull();
			}
		});

		it("matches by the custom field value, leaving a missing one to the missing-value check", () => {
			const byField = ruleOf(formatId, {
				employeeMatchStrategy: "customField",
				employeeMatchCustomFieldId: "field-1",
			});

			expect(byField(anna)).toBe("LG-7");
			expect(byField(withoutValues)).toBeNull();
		});
	},
);
