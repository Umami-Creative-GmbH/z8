import { and, asc, eq, inArray, isNotNull, isNull, ne, notExists, or } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import {
	applyWorkRecordChange,
	isWorkRecordRefusal,
	pruneOrphanedWorkRecord,
	readWorkRecord,
	type WorkRecordRefusal,
} from "./work-records";

export const ANOMALY_CATEGORIES = [
	"missing-end-at",
	"orphaned-pending",
	"unlinked-records",
] as const;

export type AnomalyCategory = (typeof ANOMALY_CATEGORIES)[number];

export interface AnomalyRepairAction {
	category: AnomalyCategory;
	employeeId: string;
	workPeriodId?: string;
	recordId: string;
	startAt: string;
	endAt?: string | null;
	detail: string;
}

export interface AnomalySkipEntry {
	category: AnomalyCategory;
	employeeId: string;
	workPeriodId?: string;
	recordId?: string;
	startAt: string;
	reason: string;
}

export interface AnomalyFailureEntry {
	category: AnomalyCategory;
	employeeId: string;
	workPeriodId?: string;
	recordId?: string;
	startAt: string;
	error: string;
}

export interface OrganizationAnomalyRepairReport {
	organizationId: string;
	scanned: Record<AnomalyCategory, number>;
	repaired: AnomalyRepairAction[];
	skipped: AnomalySkipEntry[];
	failed: AnomalyFailureEntry[];
}

export interface RepairWorkRecordsAnomaliesOptions {
	/** When false (default), reports planned repairs without writing anything. */
	apply: boolean;
	/** Restrict repair to these organizations; omit to scan all active organizations. */
	organizationIds?: readonly string[];
	/** Which anomaly categories to inspect/repair; defaults to all three. */
	categories?: readonly AnomalyCategory[];
}

function formatRefusal(refusal: WorkRecordRefusal): string {
	switch (refusal.kind) {
		case "month_closed":
			return `month_closed (${refusal.month})`;
		case "canonical_divergence":
			return `canonical_divergence (${refusal.disagreements.join(", ")})`;
		case "attribution_unrepresentable":
			return `attribution_unrepresentable (${refusal.reason})`;
		default:
			return refusal.kind;
	}
}

/**
 * Inspects and (when `apply` is true) canonically repairs three historical
 * work-record anomaly classes, one record/period per coordinated work transaction:
 *
 * 1. `missing-end-at`: linked closed `work_period` whose canonical `time_record`
 *    still has `end_at IS NULL` -> repaired through `work-records/repair.ts`.
 * 2. `orphaned-pending`: closed `work_period` stuck in `approval_status = 'pending'`
 *    and/or `pending_changes IS NOT NULL` with `approval_workflow_id IS NULL` and
 *    zero pending `approval_request` or `approval_workflow` rows -> finalized to
 *    `approved` (clearing `pending_changes`) through `work-records/amend.ts`.
 * 3. `unlinked-records`: unreferenced `time_record` (`record_kind = 'work'`) rows
 *    not linked by any `work_period`, `approval_request`, or approval decision
 *    whose employee already has an undeleted linked `work_period` at the same
 *    start instant -> pruned through `work-records/prune-orphaned-records.ts`.
 */
export async function repairWorkRecordsAnomalies(
	database: typeof db,
	options: RepairWorkRecordsAnomaliesOptions,
): Promise<OrganizationAnomalyRepairReport[]> {
	const enabled = new Set<AnomalyCategory>(options.categories ?? ANOMALY_CATEGORIES);

	const organizations = await database
		.select({ id: organization.id })
		.from(organization)
		.where(
			and(
				isNull(organization.deletedAt),
				options.organizationIds && options.organizationIds.length > 0
					? inArray(organization.id, [...options.organizationIds])
					: undefined,
			),
		)
		.orderBy(asc(organization.id));

	const reports: OrganizationAnomalyRepairReport[] = [];

	for (const org of organizations) {
		const report: OrganizationAnomalyRepairReport = {
			organizationId: org.id,
			scanned: {
				"missing-end-at": 0,
				"orphaned-pending": 0,
				"unlinked-records": 0,
			},
			repaired: [],
			skipped: [],
			failed: [],
		};

		if (enabled.has("missing-end-at")) {
			await processMissingEndAt(database, org.id, options.apply, report);
		}
		if (enabled.has("orphaned-pending")) {
			await processOrphanedPending(database, org.id, options.apply, report);
		}
		if (enabled.has("unlinked-records")) {
			await processUnlinkedRecords(database, org.id, options.apply, report);
		}

		reports.push(report);
	}

	return reports;
}

async function processMissingEndAt(
	database: typeof db,
	organizationId: string,
	apply: boolean,
	report: OrganizationAnomalyRepairReport,
): Promise<void> {
	const candidates = await database
		.select({
			workPeriodId: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			recordId: timeRecord.id,
			recordStartAt: timeRecord.startAt,
			recordDurationMinutes: timeRecord.durationMinutes,
		})
		.from(workPeriod)
		.innerJoin(
			timeRecord,
			and(
				eq(timeRecord.id, workPeriod.canonicalRecordId),
				eq(timeRecord.organizationId, workPeriod.organizationId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				isNull(workPeriod.deletedAt),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.clockOutId),
				isNull(timeRecord.endAt),
			),
		)
		.orderBy(asc(workPeriod.employeeId), asc(workPeriod.startTime), asc(workPeriod.id));

	report.scanned["missing-end-at"] = candidates.length;

	for (const row of candidates) {
		const start = instantFromDate(row.startTime);
		const startAt = instantToCanonicalString(start);
		if (!row.endTime || row.durationMinutes === null) {
			report.skipped.push({
				category: "missing-end-at",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId: row.recordId,
				startAt,
				reason: "period_missing_end_or_duration",
			});
			continue;
		}
		const end = instantFromDate(row.endTime);
		const endAt = instantToCanonicalString(end);
		if (compareInstants(instantFromDate(row.recordStartAt), start) !== 0) {
			report.skipped.push({
				category: "missing-end-at",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId: row.recordId,
				startAt,
				reason: "start_time_mismatch",
			});
			continue;
		}
		if (
			row.recordDurationMinutes !== null &&
			row.recordDurationMinutes !== row.durationMinutes
		) {
			report.skipped.push({
				category: "missing-end-at",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId: row.recordId,
				startAt,
				reason: `duration_mismatch (period=${row.durationMinutes}, record=${row.recordDurationMinutes})`,
			});
			continue;
		}

		if (!apply) {
			report.repaired.push({
				category: "missing-end-at",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId: row.recordId,
				startAt,
				endAt,
				detail: `set time_record.end_at=${endAt} (${row.durationMinutes}m)`,
			});
			continue;
		}

		try {
			const outcome = await withCompletedWorkTransaction(
				{ organizationId, employeeId: row.employeeId, actorUserId: null },
				async (scope) => {
					const loaded = await readWorkRecord(
						scope,
						{ organizationId, employeeId: row.employeeId, workPeriodId: row.workPeriodId },
						{ lock: true },
					);
					if (!loaded?.canonical || loaded.period.endTime === null || loaded.period.durationMinutes === null) {
						return { kind: "skipped" as const, reason: "period_or_canonical_unavailable" };
					}
					if (loaded.canonical.record.endAt !== null) {
						return { kind: "skipped" as const, reason: "already_repaired" };
					}
					const lockedStart = instantFromDate(loaded.period.startTime);
					const lockedEnd = instantFromDate(loaded.period.endTime);
					const result = await applyWorkRecordChange(scope, {
						kind: "repair",
						organizationId,
						employeeId: row.employeeId,
						expected: loaded.expected,
						resolution: {
							startAt: lockedStart,
							endAt: lockedEnd,
							durationMinutes: loaded.period.durationMinutes,
						},
						actorUserId: null,
					});
					if (isWorkRecordRefusal(result)) {
						return { kind: "skipped" as const, reason: formatRefusal(result) };
					}
					return {
						kind: "repaired" as const,
						endAt: result.segment.endAt,
						durationMinutes: result.segment.durationMinutes,
					};
				},
			);

			if (outcome.kind === "skipped") {
				report.skipped.push({
					category: "missing-end-at",
					employeeId: row.employeeId,
					workPeriodId: row.workPeriodId,
					recordId: row.recordId,
					startAt,
					reason: outcome.reason,
				});
			} else {
				report.repaired.push({
					category: "missing-end-at",
					employeeId: row.employeeId,
					workPeriodId: row.workPeriodId,
					recordId: row.recordId,
					startAt,
					endAt: outcome.endAt,
					detail: `set time_record.end_at=${outcome.endAt} (${outcome.durationMinutes}m)`,
				});
			}
		} catch (error) {
			report.failed.push({
				category: "missing-end-at",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId: row.recordId,
				startAt,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

async function processOrphanedPending(
	database: typeof db,
	organizationId: string,
	apply: boolean,
	report: OrganizationAnomalyRepairReport,
): Promise<void> {
	const candidates = await database
		.select({
			workPeriodId: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			approvalStatus: workPeriod.approvalStatus,
			hasPendingChanges: isNotNull(workPeriod.pendingChanges),
			canonicalRecordId: workPeriod.canonicalRecordId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				isNull(workPeriod.deletedAt),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.canonicalRecordId),
				isNull(workPeriod.approvalWorkflowId),
				or(eq(workPeriod.approvalStatus, "pending"), isNotNull(workPeriod.pendingChanges)),
				notExists(
					database
						.select({ id: approvalRequest.id })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, workPeriod.organizationId),
								eq(approvalRequest.status, "pending"),
								or(
									and(
										eq(approvalRequest.entityType, "time_entry"),
										eq(approvalRequest.entityId, workPeriod.id),
									),
									eq(approvalRequest.canonicalRecordId, workPeriod.canonicalRecordId),
								),
							),
						),
				),
				notExists(
					database
						.select({ id: approvalWorkflow.id })
						.from(approvalWorkflow)
						.where(
							and(
								eq(approvalWorkflow.organizationId, workPeriod.organizationId),
								eq(approvalWorkflow.sourceType, "time_entry"),
								eq(approvalWorkflow.sourceId, workPeriod.id),
							),
						),
				),
			),
		)
		.orderBy(asc(workPeriod.employeeId), asc(workPeriod.startTime), asc(workPeriod.id));

	report.scanned["orphaned-pending"] = candidates.length;

	for (const row of candidates) {
		const startAt = instantToCanonicalString(instantFromDate(row.startTime));
		const endAt = row.endTime ? instantToCanonicalString(instantFromDate(row.endTime)) : null;
		const recordId = row.canonicalRecordId as string;

		if (row.approvalStatus !== "pending") {
			report.skipped.push({
				category: "orphaned-pending",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId,
				startAt,
				reason: `unexpected_approval_status (${row.approvalStatus})`,
			});
			continue;
		}

		if (!apply) {
			report.repaired.push({
				category: "orphaned-pending",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId,
				startAt,
				endAt,
				detail: "set approval_status=approved, time_record.approval_state=approved, clear pending_changes",
			});
			continue;
		}

		try {
			const outcome = await withCompletedWorkTransaction(
				{ organizationId, employeeId: row.employeeId, actorUserId: null },
				async (scope) => {
					const tx = scope.db;
					const loaded = await readWorkRecord(
						scope,
						{ organizationId, employeeId: row.employeeId, workPeriodId: row.workPeriodId },
						{ lock: true },
					);
					if (!loaded?.canonical) {
						return { kind: "skipped" as const, reason: "period_or_canonical_unavailable" };
					}
					if (loaded.period.approvalWorkflowId !== null) {
						return { kind: "skipped" as const, reason: "has_approval_workflow" };
					}
					if (loaded.period.approvalStatus !== "pending") {
						return { kind: "skipped" as const, reason: "already_decided" };
					}
					const [pendingRequest] = await tx
						.select({ id: approvalRequest.id })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, organizationId),
								eq(approvalRequest.status, "pending"),
								or(
									and(
										eq(approvalRequest.entityType, "time_entry"),
										eq(approvalRequest.entityId, row.workPeriodId),
									),
									eq(approvalRequest.canonicalRecordId, loaded.canonical.record.id),
								),
							),
						)
						.limit(1);
					if (pendingRequest) {
						return { kind: "skipped" as const, reason: "has_pending_approval_request" };
					}
					const [workflow] = await tx
						.select({ id: approvalWorkflow.id })
						.from(approvalWorkflow)
						.where(
							and(
								eq(approvalWorkflow.organizationId, organizationId),
								eq(approvalWorkflow.sourceType, "time_entry"),
								eq(approvalWorkflow.sourceId, row.workPeriodId),
							),
						)
						.limit(1);
					if (workflow) {
						return { kind: "skipped" as const, reason: "has_approval_workflow" };
					}

					const result = await applyWorkRecordChange(scope, {
						kind: "amend",
						organizationId,
						employeeId: row.employeeId,
						expected: loaded.expected,
						approval: "approved",
						toleratedDrift: ["interval", "duration"],
						actorUserId: null,
					});
					if (isWorkRecordRefusal(result)) {
						return { kind: "skipped" as const, reason: formatRefusal(result) };
					}
					return { kind: "repaired" as const };
				},
			);

			if (outcome.kind === "skipped") {
				report.skipped.push({
					category: "orphaned-pending",
					employeeId: row.employeeId,
					workPeriodId: row.workPeriodId,
					recordId,
					startAt,
					reason: outcome.reason,
				});
			} else {
				report.repaired.push({
					category: "orphaned-pending",
					employeeId: row.employeeId,
					workPeriodId: row.workPeriodId,
					recordId,
					startAt,
					endAt,
					detail: "set approval_status=approved, time_record.approval_state=approved, clear pending_changes",
				});
			}
		} catch (error) {
			report.failed.push({
				category: "orphaned-pending",
				employeeId: row.employeeId,
				workPeriodId: row.workPeriodId,
				recordId,
				startAt,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

async function processUnlinkedRecords(
	database: typeof db,
	organizationId: string,
	apply: boolean,
	report: OrganizationAnomalyRepairReport,
): Promise<void> {
	const candidates = await database
		.select({
			recordId: timeRecord.id,
			employeeId: timeRecord.employeeId,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			durationMinutes: timeRecord.durationMinutes,
			approvalState: timeRecord.approvalState,
			origin: timeRecord.origin,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "work"),
				notExists(
					database
						.select({ id: workPeriod.id })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, timeRecord.organizationId),
								eq(workPeriod.canonicalRecordId, timeRecord.id),
							),
						),
				),
			),
		)
		.orderBy(asc(timeRecord.employeeId), asc(timeRecord.startAt), asc(timeRecord.id));

	report.scanned["unlinked-records"] = candidates.length;

	for (const row of candidates) {
		const startAt = instantToCanonicalString(instantFromDate(row.startAt));
		const endAt = row.endAt ? instantToCanonicalString(instantFromDate(row.endAt)) : null;

		if (!apply) {
			const [referencingApproval] = await database
				.select({ id: approvalRequest.id })
				.from(approvalRequest)
				.where(
					and(
						eq(approvalRequest.organizationId, organizationId),
						eq(approvalRequest.canonicalRecordId, row.recordId),
					),
				)
				.limit(1);
			if (referencingApproval) {
				report.skipped.push({
					category: "unlinked-records",
					employeeId: row.employeeId,
					recordId: row.recordId,
					startAt,
					reason: "still_referenced (approval_request)",
				});
				continue;
			}

			const [referencingDecision] = await database
				.select({ id: timeRecordApprovalDecision.id })
				.from(timeRecordApprovalDecision)
				.where(
					and(
						eq(timeRecordApprovalDecision.organizationId, organizationId),
						eq(timeRecordApprovalDecision.recordId, row.recordId),
					),
				)
				.limit(1);
			if (referencingDecision) {
				report.skipped.push({
					category: "unlinked-records",
					employeeId: row.employeeId,
					recordId: row.recordId,
					startAt,
					reason: "still_referenced (approval_decision)",
				});
				continue;
			}

			const [replacement] = await database
				.select({ id: workPeriod.id })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.employeeId, row.employeeId),
						eq(workPeriod.startTime, row.startAt),
						isNull(workPeriod.deletedAt),
						isNotNull(workPeriod.canonicalRecordId),
						ne(workPeriod.canonicalRecordId, row.recordId),
					),
				)
				.limit(1);
			if (!replacement) {
				report.skipped.push({
					category: "unlinked-records",
					employeeId: row.employeeId,
					recordId: row.recordId,
					startAt,
					reason: "no_linked_replacement",
				});
				continue;
			}

			report.repaired.push({
				category: "unlinked-records",
				employeeId: row.employeeId,
				workPeriodId: replacement.id,
				recordId: row.recordId,
				startAt,
				endAt,
				detail: `prune unlinked ${row.origin}/${row.approvalState} duplicate (replaced by period ${replacement.id})`,
			});
			continue;
		}

		try {
			const outcome = await withCompletedWorkTransaction(
				{ organizationId, employeeId: row.employeeId, actorUserId: null },
				(scope) =>
					pruneOrphanedWorkRecord(scope, {
						organizationId,
						employeeId: row.employeeId,
						recordId: row.recordId,
					}),
			);

			if (outcome.kind === "pruned") {
				report.repaired.push({
					category: "unlinked-records",
					employeeId: row.employeeId,
					recordId: row.recordId,
					startAt: outcome.startAt,
					endAt: outcome.endAt,
					detail: `pruned unlinked ${outcome.origin}/${outcome.approvalState} duplicate`,
				});
			} else {
				const reason =
					outcome.kind === "still_referenced"
						? `still_referenced (${outcome.by})`
						: outcome.kind === "month_closed"
							? `month_closed (${outcome.month})`
							: outcome.kind;
				report.skipped.push({
					category: "unlinked-records",
					employeeId: row.employeeId,
					recordId: row.recordId,
					startAt,
					reason,
				});
			}
		} catch (error) {
			report.failed.push({
				category: "unlinked-records",
				employeeId: row.employeeId,
				recordId: row.recordId,
				startAt,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
