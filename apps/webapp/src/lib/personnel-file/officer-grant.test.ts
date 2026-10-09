import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import {
	buildValidatedPersonnelFileOfficerGrant,
	diffPersonnelFileOfficerGrant,
	manageGrantOf,
	personnelFileOfficerGrantAuditChanges,
} from "./officer-grant";

const ownership = {
	activeEmployeeIds: ["officer", "anna"],
	organizationEmployeeIds: ["officer", "anna", "leaver"],
	organizationTeamIds: ["berlin"],
};

const base = {
	officerEmployeeId: "officer",
	scope: "specific" as const,
	teamIds: ["berlin"],
	employeeIds: [],
	categories: ["payslip" as const],
};

function refusal(run: () => unknown): ValidationError {
	try {
		run();
	} catch (error) {
		if (error instanceof ValidationError) return error;
		throw error;
	}
	throw new Error("expected a validation error");
}

describe("personnel file officer grant rules", () => {
	it("accepts a team-scoped grant for payslips only", () => {
		expect(buildValidatedPersonnelFileOfficerGrant(base, ownership)).toEqual(base);
	});

	it("covers all five document categories when none are given", () => {
		const { categories: _omitted, ...withoutCategories } = base;
		expect(
			buildValidatedPersonnelFileOfficerGrant(withoutCategories as typeof base, ownership)
				.categories,
		).toEqual(["contract", "payslip", "certificate", "sick_note", "other"]);
	});

	it("refuses an empty or unknown category set", () => {
		expect(
			refusal(() => buildValidatedPersonnelFileOfficerGrant({ ...base, categories: [] }, ownership))
				.field,
		).toBe("categories");
		expect(
			refusal(() =>
				buildValidatedPersonnelFileOfficerGrant(
					{ ...base, categories: ["payroll" as never] },
					ownership,
				),
			).field,
		).toBe("categories");
	});

	it("keeps categories in their fixed order without duplicates", () => {
		expect(
			buildValidatedPersonnelFileOfficerGrant(
				{ ...base, categories: ["other", "contract", "other"] },
				ownership,
			).categories,
		).toEqual(["contract", "other"]);
	});

	it("lets a grant name a departed employee but not make them the officer", () => {
		expect(
			buildValidatedPersonnelFileOfficerGrant(
				{ ...base, teamIds: [], employeeIds: ["leaver"] },
				ownership,
			).employeeIds,
		).toEqual(["leaver"]);
		expect(
			refusal(() =>
				buildValidatedPersonnelFileOfficerGrant(
					{ ...base, officerEmployeeId: "leaver" },
					ownership,
				),
			).field,
		).toBe("officerEmployeeId");
	});

	it("refuses teams and employees of other organizations and an empty specific scope", () => {
		expect(
			refusal(() =>
				buildValidatedPersonnelFileOfficerGrant({ ...base, teamIds: ["elsewhere"] }, ownership),
			).field,
		).toBe("teamIds");
		expect(
			refusal(() =>
				buildValidatedPersonnelFileOfficerGrant(
					{ ...base, teamIds: [], employeeIds: ["stranger"] },
					ownership,
				),
			).field,
		).toBe("employeeIds");
		expect(
			refusal(() => buildValidatedPersonnelFileOfficerGrant({ ...base, teamIds: [] }, ownership))
				.field,
		).toBe("scope");
	});

	it("refuses an unknown scope as a personnel file officer scope", () => {
		const error = refusal(() =>
			buildValidatedPersonnelFileOfficerGrant({ ...base, scope: "everyone" as never }, ownership),
		);
		expect(error.field).toBe("scope");
		expect(error.message).toBe("Choose which employees the personnel file officer covers");
	});

	it("drops named teams and employees from an all-employees grant", () => {
		expect(
			buildValidatedPersonnelFileOfficerGrant(
				{ ...base, scope: "all", employeeIds: ["anna"] },
				ownership,
			),
		).toEqual({ ...base, scope: "all", teamIds: [], employeeIds: [] });
	});

	it("sees a category change as a change and a reordering as none", () => {
		const before = {
			scope: "all" as const,
			teamIds: [],
			employeeIds: [],
			categories: ["payslip", "contract"] as const,
		};
		expect(
			diffPersonnelFileOfficerGrant(
				{ ...before, categories: [...before.categories] },
				{ ...before, categories: ["contract", "payslip"] },
			).changed,
		).toBe(false);
		expect(
			diffPersonnelFileOfficerGrant(
				{ ...before, categories: [...before.categories] },
				{ ...before, categories: ["contract"] },
			).changed,
		).toBe(true);
	});

	it("records old and new scope and categories for the audit", () => {
		expect(
			personnelFileOfficerGrantAuditChanges(
				{
					scope: "specific",
					teamIds: ["b", "a"],
					employeeIds: [],
					categories: ["other", "payslip"],
				},
				null,
			),
		).toEqual({
			from: {
				scope: "specific",
				teamIds: ["a", "b"],
				employeeIds: [],
				categories: ["payslip", "other"],
			},
			to: null,
		});
	});

	it("turns a grant into a manage grant the access resolver understands", () => {
		const grant = manageGrantOf({
			scope: "specific",
			teamIds: ["berlin"],
			employeeIds: ["anna"],
			categories: ["payslip"],
		});
		expect(grant.source).toBe("officer_grant");
		expect(grant.scope).toEqual({ kind: "specific", teamIds: ["berlin"], employeeIds: ["anna"] });
		expect([...grant.categories]).toEqual(["payslip"]);
		expect(
			manageGrantOf({ scope: "all", teamIds: [], employeeIds: [], categories: ["contract"] }).scope,
		).toEqual({ kind: "all" });
	});
});
