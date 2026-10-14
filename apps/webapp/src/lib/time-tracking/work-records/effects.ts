import "server-only";

/**
 * The effects that follow any change to completed work (ADR 0010), inside the
 * work transaction: sending period submissions back, carrying invoiced work to
 * divided-off work and marking the work balance dirty. Every operation of work
 * records applies them through here, so no writer can leave one out.
 */
import { carryInvoicedWorkToSplit } from "@/lib/billable-time/hand-off/invoiced-work";
import type { Instant } from "@/lib/datetime/temporal-core";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { earliestStartDate } from "../close-active-work";
import type { WorkInterval } from "../closed-months/rules";
import { sendBackChangedPeriodSubmissions } from "../period-submissions/submission-send-back";
import type { WorkTransactionClient } from "../work-transaction";

type EffectScope = { organizationId: string; employeeId: string };

/**
 * Sends submitted periods touched by the work before or after the change back
 * to the employee (#1062). Runs before the change's first write, in work
 * records' lock order. A change of notes alone is not a change of work, so
 * callers of a notes-only change pass no intervals.
 */
export async function sendBackChangedWork(
	tx: WorkTransactionClient,
	input: EffectScope & {
		causedByUserId: string | null;
		before: readonly WorkInterval[];
		after: readonly WorkInterval[];
	},
): Promise<void> {
	const work = [...input.before, ...input.after];
	if (work.length === 0) return;
	await sendBackChangedPeriodSubmissions(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		causedByUserId: input.causedByUserId,
		work,
	});
}

/** The start of a written work period and the captured offset of the entry that starts it. */
export type WrittenStart = { at: Instant; utcOffsetMinutes: number };

/**
 * After the writes: invoiced work stays invoiced in divided-off work (#903; the
 * source is marked changed by trigger), and the work balance refreshes from the
 * earliest UTC or event-local date of the written starts, each in its own
 * entry's offset (#1214). Returns that date.
 */
export async function applyWrittenWorkEffects(
	tx: WorkTransactionClient,
	input: EffectScope & {
		writtenStarts: readonly WrittenStart[];
		dividedOff?: readonly { sourceWorkPeriodId: string; newWorkPeriodId: string }[];
	},
): Promise<{ workBalanceDirtyFromDate: string }> {
	for (const division of input.dividedOff ?? []) {
		await carryInvoicedWorkToSplit(tx, { organizationId: input.organizationId, ...division });
	}
	const [dirtyFromDate] = input.writtenStarts
		.map(({ at, utcOffsetMinutes }) => earliestStartDate(at, utcOffsetMinutes))
		.sort();
	if (!dirtyFromDate) throw new Error("Work balance refresh date is missing");
	await markEmployeeWorkBalanceDirty(
		{ organizationId: input.organizationId, employeeId: input.employeeId, dirtyFromDate },
		tx,
	);
	return { workBalanceDirtyFromDate: dirtyFromDate };
}
