"use server";

import {
	getPeriodSubmissionOverview,
	type PeriodSubmissionOverviewResult,
	type PeriodSubmissionsAccess,
} from "./period-submissions-data";

/** Expectations refuse a queued arrival; the current server session remains the authority. */
export async function readPeriodSubmissionOverview(
	requestedPeriod: string | null,
	expected: Pick<PeriodSubmissionsAccess, "userId" | "organizationId">,
): Promise<PeriodSubmissionOverviewResult> {
	try {
		return await getPeriodSubmissionOverview(requestedPeriod, expected);
	} catch {
		return { status: "unavailable" };
	}
}
