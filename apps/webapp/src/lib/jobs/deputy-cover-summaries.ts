import { db } from "@/db";
import {
	type CoverSummariesResult,
	runCoverSummaries,
} from "@/lib/approvals/deputy/cover-summary-store";
import { systemClock } from "@/lib/datetime/temporal-core";

export type DeputyCoverSummariesJobResult = CoverSummariesResult;

/**
 * Cover summaries (#1018): the deputy hears what waits when the cover starts,
 * in the absent approver's timezone, and the approver hears what the deputy
 * decided on their first working day back. Sent markers make reruns and
 * retries send nothing again.
 */
export async function runDeputyCoverSummariesJob(): Promise<DeputyCoverSummariesJobResult> {
	return runCoverSummaries(db, { now: systemClock.nowInstant() });
}
