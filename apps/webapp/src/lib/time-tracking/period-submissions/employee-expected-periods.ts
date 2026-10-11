import type { db } from "@/db";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import {
	deriveExpectedSubmissionPeriods,
	type ExpectedSubmissionPeriod,
	type ExpectedSubmissionPeriodFacts,
} from "./expected-periods";
import { loadExpectedSubmissionFactsByEmployee } from "./organization-expected-periods";

type Database = typeof db;

/**
 * Every fact `deriveExpectedSubmissionPeriods` needs about one employee for the periods
 * overlapping `window`, read through the organization's one fact reader. Null when the employee is
 * not in the organization.
 */
export async function loadExpectedSubmissionPeriodFacts(
	database: Database,
	input: { organizationId: string; employeeId: string; window: { from: PlainDate; to: PlainDate } },
): Promise<ExpectedSubmissionPeriodFacts | null> {
	const facts = await loadExpectedSubmissionFactsByEmployee(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		window: input.window,
	});
	return facts.get(input.employeeId) ?? null;
}

/**
 * The submission periods one employee of the organization is expected to submit that overlap
 * `window`, in their timezone. Empty for an employee outside the organization.
 */
export async function loadExpectedSubmissionPeriods(
	database: Database,
	input: { organizationId: string; employeeId: string; window: { from: PlainDate; to: PlainDate } },
): Promise<ExpectedSubmissionPeriod[]> {
	const facts = await loadExpectedSubmissionPeriodFacts(database, input);
	return facts ? deriveExpectedSubmissionPeriods(facts, input.window) : [];
}
