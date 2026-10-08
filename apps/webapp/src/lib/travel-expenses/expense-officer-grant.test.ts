import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import {
	buildValidatedExpenseOfficerGrant,
	diffExpenseOfficerGrant,
	type ExpenseOfficerGrantValues,
	expenseOfficerGrantAuditChanges,
	officerScopeOf,
} from "./expense-officer-grant";

const OFFICER = "00000000-0000-4000-8000-00000000e001";
const ANNA = "00000000-0000-4000-8000-00000000e002";
const DEPARTED = "00000000-0000-4000-8000-00000000e003";
const BERLIN = "00000000-0000-4000-8000-00000000b001";
const MUNICH = "00000000-0000-4000-8000-00000000b002";

const ownership = {
	activeEmployeeIds: [OFFICER, ANNA],
	organizationEmployeeIds: [OFFICER, ANNA, DEPARTED],
	organizationTeamIds: [BERLIN, MUNICH],
};

const berlinExporter: ExpenseOfficerGrantValues = {
	scope: "specific",
	teamIds: [BERLIN],
	employeeIds: [],
	canExport: true,
	canRecordReimbursements: false,
};

function validationField(run: () => unknown): string | undefined {
	try {
		run();
	} catch (error) {
		if (error instanceof ValidationError) return error.field ?? "";
		throw error;
	}
	return undefined;
}

describe("buildValidatedExpenseOfficerGrant", () => {
	it("accepts a scoped grant with its capabilities", () => {
		expect(
			buildValidatedExpenseOfficerGrant(
				{ officerEmployeeId: OFFICER, ...berlinExporter },
				ownership,
			),
		).toEqual({ officerEmployeeId: OFFICER, ...berlinExporter });
	});

	it("accepts a read-only grant with neither capability", () => {
		const grant = buildValidatedExpenseOfficerGrant(
			{
				officerEmployeeId: OFFICER,
				scope: "all",
				teamIds: [],
				employeeIds: [],
				canExport: false,
				canRecordReimbursements: false,
			},
			ownership,
		);
		expect(grant.canExport).toBe(false);
		expect(grant.canRecordReimbursements).toBe(false);
	});

	it("drops teams and employees from an all-scope grant", () => {
		expect(
			buildValidatedExpenseOfficerGrant(
				{ officerEmployeeId: OFFICER, ...berlinExporter, scope: "all", employeeIds: [ANNA] },
				ownership,
			),
		).toMatchObject({ scope: "all", teamIds: [], employeeIds: [] });
	});

	it("lets a grant name a departed employee, whose last reports are still owed", () => {
		expect(
			buildValidatedExpenseOfficerGrant(
				{ officerEmployeeId: OFFICER, ...berlinExporter, teamIds: [], employeeIds: [DEPARTED] },
				ownership,
			).employeeIds,
		).toEqual([DEPARTED]);
	});

	it("refuses a departed or foreign officer", () => {
		expect(
			validationField(() =>
				buildValidatedExpenseOfficerGrant(
					{ officerEmployeeId: DEPARTED, ...berlinExporter },
					ownership,
				),
			),
		).toBe("officerEmployeeId");
	});

	it("refuses teams and employees of another organization", () => {
		const foreign = "00000000-0000-4000-8000-00000000f001";
		expect(
			validationField(() =>
				buildValidatedExpenseOfficerGrant(
					{ officerEmployeeId: OFFICER, ...berlinExporter, teamIds: [foreign] },
					ownership,
				),
			),
		).toBe("teamIds");
		expect(
			validationField(() =>
				buildValidatedExpenseOfficerGrant(
					{ officerEmployeeId: OFFICER, ...berlinExporter, employeeIds: [foreign] },
					ownership,
				),
			),
		).toBe("employeeIds");
	});

	it("refuses a specific grant that names nobody", () => {
		expect(
			validationField(() =>
				buildValidatedExpenseOfficerGrant(
					{ officerEmployeeId: OFFICER, ...berlinExporter, teamIds: [] },
					ownership,
				),
			),
		).toBe("scope");
	});

	it("refuses capabilities that are not booleans", () => {
		expect(
			validationField(() =>
				buildValidatedExpenseOfficerGrant(
					{
						officerEmployeeId: OFFICER,
						...berlinExporter,
						canExport: "yes" as unknown as boolean,
					},
					ownership,
				),
			),
		).toBe("canExport");
	});
});

describe("diffExpenseOfficerGrant", () => {
	it("sees no change in the same grant listed in another order", () => {
		expect(
			diffExpenseOfficerGrant(
				{ ...berlinExporter, teamIds: [MUNICH, BERLIN] },
				{ ...berlinExporter, teamIds: [BERLIN, MUNICH] },
			).changed,
		).toBe(false);
	});

	it("sees a changed capability as a change", () => {
		expect(
			diffExpenseOfficerGrant(berlinExporter, { ...berlinExporter, canRecordReimbursements: true })
				.changed,
		).toBe(true);
	});

	it("lists added and removed teams and employees", () => {
		expect(
			diffExpenseOfficerGrant(berlinExporter, {
				...berlinExporter,
				teamIds: [MUNICH],
				employeeIds: [ANNA],
			}),
		).toMatchObject({
			changed: true,
			addedTeamIds: [MUNICH],
			removedTeamIds: [BERLIN],
			addedEmployeeIds: [ANNA],
			removedEmployeeIds: [],
		});
	});
});

describe("expenseOfficerGrantAuditChanges", () => {
	it("records the old and new scope and capabilities, sorted", () => {
		expect(
			expenseOfficerGrantAuditChanges({ ...berlinExporter, teamIds: [MUNICH, BERLIN] }, null),
		).toEqual({
			from: {
				scope: "specific",
				teamIds: [BERLIN, MUNICH],
				employeeIds: [],
				canExport: true,
				canRecordReimbursements: false,
			},
			to: null,
		});
	});
});

describe("officerScopeOf", () => {
	it("turns the stored grant into the scope finance surfaces check", () => {
		expect(officerScopeOf(berlinExporter)).toEqual({
			kind: "specific",
			teamIds: [BERLIN],
			employeeIds: [],
		});
		expect(officerScopeOf({ ...berlinExporter, scope: "all" })).toEqual({ kind: "all" });
	});
});
