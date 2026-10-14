import "server-only";

/**
 * Erasing an employee's whole work history (ADR 0010, #1223): every work period
 * with its canonical work record and every time entry, removed together with
 * the append position that points into them. Demo cleanup is the only caller;
 * it removes the history's other evidence (approval lifecycle, proposals,
 * intents, receipts) itself. Runs on a sealed work-transaction scope only; it
 * never opens a transaction and never takes guards.
 *
 * The effects follow as for any change of work: submitted periods the erased
 * work touched are sent back, and the work balance refreshes from the earliest
 * erased start in its own entry's offset.
 */
import { and, asc, eq, inArray, notExists } from "drizzle-orm";
import {
	approvalRequest,
	timeEntry,
	timeEntryAppendPosition,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { SealedWorkTransactionScope } from "../work-transaction";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";

export type EmployeeWorkHistoryErasure = {
	workPeriodsDeleted: number;
	workPeriodsWithCategory: number;
	timeEntriesDeleted: number;
	/** Null when the employee had no work periods. */
	effects: { workBalanceDirtyFromDate: string } | null;
};

export async function eraseEmployeeWorkHistory(
	scope: SealedWorkTransactionScope,
	input: { organizationId: string; employeeId: string; actorUserId: string | null },
): Promise<EmployeeWorkHistoryErasure> {
	const { organizationId, employeeId } = input;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const ofEmployee = and(
		eq(workPeriod.organizationId, organizationId),
		eq(workPeriod.employeeId, employeeId),
	);
	const periods = await tx
		.select({
			id: workPeriod.id,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			deletedAt: workPeriod.deletedAt,
			clockInOffset: timeEntry.utcOffsetMinutes,
		})
		.from(workPeriod)
		.leftJoin(
			timeEntry,
			and(eq(timeEntry.id, workPeriod.clockInId), eq(timeEntry.organizationId, organizationId)),
		)
		.where(ofEmployee)
		.orderBy(asc(workPeriod.id))
		.for("update", { of: workPeriod });

	// Writes. The work that stood is changed work; deleted periods were already sent back.
	const standing = periods.filter(({ deletedAt }) => deletedAt === null);
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: input.actorUserId,
		before: standing.map((period) => ({
			start: instantFromDate(period.startTime),
			end: instantFromDate(period.endTime ?? period.startTime),
		})),
		after: [],
	});
	// The append position references its tip entry; it goes with the history.
	await tx
		.delete(timeEntryAppendPosition)
		.where(
			and(
				eq(timeEntryAppendPosition.organizationId, organizationId),
				eq(timeEntryAppendPosition.employeeId, employeeId),
			),
		);
	const deleted = await tx.delete(workPeriod).where(ofEmployee).returning({
		canonicalRecordId: workPeriod.canonicalRecordId,
		workCategoryId: workPeriod.workCategoryId,
	});
	const canonicalRecordIds = deleted.flatMap(({ canonicalRecordId }) =>
		canonicalRecordId ? [canonicalRecordId] : [],
	);
	// The periods' canonical work goes with them; left behind it would read as
	// unlinked canonical-native work. A record an approval request still names stays.
	if (canonicalRecordIds.length > 0) {
		await tx.delete(timeRecord).where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
				inArray(timeRecord.id, canonicalRecordIds),
				notExists(
					tx
						.select({ id: approvalRequest.id })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, timeRecord.organizationId),
								eq(approvalRequest.canonicalRecordId, timeRecord.id),
							),
						),
				),
			),
		);
	}
	const entries = await tx
		.delete(timeEntry)
		.where(and(eq(timeEntry.organizationId, organizationId), eq(timeEntry.employeeId, employeeId)))
		.returning({ id: timeEntry.id });

	const effects =
		periods.length === 0
			? null
			: await applyWrittenWorkEffects(tx, {
					organizationId,
					employeeId,
					writtenStarts: periods.map((period) => ({
						at: instantFromDate(period.startTime),
						utcOffsetMinutes: period.clockInOffset ?? 0,
					})),
				});
	return {
		workPeriodsDeleted: deleted.length,
		workPeriodsWithCategory: deleted.filter(({ workCategoryId }) => workCategoryId !== null).length,
		timeEntriesDeleted: entries.length,
		effects,
	};
}
