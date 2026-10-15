import "server-only";

/**
 * Reopening a month (#762) attaches the canonical work records missing for the
 * employees reopened (#1224, spec #1212), so reopened work can change like any
 * other work. The reopening commits first, under the organization configuration
 * guard; each attach then runs in its own work transaction, which the guard
 * order (ADR 0001) does not allow inside the reopening's. A failed attach leaves
 * the reopening standing: the lazy canonical backfill attaches what is left.
 */
import type { db as appDb } from "@/db";
import { createLogger } from "@/lib/logger";
import {
	attachMissingWorkRecords,
	type MissingWorkRecordAttachment,
} from "@/lib/time-record/migration/attach-missing-work-records";
import { type ReopenMonthResult, reopenMonth } from "./store";

const logger = createLogger("ClosedMonthReopening");

export type ReopenMonthAttachingWorkResult =
	| Exclude<ReopenMonthResult, { kind: "reopened" }>
	| (Extract<ReopenMonthResult, { kind: "reopened" }> & {
			/** The reopened employees' work attached; null when attaching failed. */
			work: MissingWorkRecordAttachment | null;
	  });

export async function reopenMonthAttachingWork(
	client: Pick<typeof appDb, "transaction">,
	input: Parameters<typeof reopenMonth>[1],
): Promise<ReopenMonthAttachingWorkResult> {
	const reopened = await reopenMonth(client, input);
	if (reopened.kind !== "reopened") return reopened;
	try {
		const work = await attachMissingWorkRecords({
			organizationId: input.organizationId,
			employeeIds: reopened.employeeIds,
			actorUserId: input.actorUserId,
		});
		return { ...reopened, work };
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId, month: input.month },
			"Attaching canonical work records after reopening failed",
		);
		return { ...reopened, work: null };
	}
}
