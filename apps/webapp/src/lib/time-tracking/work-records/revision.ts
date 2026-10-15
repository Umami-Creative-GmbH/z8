import "server-only";

/**
 * A work period's revision advanced without a change to its work (#1230): a
 * pending correction's submission, rejection or cancellation changes the
 * period's evidence, which fingerprints built on the revision must see, and
 * none of its work. Compare-and-set on the revision the transition read under
 * its locks; deleted periods advance too. A revision that moved on is the
 * `stale` refusal every work records change returns; callers `orRefuse` it.
 */
import { and, eq } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import type { SealedWorkTransactionScope } from "../work-transaction";
import type { WorkRecordRefusal } from "./change";

export type WorkRevisionAdvance = { kind: "revision_advanced"; revision: number };

export async function advanceWorkRevision(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		expectedRevision: number;
	},
): Promise<WorkRevisionAdvance | WorkRecordRefusal> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const next = input.expectedRevision + 1;
	const ofPeriod = and(
		eq(workPeriod.id, input.workPeriodId),
		eq(workPeriod.organizationId, input.organizationId),
		eq(workPeriod.employeeId, input.employeeId),
	);
	const updated = await scope.db
		.update(workPeriod)
		.set({ graphRevision: next })
		.where(and(ofPeriod, eq(workPeriod.graphRevision, input.expectedRevision)))
		.returning({ id: workPeriod.id });
	if (updated.length === 1) return { kind: "revision_advanced", revision: next };
	const [current] = await scope.db
		.select({ revision: workPeriod.graphRevision })
		.from(workPeriod)
		.where(ofPeriod);
	if (!current) return { kind: "not_found", workPeriodId: input.workPeriodId };
	return { kind: "stale", current: { revision: current.revision } };
}
