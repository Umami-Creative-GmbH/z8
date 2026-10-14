import "server-only";

/**
 * Reading a work record: a completed work period with its endpoint entries and
 * canonical work record, the expected state a change against it names, its
 * work attribution and whether the pair is in record agreement.
 */
import { compareInstants, instantFromDate } from "@/lib/datetime/temporal-core";
import type { SealedWorkTransactionScope } from "../work-transaction";
import type { WorkRecordExpected } from "./change";
import type { WorkRecordPair } from "./plan";
import { type RecordAgreement, recordAgreement } from "./record-agreement";
import {
	selectWorkRecordRows,
	type WorkPeriodRow,
	type WorkRecordKey,
	type WorkRecordRows,
} from "./rows";
import { WorkAttribution } from "./work-attribution";

export type WorkRecord = WorkRecordRows & {
	/** The current state as a change names it; pass it (or its required part) to chain. */
	expected: WorkRecordExpected;
	attribution: WorkAttribution;
	/** Null for live work and for work without a canonical work record. */
	agreement: RecordAgreement | null;
};

/**
 * The work period of the employee with its canonical work record, or null when
 * there is none (or it is deleted). With `lock`, the rows stay locked
 * `FOR UPDATE` in work records' table order until the work transaction ends,
 * so a caller can check its own preconditions on exactly what a following
 * `applyWorkRecordChange` will change.
 */
export async function readWorkRecord(
	scope: SealedWorkTransactionScope,
	key: WorkRecordKey,
	options: { lock?: boolean } = {},
): Promise<WorkRecord | null> {
	scope.assertEmployee(key.organizationId, key.employeeId);
	const rows = await selectWorkRecordRows(scope.db, key, { lock: options.lock ?? false });
	return rows ? workRecordOf(rows) : null;
}

export function workRecordOf(rows: WorkRecordRows): WorkRecord {
	const pair = pairOf(rows);
	return {
		...rows,
		expected: expectedOf(rows.period),
		attribution: WorkAttribution.fromWorkPeriod(rows.period),
		agreement:
			pair.canonical && pair.period.endTime !== null
				? recordAgreement(pair.period, pair.canonical)
				: null,
	};
}

/** The full expected state of a work period as stored. */
export function expectedOf(period: WorkPeriodRow): WorkRecordExpected {
	return {
		workPeriodId: period.id,
		revision: period.graphRevision,
		clockInId: period.clockInId,
		...(period.clockOutId ? { clockOutId: period.clockOutId } : {}),
		startAt: instantFromDate(period.startTime),
		...(period.endTime ? { endAt: instantFromDate(period.endTime) } : {}),
		attribution: WorkAttribution.fromWorkPeriod(period),
	};
}

/** Whether the stored work period is still the state the change was decided against. */
export function matchesExpected(expected: WorkRecordExpected, period: WorkPeriodRow): boolean {
	if (expected.workPeriodId !== period.id || expected.revision !== period.graphRevision) {
		return false;
	}
	if (expected.clockInId !== undefined && expected.clockInId !== period.clockInId) return false;
	if (expected.clockOutId !== undefined && expected.clockOutId !== period.clockOutId) return false;
	if (
		expected.startAt !== undefined &&
		compareInstants(expected.startAt, instantFromDate(period.startTime)) !== 0
	) {
		return false;
	}
	if (
		expected.endAt !== undefined &&
		(period.endTime === null ||
			compareInstants(expected.endAt, instantFromDate(period.endTime)) !== 0)
	) {
		return false;
	}
	return (
		expected.attribution === undefined ||
		expected.attribution.equals(WorkAttribution.fromWorkPeriod(period))
	);
}

/** The pair as the plan step and the agreement rule see it. */
export function pairOf(rows: WorkRecordRows): WorkRecordPair {
	return {
		period: rows.period,
		canonical: rows.canonical,
	};
}
