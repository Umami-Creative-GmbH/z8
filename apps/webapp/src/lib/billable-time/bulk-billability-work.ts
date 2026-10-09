import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { db } from "@/db";
import { completedWorkOperation, timeEntry, workPeriod } from "@/db/schema";
import { comparePlainDates, dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { withCompletedWorkTransaction } from "@/lib/time-tracking/completed-work-transaction";
import { unresolvedWorkPeriodReviewSql } from "@/lib/time-tracking/unresolved-work-period-review";
import { setWorkPeriodBillabilityAsAdmin } from "@/lib/time-tracking/work-period-attribution";
import type { SealedWorkTransactionScope } from "@/lib/time-tracking/work-transaction";
import { workDayOf } from "./applicable-rate";
import {
	BULK_BILLABILITY_SKIP_REASONS,
	type BulkBillabilityOutcome,
	type BulkBillabilityRequest,
	type BulkBillabilitySkipReason,
	type BulkBillabilitySummary,
	type BulkBillabilityTally,
	type BulkBillabilityWork,
	bulkBillabilityOutcome,
	summarizeBulkBillability,
} from "./bulk-billability";
import { invoicedWorkPeriodSql } from "./hand-off/invoiced-work";

type Reader = Pick<typeof db, "select">;

const logger = createLogger("BulkBillability");

/**
 * The set-based predicate of each skip reason, over the `work_period` row in
 * scope. A new reason (e.g. `invoiced`, #903) is added to
 * `BULK_BILLABILITY_SKIP_REASONS` and gets its predicate here; preview, apply and
 * the in-transaction re-check all use it.
 */
export const BULK_BILLABILITY_SKIP_CONDITIONS: Record<
	BulkBillabilitySkipReason,
	() => SQL<boolean>
> = {
	invoiced: invoicedWorkPeriodSql,
	held_back: unresolvedWorkPeriodReviewSql,
};

/** The skip reasons that hold for the row in scope, in report order, as a text array. */
function skipReasonsSql(): SQL<string[]> {
	const cases = BULK_BILLABILITY_SKIP_REASONS.map(
		(reason) => sql`case when ${BULK_BILLABILITY_SKIP_CONDITIONS[reason]()} then ${reason} end`,
	);
	return sql<string[]>`array_remove(array[${sql.join(cases, sql`, `)}]::text[], null)`;
}

function knownSkipReasons(value: unknown): BulkBillabilitySkipReason[] {
	const reasons = Array.isArray(value) ? value : [];
	return BULK_BILLABILITY_SKIP_REASONS.filter((reason) => reasons.includes(reason));
}

/** Candidate work with the period identity an amendment expects. */
export interface BulkBillabilityCandidate extends BulkBillabilityWork {
	clockInId: string;
	clockOutId: string | null;
	startTime: Date;
	endTime: Date | null;
}

/**
 * Completed, non-deleted work on the organization's project whose
 * employee-local start day (at the offset captured on its start entry) falls in
 * the request's days. Live work never counts. SQL prefilters on a window a day
 * wider on each side (offsets span -12:00 to +14:00); the exact day is decided here.
 */
export async function loadBulkBillabilityWork(
	reader: Reader,
	organizationId: string,
	request: Pick<BulkBillabilityRequest, "projectId" | "fromDay" | "toDay">,
	options: { periodIds?: readonly string[] } = {},
): Promise<BulkBillabilityCandidate[]> {
	if (options.periodIds?.length === 0) return [];
	const windowStart = dateFromInstant(
		request.fromDay.subtract({ days: 1 }).toZonedDateTime("UTC").toInstant(),
	);
	const windowEnd = dateFromInstant(
		request.toDay.add({ days: 2 }).toZonedDateTime("UTC").toInstant(),
	);
	const rows = await reader
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isBillable: workPeriod.isBillable,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
			skipReasons: skipReasonsSql(),
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.projectId, request.projectId),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, windowStart),
				lt(workPeriod.startTime, windowEnd),
				options.periodIds ? inArray(workPeriod.id, [...options.periodIds]) : undefined,
			),
		)
		.orderBy(workPeriod.startTime, workPeriod.id);

	return rows.flatMap((row) => {
		if (row.durationMinutes === null) return [];
		const day = workDayOf(instantFromDate(row.startTime), row.startOffsetMinutes);
		if (comparePlainDates(day, request.fromDay) < 0 || comparePlainDates(day, request.toDay) > 0) {
			return [];
		}
		return [
			{
				id: row.id,
				employeeId: row.employeeId,
				clockInId: row.clockInId,
				clockOutId: row.clockOutId,
				startTime: row.startTime,
				endTime: row.endTime,
				durationMinutes: row.durationMinutes,
				isBillable: row.isBillable,
				skipReasons: knownSkipReasons(row.skipReasons),
			},
		];
	});
}

export interface BulkBillabilityPlanItem extends BulkBillabilityCandidate {
	outcome: BulkBillabilityOutcome;
	/**
	 * The receipt identity an apply uses for this item (only planned with
	 * `appliedBy`): the latest earlier change of this preview to replay when the
	 * work is still in the target state, else a new one.
	 */
	operationId?: string;
}

export interface BulkBillabilityPlan {
	items: BulkBillabilityPlanItem[];
	summary: BulkBillabilitySummary;
	/**
	 * Identifies the planned work and each item's outcome. The apply step plans
	 * again and only applies when this still matches what the preview showed.
	 */
	fingerprint: string;
}

function fingerprintOf(
	organizationId: string,
	request: BulkBillabilityRequest,
	items: readonly BulkBillabilityPlanItem[],
): string {
	const hash = createHash("sha256");
	hash.update(
		[
			"z8:bulk-billability:v1",
			organizationId,
			request.projectId,
			request.fromDay.toString(),
			request.toDay.toString(),
			String(request.billable),
		].join("\0"),
	);
	for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
		hash.update(`\0${item.id}:${item.outcome}`);
	}
	return hash.digest("hex");
}

/**
 * Stable receipt identity of one period's change in one applied preview by one
 * actor. `attempt` counts earlier changes of the same period by the same preview:
 * a retry after someone changed the work back changes it again (attempt + 1)
 * instead of replaying a receipt whose change no longer holds.
 */
export function bulkBillabilityOperationId(input: {
	organizationId: string;
	actorUserId: string;
	fingerprint: string;
	workPeriodId: string;
	attempt?: number;
}): string {
	const bytes = new Uint8Array(
		createHash("sha1")
			.update(
				[
					"z8:bulk-billability-operation:v1",
					input.organizationId,
					input.actorUserId,
					input.fingerprint,
					input.workPeriodId,
					// The first attempt keeps the identity receipts were recorded under.
					...(input.attempt ? [String(input.attempt)] : []),
				].join("\0"),
			)
			.digest()
			.subarray(0, 16),
	);
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Plans a bulk change: every candidate with its outcome, the counts and the
 * fingerprint. With `appliedBy` (an apply), each item also gets the receipt
 * identity to use: work this actor's earlier apply of the same preview already
 * changed (its receipt exists) counts as changed again and replays the latest
 * receipt, so a retry plans exactly what the preview showed; work changed back
 * since then is changed again under a new identity.
 */
export async function planBulkBillability(
	reader: Reader,
	organizationId: string,
	request: BulkBillabilityRequest,
	options: { appliedBy?: { actorUserId: string; fingerprint: string } } = {},
): Promise<BulkBillabilityPlan> {
	const candidates = await loadBulkBillabilityWork(reader, organizationId, request);
	const items: BulkBillabilityPlanItem[] = candidates.map((candidate) => ({
		...candidate,
		outcome: bulkBillabilityOutcome(candidate, request.billable),
	}));
	const appliedBy = options.appliedBy;
	if (appliedBy) {
		const earlier = await earlierChangeCounts(
			reader,
			organizationId,
			appliedBy,
			items.flatMap((item) =>
				item.outcome === "change" || item.outcome === "already_in_target" ? [item.id] : [],
			),
		);
		for (const item of items) {
			const changes = earlier.get(item.id) ?? 0;
			const operationId = (attempt: number) =>
				bulkBillabilityOperationId({
					organizationId,
					...appliedBy,
					workPeriodId: item.id,
					attempt,
				});
			if (item.outcome === "already_in_target" && changes > 0) {
				item.outcome = "change";
				item.operationId = operationId(changes - 1);
			} else if (item.outcome === "change") {
				item.operationId = operationId(changes);
			}
		}
	}
	return {
		items,
		summary: summarizeBulkBillability(request.billable, items),
		fingerprint: fingerprintOf(organizationId, request, items),
	};
}

/** How many changes this actor's applies of the preview committed per work period. */
async function earlierChangeCounts(
	reader: Reader,
	organizationId: string,
	appliedBy: { actorUserId: string; fingerprint: string },
	workPeriodIds: readonly string[],
): Promise<Map<string, number>> {
	if (workPeriodIds.length === 0) return new Map();
	const rows = await reader
		.select({
			workPeriodId: completedWorkOperation.workPeriodId,
			changes: sql<number>`count(*)::int`,
		})
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.organizationId, organizationId),
				eq(completedWorkOperation.actorUserId, appliedBy.actorUserId),
				eq(completedWorkOperation.writer, "work_period_attribution_edit"),
				inArray(completedWorkOperation.workPeriodId, [...workPeriodIds]),
				sql`${completedWorkOperation.command} -> 'request' ->> 'bulkBillabilityPreview' = ${appliedBy.fingerprint}`,
			),
		)
		.groupBy(completedWorkOperation.workPeriodId);
	return new Map(rows.map((row) => [row.workPeriodId, row.changes]));
}

export type BulkBillabilityApplyOutcome =
	| { status: "applied"; summary: BulkBillabilitySummary; failed: BulkBillabilityTally }
	| { status: "stale"; preview: { summary: BulkBillabilitySummary; fingerprint: string } };

export interface BulkBillabilityApplyInput {
	organizationId: string;
	actorUserId: string;
	request: BulkBillabilityRequest;
	fingerprint: string;
}

/** A skip reason found under the period's lock after the change: the change rolls back. */
class BulkBillabilitySkipped extends Error {
	constructor(readonly reason: BulkBillabilitySkipReason) {
		super(`Work is ${reason}`);
		this.name = "BulkBillabilitySkipped";
	}
}

/** The work moved off the project or was deleted while the bulk change ran. */
class BulkBillabilityWorkMoved extends Error {
	constructor() {
		super("Work changed while the bulk change ran");
		this.name = "BulkBillabilityWorkMoved";
	}
}

/**
 * Re-checks the changed period inside its transaction, after the amendment
 * locked and wrote it: still this project's undeleted work, and no skip reason
 * holds. Any finding rolls the period's change back.
 */
async function assertStillChangeable(
	scope: SealedWorkTransactionScope,
	organizationId: string,
	projectId: string,
	workPeriodId: string,
) {
	const [row] = await scope.db
		.select({
			projectId: workPeriod.projectId,
			deletedAt: workPeriod.deletedAt,
			skipReasons: skipReasonsSql(),
		})
		.from(workPeriod)
		.where(and(eq(workPeriod.id, workPeriodId), eq(workPeriod.organizationId, organizationId)));
	if (!row || row.deletedAt !== null || row.projectId !== projectId) {
		throw new BulkBillabilityWorkMoved();
	}
	const [reason] = knownSkipReasons(row.skipReasons);
	if (reason) throw new BulkBillabilitySkipped(reason);
}

/** A replayed change is reported only while the work still has the target billability. */
async function assertStillInTarget(
	scope: SealedWorkTransactionScope,
	organizationId: string,
	workPeriodId: string,
	billable: boolean,
) {
	const [row] = await scope.db
		.select({ isBillable: workPeriod.isBillable })
		.from(workPeriod)
		.where(and(eq(workPeriod.id, workPeriodId), eq(workPeriod.organizationId, organizationId)));
	if (row?.isBillable !== billable) throw new BulkBillabilityWorkMoved();
}

/**
 * Applies a previewed bulk change. Plans again; when the plan no longer matches
 * the preview's fingerprint nothing is written and the fresh plan is returned.
 * Otherwise each work period to change is an ordinary attribution amendment in
 * its own coordinated transaction (owner and actor routed, as for a single
 * change), so one period's failure never undoes another's. A period that cannot
 * change any more is counted under what it turned out to be, else as failed.
 *
 * The caller has verified that the actor is an organization admin or owner and
 * that the project belongs to the organization; the amendment verifies the
 * authority again under its locks.
 */
export async function applyBulkBillability(
	reader: Reader,
	input: BulkBillabilityApplyInput,
): Promise<BulkBillabilityApplyOutcome> {
	const { organizationId, actorUserId, request, fingerprint } = input;
	const plan = await planBulkBillability(reader, organizationId, request, {
		appliedBy: { actorUserId, fingerprint },
	});
	if (plan.fingerprint !== fingerprint) {
		return { status: "stale", preview: { summary: plan.summary, fingerprint: plan.fingerprint } };
	}

	const outcomes: { durationMinutes: number; outcome: BulkBillabilityOutcome }[] = [];
	const failed: BulkBillabilityTally = { count: 0, minutes: 0 };
	for (const item of plan.items) {
		if (item.outcome !== "change") {
			outcomes.push(item);
			continue;
		}
		const outcome = await applyOne(reader, input, item);
		if (outcome === "failed") {
			failed.count += 1;
			failed.minutes += item.durationMinutes;
		} else {
			outcomes.push({ durationMinutes: item.durationMinutes, outcome });
		}
	}
	const summary = summarizeBulkBillability(request.billable, outcomes);
	logger.info(
		{
			organizationId,
			projectId: request.projectId,
			billable: request.billable,
			changed: summary.change.count,
			failed: failed.count,
		},
		"Bulk billability change applied",
	);
	return { status: "applied", summary, failed };
}

async function applyOne(
	reader: Reader,
	input: BulkBillabilityApplyInput,
	item: BulkBillabilityPlanItem,
): Promise<BulkBillabilityOutcome | "failed"> {
	const { organizationId, actorUserId, request, fingerprint } = input;
	try {
		const disposition = await withCompletedWorkTransaction(
			{ organizationId, employeeId: item.employeeId, actorUserId },
			async (scope) => {
				const result = await setWorkPeriodBillabilityAsAdmin(scope, {
					organizationId,
					employeeId: item.employeeId,
					actorUserId,
					period: item,
					billable: request.billable,
					operationId:
						item.operationId ??
						bulkBillabilityOperationId({
							organizationId,
							actorUserId,
							fingerprint,
							workPeriodId: item.id,
						}),
					evidence: { bulkBillabilityPreview: fingerprint },
				});
				if (result === "executed") {
					await assertStillChangeable(scope, organizationId, request.projectId, item.id);
				}
				// A replay wrote nothing now; it reports the committed change only while
				// that change still holds.
				if (result === "replayed") {
					await assertStillInTarget(scope, organizationId, item.id, request.billable);
				}
				return result;
			},
		);
		return disposition === "unchanged" ? "already_in_target" : "change";
	} catch (error) {
		if (error instanceof BulkBillabilitySkipped) return error.reason;
		// The work changed since it was planned: count it as what it is now.
		const [current] = await loadBulkBillabilityWork(reader, organizationId, request, {
			periodIds: [item.id],
		}).catch(() => []);
		const outcome = current ? bulkBillabilityOutcome(current, request.billable) : null;
		if (outcome && outcome !== "change") return outcome;
		logger.warn(
			{ organizationId, workPeriodId: item.id, error },
			"Bulk billability change failed for a work period",
		);
		return "failed";
	}
}
