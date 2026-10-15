import "server-only";

/**
 * A work period's revision advanced without a change to its work (#1230): a
 * pending correction's submission, rejection or cancellation changes the
 * period's evidence, which fingerprints built on the revision must see, and
 * none of its work. Compare-and-set on the revision the transition read under
 * its locks; deleted periods advance too.
 */
import { and, eq } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { ConflictError } from "@/lib/effect/errors";
import type { SealedWorkTransactionScope } from "../work-transaction";

export async function advanceWorkRevision(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		expectedRevision: number;
	},
): Promise<number> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const next = input.expectedRevision + 1;
	const updated = await scope.db
		.update(workPeriod)
		.set({ graphRevision: next })
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.graphRevision, input.expectedRevision),
			),
		)
		.returning({ id: workPeriod.id });
	if (updated.length !== 1) {
		throw new ConflictError({
			message: "Work period changed while processing the correction",
			conflictType: "time_correction_work_period_stale",
		});
	}
	return next;
}
