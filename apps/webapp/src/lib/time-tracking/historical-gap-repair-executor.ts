/**
 * Coordinated evidence-only historical gap repair (#320).
 *
 * Reading a plan is read-only and always allowed for organization operators.
 * Applying one needs the organization's separate repair authorization
 * (`historical_work_repair_control`) and runs one short transaction per employee
 * through the shared completed-work coordinator: adoption gate, organization and
 * user configuration guards, then the employee's coordination key. Under those
 * locks the executor locks the planned work rows, re-reads the employee's field,
 * absence and lineage evidence, re-plans, and continues only when the plan is
 * exactly the one the operator reviewed. Every fill is a guarded write against the
 * expected state; the work graph, its advanced revision and one receipt per repaired
 * work commit together. A repeated application finds its own receipts and returns
 * them; a changed plan stops without writing.
 *
 * Committed replay never calls this module, and the organization-wide canonical
 * backfill is not used: nothing here relinks, overwrites, deletes or rebuilds.
 */
import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { db as database } from "@/db";
import {
	completedWorkOperation,
	historicalWorkRepairControl,
	project,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workCategory,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { AppendAssuranceReport } from "./append-assurance";
import { readAppendAssurance, withAppendEvidenceSnapshot } from "./append-assurance-reader";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import {
	type GapRepairFill,
	type GapRepairUnit,
	type HistoricalGapRepairPlan,
	planHistoricalGapRepair,
	type RepairedWorkDetail,
} from "./historical-gap-repair";
import {
	assessHistoricalWork,
	type HistoricalWorkDiagnostics,
	type HistoricalWorkEvidence,
	type HistoricalWorkScope,
} from "./historical-work-diagnostics";
import {
	type HistoricalWorkEvidenceReader,
	readHistoricalWorkEvidence,
} from "./historical-work-diagnostics-reader";
import { WORK_LOCATION_TYPES, type WorkLocationType } from "./work-location";
import type { WorkTransactionClient } from "./work-transaction";

type Database = typeof database;

export const HISTORICAL_GAP_REPAIR_WRITER_VERSION = 1;
export const HISTORICAL_GAP_REPAIR_COMMAND_VERSION = 1;
export const HISTORICAL_GAP_REPAIR_RESULT_VERSION = 1;
const RECEIPT_NAMESPACE = "z8:historical-gap-repair:v1";

/** Where each filled value came from. */
const FILL_SOURCES: Record<GapRepairFill["kind"], string> = {
	canonical_record: "work_period",
	canonical_link: "time_record_same_id",
	canonical_detail: "work_period",
	canonical_completion: "work_period_and_clock_out_entry",
	canonical_duration: "work_period",
	period_completion: "time_record_and_clock_out_entry",
	period_duration: "time_record",
	canonical_metadata: "work_period",
};

export class HistoricalRepairNotAuthorizedError extends Error {
	constructor() {
		super("Historical work repair is not authorized for this organization");
		this.name = "HistoricalRepairNotAuthorizedError";
	}
}

/** A planned write found state other than the plan expected; nothing was written. */
class StaleHistoricalRepairPlanError extends Error {
	constructor(readonly workPeriodId: string) {
		super(`Historical repair plan is stale for work period ${workPeriodId}`);
		this.name = "StaleHistoricalRepairPlanError";
	}
}

export interface HistoricalGapRepairRead {
	work: HistoricalWorkDiagnostics;
	appendAssurance: Map<string, AppendAssuranceReport>;
	repair: { plan: HistoricalGapRepairPlan; authorized: boolean };
}

async function readRepairAuthorization(
	reader: HistoricalWorkEvidenceReader,
	organizationId: string,
): Promise<boolean> {
	const [control] = await reader
		.select({ mode: historicalWorkRepairControl.mode })
		.from(historicalWorkRepairControl)
		.where(eq(historicalWorkRepairControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active";
}

/** Projects and categories the evidence references that the organization owns. */
async function readOrganizationReferences(
	reader: HistoricalWorkEvidenceReader,
	organizationId: string,
	evidence: HistoricalWorkEvidence,
) {
	const projectIds = unique(evidence.periods.map((period) => period.projectId));
	const workCategoryIds = unique(evidence.periods.map((period) => period.workCategoryId));
	const owned = {
		projectIds: new Set<string>(),
		workCategoryIds: new Set<string>(),
	};
	if (projectIds.length > 0) {
		const rows = await reader
			.select({ id: project.id })
			.from(project)
			.where(and(eq(project.organizationId, organizationId), inArray(project.id, projectIds)));
		for (const row of rows) owned.projectIds.add(row.id);
	}
	if (workCategoryIds.length > 0) {
		const rows = await reader
			.select({ id: workCategory.id })
			.from(workCategory)
			.where(
				and(
					eq(workCategory.organizationId, organizationId),
					inArray(workCategory.id, workCategoryIds),
				),
			);
		for (const row of rows) owned.workCategoryIds.add(row.id);
	}
	return owned;
}

async function planFrom(
	reader: HistoricalWorkEvidenceReader,
	organizationId: string,
	scope: HistoricalWorkScope,
) {
	const evidence = await readHistoricalWorkEvidence(reader, organizationId, scope.employeeIds);
	const work = assessHistoricalWork(evidence, scope);
	const references = await readOrganizationReferences(reader, organizationId, evidence);
	return { work, plan: planHistoricalGapRepair({ evidence, report: work, references }) };
}

/**
 * Diagnostics, append assurance and the repair plan for one scope, from one
 * read-only repeatable-read snapshot. Nothing is written.
 */
export function readHistoricalGapRepairPlan(
	db: Database,
	organizationId: string,
	scope: HistoricalWorkScope,
): Promise<HistoricalGapRepairRead> {
	return withAppendEvidenceSnapshot(db, async (reader) => {
		const { work, plan } = await planFrom(reader, organizationId, scope);
		const appendAssurance = await readAppendAssurance(reader, organizationId, scope.employeeIds);
		const authorized = await readRepairAuthorization(reader, organizationId);
		return { work, appendAssurance, repair: { plan, authorized } };
	});
}

export interface ApplyHistoricalGapRepairInput {
	organizationId: string;
	/** The authenticated organization operator executing the repair. */
	actorUserId: string;
	/** The range the reviewed plan was read for. */
	range: HistoricalWorkScope["range"];
	/** The reviewed plan identity of each employee to repair. */
	expected: readonly { employeeId: string; fingerprint: string }[];
	reason: string;
}

export interface RepairReceiptSummary {
	operationId: string;
	workPeriodId: string;
	canonicalRecordId: string;
	fills: GapRepairFill["kind"][];
}

export type EmployeeRepairOutcome =
	| { employeeId: string; status: "applied"; receipts: RepairReceiptSummary[] }
	| { employeeId: string; status: "already_applied"; receipts: RepairReceiptSummary[] }
	/** Current evidence no longer yields the reviewed plan; re-read and review again. */
	| { employeeId: string; status: "stale" };

/**
 * Applies reviewed plans employee by employee. Each employee commits or rolls back
 * on its own, so one stale plan does not undo another employee's repair.
 */
export async function applyHistoricalGapRepair(
	input: ApplyHistoricalGapRepairInput,
): Promise<EmployeeRepairOutcome[]> {
	const expected = new Map(input.expected.map((item) => [item.employeeId, item.fingerprint]));
	const outcomes: EmployeeRepairOutcome[] = [];
	for (const employeeId of [...expected.keys()].toSorted()) {
		const fingerprint = expected.get(employeeId) as string;
		try {
			outcomes.push(
				await withCompletedWorkTransaction(
					{ organizationId: input.organizationId, employeeId, actorUserId: input.actorUserId },
					(scope) => {
						scope.assertEmployee(input.organizationId, employeeId);
						return repairEmployee(scope.db, scope.admission, input, employeeId, fingerprint);
					},
				),
			);
		} catch (error) {
			if (!(error instanceof StaleHistoricalRepairPlanError)) throw error;
			outcomes.push({ employeeId, status: "stale" });
		}
	}
	return outcomes;
}

async function repairEmployee(
	tx: WorkTransactionClient,
	admission: "legacy" | "append",
	input: ApplyHistoricalGapRepairInput,
	employeeId: string,
	fingerprint: string,
): Promise<EmployeeRepairOutcome> {
	if (!(await readRepairAuthorization(tx, input.organizationId))) {
		throw new HistoricalRepairNotAuthorizedError();
	}
	const scope: HistoricalWorkScope = { employeeIds: [employeeId], range: input.range };

	// Lock the planned rows in table/ID order, then re-read and re-plan under them.
	const preliminary = await planFrom(tx, input.organizationId, scope);
	const lockedUnits = preliminary.plan.employees.find((plan) => plan.employeeId === employeeId);
	if (lockedUnits) await lockWorkRows(tx, input.organizationId, lockedUnits.units);

	const { plan } = await planFrom(tx, input.organizationId, scope);
	const current = plan.employees.find((employeePlan) => employeePlan.employeeId === employeeId);
	if (!current || current.fingerprint !== fingerprint) {
		const replayed = await committedReceipts(tx, input.organizationId, employeeId, fingerprint);
		if (replayed.length > 0) return { employeeId, status: "already_applied", receipts: replayed };
		return { employeeId, status: "stale" };
	}

	const executedAt = systemClock.nowInstant();
	const receipts: RepairReceiptSummary[] = [];
	for (const unit of current.units) {
		receipts.push(
			await applyUnit(tx, {
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				reason: input.reason,
				range: input.range,
				admission,
				planFingerprint: fingerprint,
				executedAt,
				unit,
			}),
		);
	}
	return { employeeId, status: "applied", receipts };
}

async function lockWorkRows(
	tx: WorkTransactionClient,
	organizationId: string,
	units: readonly GapRepairUnit[],
) {
	const periodIds = units.map((unit) => unit.workPeriodId).toSorted();
	await tx
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(and(eq(workPeriod.organizationId, organizationId), inArray(workPeriod.id, periodIds)))
		.orderBy(workPeriod.id)
		.for("update");
	const recordIds = units
		.flatMap((unit) => (unit.expected.record ? [unit.expected.record.id] : []))
		.toSorted();
	if (recordIds.length === 0) return;
	await tx
		.select({ id: timeRecord.id })
		.from(timeRecord)
		.where(and(eq(timeRecord.organizationId, organizationId), inArray(timeRecord.id, recordIds)))
		.orderBy(timeRecord.id)
		.for("update");
}

async function committedReceipts(
	tx: WorkTransactionClient,
	organizationId: string,
	employeeId: string,
	fingerprint: string,
): Promise<RepairReceiptSummary[]> {
	const rows = await tx
		.select({ id: completedWorkOperation.id, result: completedWorkOperation.result })
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.organizationId, organizationId),
				eq(completedWorkOperation.employeeId, employeeId),
				eq(completedWorkOperation.kind, "repair_historical_gap"),
				sql`${completedWorkOperation.command}->>'planFingerprint' = ${fingerprint}`,
			),
		)
		.orderBy(completedWorkOperation.workPeriodId);
	return rows.map((row) => {
		const result = row.result as {
			workPeriodId: string;
			canonicalRecordId: string;
			fills: GapRepairFill[];
		};
		return {
			operationId: row.id,
			workPeriodId: result.workPeriodId,
			canonicalRecordId: result.canonicalRecordId,
			fills: result.fills.map((fill) => fill.kind),
		};
	});
}

interface UnitContext {
	organizationId: string;
	actorUserId: string;
	reason: string;
	range: HistoricalWorkScope["range"];
	admission: "legacy" | "append";
	planFingerprint: string;
	executedAt: Temporal.Instant;
	unit: GapRepairUnit;
}

/** Requires exactly one affected row; anything else means the expected state moved. */
function expectOne(rows: readonly unknown[], unit: GapRepairUnit) {
	if (rows.length !== 1) throw new StaleHistoricalRepairPlanError(unit.workPeriodId);
}

async function applyUnit(tx: WorkTransactionClient, context: UnitContext) {
	const { organizationId, unit } = context;
	const executedAt = dateFromInstant(context.executedAt);
	const recordId = unit.canonicalRecordId;
	const expectedRecord = unit.expected.record;
	const periodSet: Partial<typeof workPeriod.$inferInsert> = {};
	const periodGuards: SQL[] = [];

	for (const fill of unit.fills) {
		switch (fill.kind) {
			case "canonical_record": {
				if (unit.originalActor.kind !== "human") {
					throw new StaleHistoricalRepairPlanError(unit.workPeriodId);
				}
				// A record another writer created under this ID meanwhile is a stale plan.
				const inserted = await tx
					.insert(timeRecord)
					.values({
						id: fill.recordId,
						organizationId,
						employeeId: unit.employeeId,
						recordKind: "work",
						startAt: dateFromInstant(parseInstant(fill.record.startAt)),
						endAt: dateFromInstant(parseInstant(fill.record.endAt)),
						durationMinutes: fill.record.durationMinutes,
						approvalState: fill.record.approvalState,
						// A representation created by a system process; its creator is the
						// human the completing entry evidences.
						origin: "system",
						createdBy: unit.originalActor.userId,
						// The repair wrote this row: its executor is the updater.
						updatedAt: executedAt,
						updatedBy: context.actorUserId,
					})
					.onConflictDoNothing()
					.returning({ id: timeRecord.id });
				expectOne(inserted, unit);
				await insertDetail(tx, organizationId, fill.recordId, fill.detail, unit);
				if (fill.projectId) await insertProject(tx, organizationId, fill.recordId, fill.projectId);
				periodSet.canonicalRecordId = fill.recordId;
				periodGuards.push(isNull(workPeriod.canonicalRecordId));
				break;
			}
			case "canonical_link":
				periodSet.canonicalRecordId = fill.recordId;
				periodGuards.push(isNull(workPeriod.canonicalRecordId));
				break;
			case "canonical_detail":
				await insertDetail(tx, organizationId, fill.recordId, fill.detail, unit);
				if (fill.projectId) await insertProject(tx, organizationId, fill.recordId, fill.projectId);
				break;
			case "canonical_completion": {
				if (!expectedRecord) throw new StaleHistoricalRepairPlanError(unit.workPeriodId);
				expectOne(
					await tx
						.update(timeRecord)
						.set({
							endAt: dateFromInstant(parseInstant(fill.endAt)),
							...(fill.durationMinutes === null ? {} : { durationMinutes: fill.durationMinutes }),
							updatedAt: executedAt,
							updatedBy: context.actorUserId,
						})
						.where(
							and(
								recordTarget(organizationId, unit, fill.recordId),
								isNull(timeRecord.endAt),
								eq(timeRecord.startAt, dateFromInstant(parseInstant(expectedRecord.startAt))),
								fill.durationMinutes === null
									? eq(timeRecord.durationMinutes, expectedRecord.durationMinutes ?? -1)
									: isNull(timeRecord.durationMinutes),
							),
						)
						.returning({ id: timeRecord.id }),
					unit,
				);
				break;
			}
			case "canonical_duration":
				expectOne(
					await tx
						.update(timeRecord)
						.set({
							durationMinutes: fill.durationMinutes,
							updatedAt: executedAt,
							updatedBy: context.actorUserId,
						})
						.where(
							and(
								recordTarget(organizationId, unit, fill.recordId),
								isNull(timeRecord.durationMinutes),
							),
						)
						.returning({ id: timeRecord.id }),
					unit,
				);
				break;
			case "period_completion":
				periodSet.endTime = dateFromInstant(parseInstant(fill.endTime));
				periodGuards.push(isNull(workPeriod.endTime), eq(workPeriod.isActive, false));
				if (fill.durationMinutes !== null) {
					periodSet.durationMinutes = fill.durationMinutes;
					periodGuards.push(isNull(workPeriod.durationMinutes));
				}
				break;
			case "period_duration":
				periodSet.durationMinutes = fill.durationMinutes;
				periodGuards.push(isNull(workPeriod.durationMinutes));
				break;
			case "canonical_metadata":
				if (fill.field === "project") {
					await insertProject(tx, organizationId, fill.recordId, fill.value);
					break;
				}
				expectOne(
					await tx
						.update(timeRecordWork)
						.set(
							fill.field === "work_category"
								? { workCategoryId: fill.value }
								: { workLocationType: workLocationTypeOf(fill.value, unit) },
						)
						.where(
							and(
								eq(timeRecordWork.recordId, fill.recordId),
								eq(timeRecordWork.organizationId, organizationId),
								fill.field === "work_category"
									? isNull(timeRecordWork.workCategoryId)
									: isNull(timeRecordWork.workLocationType),
							),
						)
						.returning({ recordId: timeRecordWork.recordId }),
					unit,
				);
				break;
		}
	}

	// The revision advance proves the period is unchanged since planning and commits
	// every period fill with it.
	const sourceRevision = unit.expected.period.graphRevision;
	expectOne(
		await tx
			.update(workPeriod)
			.set({ ...periodSet, graphRevision: sourceRevision + 1 })
			.where(
				and(
					eq(workPeriod.id, unit.workPeriodId),
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, unit.employeeId),
					eq(workPeriod.graphRevision, sourceRevision),
					isNull(workPeriod.deletedAt),
					...periodGuards,
				),
			)
			.returning({ id: workPeriod.id }),
		unit,
	);

	const operationId = uuidFromDigest(
		[RECEIPT_NAMESPACE, organizationId, unit.workPeriodId, unit.fingerprint].join("|"),
	);
	const executor = {
		kind: "human" as const,
		userId: context.actorUserId,
		executedAt: context.executedAt.toString(),
	};
	await tx.insert(completedWorkOperation).values({
		id: operationId,
		organizationId,
		employeeId: unit.employeeId,
		kind: "repair_historical_gap",
		writer: "historical_gap_repair",
		writerVersion: HISTORICAL_GAP_REPAIR_WRITER_VERSION,
		commandVersion: HISTORICAL_GAP_REPAIR_COMMAND_VERSION,
		command: {
			version: HISTORICAL_GAP_REPAIR_COMMAND_VERSION,
			planFingerprint: context.planFingerprint,
			unitFingerprint: unit.fingerprint,
			range: {
				start: context.range.start.toString(),
				endExclusive: context.range.endExclusive.toString(),
			},
			reason: context.reason,
		},
		appendAdmission: context.admission,
		// The operation's actor is its executor; the original actor is in the result.
		actorKind: "human",
		actorUserId: context.actorUserId,
		workPeriodId: unit.workPeriodId,
		resultVersion: HISTORICAL_GAP_REPAIR_RESULT_VERSION,
		result: {
			version: HISTORICAL_GAP_REPAIR_RESULT_VERSION,
			disposition: "executed",
			workPeriodId: unit.workPeriodId,
			canonicalRecordId: recordId,
			originalActor: unit.originalActor,
			executor,
			reason: context.reason,
			fills: unit.fills,
			evidence: {
				findingIds: unit.fills.map((fill) => fill.findingId),
				expected: unit.expected,
				sources: unit.fills.map((fill) => ({ fill: fill.kind, source: FILL_SOURCES[fill.kind] })),
			},
			revisions: { workPeriod: { source: sourceRevision, result: sourceRevision + 1 } },
		},
	});
	return {
		operationId,
		workPeriodId: unit.workPeriodId,
		canonicalRecordId: recordId,
		fills: unit.fills.map((fill) => fill.kind),
	};
}

function recordTarget(organizationId: string, unit: GapRepairUnit, recordId: string) {
	return and(
		eq(timeRecord.id, recordId),
		eq(timeRecord.organizationId, organizationId),
		eq(timeRecord.employeeId, unit.employeeId),
		eq(timeRecord.recordKind, "work"),
	);
}

async function insertDetail(
	tx: WorkTransactionClient,
	organizationId: string,
	recordId: string,
	detail: RepairedWorkDetail,
	unit: GapRepairUnit,
) {
	expectOne(
		await tx
			.insert(timeRecordWork)
			.values({
				recordId,
				organizationId,
				recordKind: "work",
				workCategoryId: detail.workCategoryId,
				workLocationType:
					detail.workLocationType === null
						? null
						: workLocationTypeOf(detail.workLocationType, unit),
				computationMetadata: null,
			})
			.onConflictDoNothing()
			.returning({ recordId: timeRecordWork.recordId }),
		unit,
	);
}

/** Adds the project allocation only while the record has none (checked under its row lock). */
async function insertProject(
	tx: WorkTransactionClient,
	organizationId: string,
	recordId: string,
	projectId: string,
) {
	const existing = await tx
		.select({ id: timeRecordAllocation.id })
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.organizationId, organizationId),
				eq(timeRecordAllocation.recordId, recordId),
				eq(timeRecordAllocation.allocationKind, "project"),
			),
		)
		.limit(1);
	if (existing.length > 0) throw new StaleHistoricalRepairPlanError(recordId);
	await tx.insert(timeRecordAllocation).values({
		organizationId,
		recordId,
		allocationKind: "project",
		projectId,
		weightPercent: 100,
	});
}

/** A stored location outside the enum cannot be written back; the plan is stale. */
function workLocationTypeOf(value: string, unit: GapRepairUnit): WorkLocationType {
	if (!(WORK_LOCATION_TYPES as readonly string[]).includes(value)) {
		throw new StaleHistoricalRepairPlanError(unit.workPeriodId);
	}
	return value as WorkLocationType;
}

function uuidFromDigest(value: string): string {
	const bytes = new Uint8Array(createHash("sha1").update(value).digest().subarray(0, 16));
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function unique(values: readonly (string | null)[]): string[] {
	return [...new Set(values.filter((value): value is string => value !== null))];
}
