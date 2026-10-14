import "server-only";

/**
 * Reading a completed work period with its endpoint entries and canonical work
 * record, optionally row-locked. Work records takes row locks only, never
 * guards (ADR 0001: the coordinator already holds them), and always in
 * `WORK_RECORD_LOCK_ORDER`, so two work records changes can never wait on each
 * other in a cycle. Within one table, rows are locked by ascending id.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import type { WorkTransactionClient } from "../work-transaction";

/**
 * The one order in which work records locks and writes, for every operation and
 * both admissions. A later operation that needs more rows of a table (another
 * work period of the day, the employee's head entry) takes them at that
 * table's place, by ascending id. Callers' own locks (owner authority rows in
 * `employee`, an automatic break intent) come before `work_period`.
 *
 * - `work_period`, `time_entry` (endpoints), `time_record`, `time_record_work`,
 *   `time_record_allocation`: the pair, locked `FOR UPDATE` by the read.
 * - configuration reads `FOR SHARE` (vehicle use mode, vehicles, projects),
 *   then plain reads (occupancy, closed months).
 * - `time_entry_append_position`: the append admission, the last check; every
 *   refusal comes before it, so a refused change has written nothing.
 * - `period_submission`: the send-back effect, the first write.
 * - the change's own writes, in the pair's table order, then the
 *   `invoiced_work` and `employee_work_balance` effects.
 */
export const WORK_RECORD_LOCK_ORDER = [
	"work_period",
	"time_entry",
	"time_record",
	"time_record_work",
	"time_record_allocation",
	"time_entry_append_position",
	"period_submission",
	"invoiced_work",
	"employee_work_balance",
] as const;

export type WorkPeriodRow = typeof workPeriod.$inferSelect;
export type TimeEntryRow = typeof timeEntry.$inferSelect;
export type CanonicalWorkRows = {
	record: typeof timeRecord.$inferSelect;
	detail: typeof timeRecordWork.$inferSelect;
	allocations: (typeof timeRecordAllocation.$inferSelect)[];
};

/** A work period as stored, with its endpoint entries and canonical work record. */
export type WorkRecordRows = {
	period: WorkPeriodRow;
	clockIn: TimeEntryRow | null;
	/** Null for live work, and when the entry is missing. */
	clockOut: TimeEntryRow | null;
	/** Null without a link, or when the linked record or its detail is missing. */
	canonical: CanonicalWorkRows | null;
};

export type WorkRecordKey = {
	organizationId: string;
	employeeId: string;
	workPeriodId: string;
};

/**
 * The work period (not deleted) of the employee with its entries and canonical
 * work record, or null. With `lock`, every row is locked `FOR UPDATE` in
 * `WORK_RECORD_LOCK_ORDER`; locking again later in the same transaction is a
 * no-op, so a caller may read locked before applying a change.
 */
export async function selectWorkRecordRows(
	tx: WorkTransactionClient,
	key: WorkRecordKey,
	options: { lock: boolean },
): Promise<WorkRecordRows | null> {
	const periodQuery = tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, key.workPeriodId),
				eq(workPeriod.organizationId, key.organizationId),
				eq(workPeriod.employeeId, key.employeeId),
				isNull(workPeriod.deletedAt),
			),
		);
	const [period] = options.lock ? await periodQuery.for("update") : await periodQuery;
	if (!period) return null;

	const endpointIds = [period.clockInId, period.clockOutId].filter(
		(id): id is string => id !== null,
	);
	const entryQuery = tx
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, key.organizationId),
				eq(timeEntry.employeeId, key.employeeId),
				inArray(timeEntry.id, endpointIds),
			),
		)
		.orderBy(asc(timeEntry.id));
	const entries = options.lock ? await entryQuery.for("update") : await entryQuery;
	const clockIn = entries.find(({ id }) => id === period.clockInId) ?? null;
	const clockOut = entries.find(({ id }) => id === period.clockOutId) ?? null;

	const recordId = period.canonicalRecordId;
	if (!recordId) return { period, clockIn, clockOut, canonical: null };
	const recordQuery = tx
		.select()
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, recordId),
				eq(timeRecord.organizationId, key.organizationId),
				eq(timeRecord.employeeId, key.employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		);
	const [record] = options.lock ? await recordQuery.for("update") : await recordQuery;
	const detailQuery = tx
		.select()
		.from(timeRecordWork)
		.where(
			and(
				eq(timeRecordWork.recordId, recordId),
				eq(timeRecordWork.organizationId, key.organizationId),
				eq(timeRecordWork.recordKind, "work"),
			),
		);
	const [detail] = options.lock ? await detailQuery.for("update") : await detailQuery;
	const allocationQuery = tx
		.select()
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.recordId, recordId),
				eq(timeRecordAllocation.organizationId, key.organizationId),
			),
		)
		.orderBy(asc(timeRecordAllocation.id));
	const allocations = options.lock ? await allocationQuery.for("update") : await allocationQuery;
	return {
		period,
		clockIn,
		clockOut,
		canonical: record && detail ? { record, detail, allocations } : null,
	};
}
