/**
 * #1198/#1199: the value each export target writes or matches an employee by,
 * one rule per format, so the duplicate-identifier check compares exactly what
 * the target sends, fallbacks included.
 */

import { describe, expect, it } from "vitest";
import { exportedPersonnelIdentifier } from "./exported-personnel-identifier";

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

function ruleOf(formatId: string, config: unknown) {
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

describe.each(["successfactors_api", "successfactors_csv"])(
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
