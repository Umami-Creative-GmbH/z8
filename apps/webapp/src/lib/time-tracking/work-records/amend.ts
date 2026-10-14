import "server-only";

/**
 * Amending completed work (ADR 0010, #1225): new times, a work attribution
 * patch or both, written to the work period and its canonical work record
 * together in either admission's entry writer, in one revision step, with the
 * effects of the change. Runs on a sealed work-transaction scope only; it never
 * opens a transaction and never takes guards.
 *
 * Every refusal is decided before the first write, so a refused amendment
 * writes nothing. A pair that still disagrees after the writes is a defect in
 * work records, not in the data: it throws and the transaction rolls back.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { CompletedWorkIntegrityError } from "../close-active-work";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import {
	assertBillableAllowed,
	projectBillableDefault,
	readProjectBillability,
} from "../work-billability";
import { loadWorkOccupants } from "../work-occupancy";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import {
	type AmendedEndpoint,
	type AmendmentChanges,
	type AmendWorkRecord,
	isAdoptedEndpoint,
	type NewAmendedEndpoint,
} from "./amend-change";
import type { AmendmentPlan } from "./amend-plan";
import type { WorkRecordExpected, WorkRecordRefusal } from "./change";
import type { AppendedEntryEvidence } from "./divide";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { type EntryDraft, entryWriterFor } from "./entry-writer";
import { planChange } from "./plan";
import { expectedOf, matchesExpected, pairOf } from "./read";
import { recordAgreement } from "./record-agreement";
import {
	type CanonicalWorkRows,
	selectWorkRecordRows,
	type TimeEntryRow,
	type WorkPeriodRow,
	type WorkRecordRows,
} from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import {
	type CanonicalAllocationShape,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

/** One correction entry an amendment appended or adopted, with the endpoint it replaces. */
export type AmendedEntryEvidence = AppendedEntryEvidence & {
	endpoint: "clock_in" | "clock_out";
	replacesEntryId: string;
	/** Whether the entry was already recorded and adopted by reference (#1226). */
	adopted: boolean;
};

export type WorkAmendment = {
	kind: "amended";
	/** The work exactly as it was locked. */
	source: {
		segment: WorkSegment;
		revision: number;
		approvalState: WorkPeriodRow["approvalStatus"];
		recordApprovalState: CanonicalWorkRows["record"]["approvalState"];
	};
	/** The amended work. */
	segment: WorkSegment;
	/** The new expected state: name it to chain a further change. */
	after: WorkRecordExpected;
	changes: AmendmentChanges;
	appended: {
		admission: "append" | "legacy";
		/** Clock-in first; empty when the times stayed. */
		corrections: AmendedEntryEvidence[];
		/** The rows of `corrections`, in the same order. */
		entries: TimeEntryRow[];
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function amendWorkRecord(
	scope: SealedWorkTransactionScope,
	change: AmendWorkRecord,
): Promise<WorkAmendment | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const workPeriodId = change.expected.workPeriodId;
	const locked = await selectWorkRecordRows(
		tx,
		{ organizationId, employeeId, workPeriodId },
		{ lock: true },
	);
	if (!locked) return { kind: "not_found", workPeriodId };
	const { period, clockIn, clockOut, canonical } = locked;
	if (!matchesExpected(change.expected, period)) {
		return { kind: "stale", current: { revision: period.graphRevision } };
	}
	if (period.isActive || !period.endTime || !period.clockOutId) return { kind: "work_running" };
	if (!clockIn || !clockOut) return { kind: "endpoint_entry_missing" };

	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.times?.appendOperation ?? "completed_work_correction",
	});
	// In append admission a superseded endpoint was corrected by someone else. In
	// legacy admission a split's generated half keeps the source clock-out its
	// new clock-out superseded (#1219): it still ends that half, so it is amendable.
	if (writer.admission === "append" && (clockIn.isSuperseded || clockOut.isSuperseded)) {
		return { kind: "endpoint_superseded" };
	}
	const endpoints = await resolvedEndpoints(tx, change, { clockIn, clockOut });
	if (endpoints === "adopted_entry_mismatch") return { kind: "adopted_entry_mismatch" };
	const patch = await resolvedPatch(tx, change, WorkAttribution.fromWorkPeriod(period));
	const plan = planChange(
		pairOf(locked),
		{
			kind: "amend",
			times: {
				...(endpoints.clockIn ? { clockIn: { at: endpoints.clockIn.at } } : {}),
				...(endpoints.clockOut ? { clockOut: { at: endpoints.clockOut.at } } : {}),
			},
			attribution: patch,
		},
		writer.durationArithmetic,
	);
	if (plan.kind !== "amend") return plan;
	if (!canonical) return { kind: "canonical_record_missing" };

	// What the database says against the plan.
	const before = {
		startAt: instantFromDate(period.startTime),
		endAt: instantFromDate(period.endTime),
	};
	const after = plan.result;
	const timesChanged = plan.changes.clockIn || plan.changes.clockOut;
	if (timesChanged) {
		const occupants = await loadWorkOccupants(tx, {
			organizationId,
			employeeId,
			interval: { startAt: after.startAt, endAt: after.endAt },
			excludeWorkPeriodIds: [period.id],
		});
		if (occupants.length > 0) return { kind: "work_occupied", occupants };
	}
	// Work and attribution touching a closed month are frozen, before or after the change (#762).
	const closed = closedRangeTouchedByWork(
		[
			{ start: before.startAt, end: before.endAt },
			{ start: after.startAt, end: after.endAt },
		],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };
	const moved = movedEndpoints(change, plan, endpoints, { clockIn, clockOut });
	const drafts = moved.flatMap((endpoint) => (endpoint.draft ? [endpoint.draft] : []));
	// Adopted entries are already recorded; only new ones need the admission.
	const admission = drafts.length > 0 ? await writer.admit() : null;
	if (admission?.kind === "review_required") {
		return { kind: "append_review_required", requirement: admission.requirement };
	}

	// Writes: nothing below refuses.
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: change.actorUserId,
		before: [{ start: before.startAt, end: before.endAt }],
		after: [{ start: after.startAt, end: after.endAt }],
	});
	const appended = admission ? await admission.entries.append(drafts) : [];
	if (appended.length !== drafts.length) {
		throw new Error("Work records corrections were not appended");
	}
	const corrections: { endpoint: AmendedEntryEvidence["endpoint"]; entry: TimeEntryRow }[] = [];
	for (const endpoint of moved) {
		const entry = endpoint.adopted
			? await adoptRecordedEntry(tx, endpoint.adopted, endpoint.replaces)
			: appended[drafts.indexOf(endpoint.draft as EntryDraft)];
		if (!entry) throw new Error("Work records corrections were not appended");
		corrections.push({ endpoint: endpoint.endpoint, entry });
	}
	const correctionOf = (endpoint: AmendedEntryEvidence["endpoint"]) =>
		corrections.find((candidate) => candidate.endpoint === endpoint)?.entry;
	const newClockIn = plan.changes.clockIn ? correctionOf("clock_in") : clockIn;
	const newClockOut = plan.changes.clockOut ? correctionOf("clock_out") : clockOut;
	if (!newClockIn || !newClockOut) throw new Error("Work records corrections were not appended");
	const written = await writeAmendedPair(tx, {
		locked: { ...locked, canonical },
		plan,
		clockIn: newClockIn,
		clockOut: newClockOut,
		updatedAt: new Date(),
		updatedBy: change.actorUserId,
	});
	assertWrittenAgreement(written);

	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [
			{ at: before.startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes ?? 0 },
			{ at: after.startAt, utcOffsetMinutes: newClockIn.utcOffsetMinutes ?? 0 },
		],
	});

	return {
		kind: "amended",
		source: {
			segment: workSegment({
				workPeriodId: period.id,
				canonicalRecordId: canonical.record.id,
				clockIn,
				clockOut,
				startAt: before.startAt,
				endAt: before.endAt,
				durationMinutes: period.durationMinutes ?? 0,
				attribution: WorkAttribution.fromWorkPeriod(period),
				allocations: canonical.allocations,
			}),
			revision: period.graphRevision,
			approvalState: period.approvalStatus,
			recordApprovalState: canonical.record.approvalState,
		},
		segment: workSegment({
			workPeriodId: period.id,
			canonicalRecordId: canonical.record.id,
			clockIn: newClockIn,
			clockOut: newClockOut,
			startAt: after.startAt,
			endAt: after.endAt,
			durationMinutes: after.durationMinutes,
			attribution: after.attribution,
			allocations: written.allocations,
		}),
		after: expectedOf(written.period),
		changes: plan.changes,
		appended: {
			admission: writer.admission,
			corrections: corrections.map(({ endpoint, entry }, index) => ({
				endpoint,
				replacesEntryId: moved[index]?.replaces.id ?? "",
				adopted: moved[index]?.adopted !== undefined,
				entryId: entry.id,
				hash: entry.hash,
				previousEntryId: entry.previousEntryId,
				previousHash: entry.previousHash,
			})),
			entries: corrections.map(({ entry }) => entry),
		},
		effects,
	};
}

/**
 * The caller's patch with the project's billable default (#900): a changed
 * project takes it unless `billable` is named, and billable work needs a
 * project with a customer to bill.
 */
export async function resolvedPatch(
	tx: WorkTransactionClient,
	change: Pick<AmendWorkRecord, "organizationId" | "attribution">,
	source: WorkAttribution,
): Promise<WorkAttributionPatch | undefined> {
	if (!change.attribution) return undefined;
	const { project, ...rest } = change.attribution;
	const projectId = project === undefined ? (source.project?.projectId ?? null) : project;
	const projectChanged = projectId !== (source.project?.projectId ?? null);
	const needsProject = (projectChanged && rest.billable === undefined) || rest.billable === true;
	const facts = needsProject
		? await readProjectBillability(tx, change.organizationId, projectId)
		: null;
	if (rest.billable === true) assertBillableAllowed(facts);
	if (project === undefined) return rest;
	return {
		...rest,
		project:
			project === null
				? null
				: { projectId: project, billableDefault: projectBillableDefault(facts) },
	};
}

/** A named endpoint with its instant: new, or an adopted entry as recorded. */
type ResolvedEndpoint =
	| { at: Instant; endpoint: NewAmendedEndpoint; adopted?: undefined }
	| { at: Instant; adopted: TimeEntryRow };

/**
 * The named endpoints with their instants. An adopted entry must be a pending
 * correction of this employee replacing the current endpoint: recorded,
 * inactive and superseded by nothing (#1226). It is read without a row lock:
 * the coordinator's employee guard serializes the employee's writers, and its
 * activation is guarded on exactly that state.
 */
async function resolvedEndpoints(
	tx: WorkTransactionClient,
	change: AmendWorkRecord,
	current: { clockIn: TimeEntryRow; clockOut: TimeEntryRow },
): Promise<{ clockIn?: ResolvedEndpoint; clockOut?: ResolvedEndpoint } | "adopted_entry_mismatch"> {
	const times = change.times;
	if (!times) return {};
	const adoptedIds = [times.clockIn, times.clockOut].flatMap((endpoint) =>
		endpoint && isAdoptedEndpoint(endpoint) ? [endpoint.adopt] : [],
	);
	const recorded = adoptedIds.length
		? await tx
				.select()
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, change.organizationId),
						eq(timeEntry.employeeId, change.employeeId),
						inArray(timeEntry.id, adoptedIds),
					),
				)
		: [];
	const resolve = (
		endpoint: AmendedEndpoint | undefined,
		replaces: TimeEntryRow,
	): ResolvedEndpoint | "mismatch" | undefined => {
		if (!endpoint) return undefined;
		if (!isAdoptedEndpoint(endpoint)) return { at: endpoint.at, endpoint };
		const entry = recorded.find(({ id }) => id === endpoint.adopt);
		if (
			entry?.type !== "correction" ||
			entry.replacesEntryId !== replaces.id ||
			!entry.isSuperseded ||
			entry.supersededById !== null
		) {
			return "mismatch";
		}
		return { at: instantFromDate(entry.timestamp), adopted: entry };
	};
	const clockIn = resolve(times.clockIn, current.clockIn);
	const clockOut = resolve(times.clockOut, current.clockOut);
	if (clockIn === "mismatch" || clockOut === "mismatch") return "adopted_entry_mismatch";
	return { ...(clockIn ? { clockIn } : {}), ...(clockOut ? { clockOut } : {}) };
}

type MovedEndpoint = {
	endpoint: AmendedEntryEvidence["endpoint"];
	replaces: TimeEntryRow;
	/** The correction entry appended for a new endpoint. */
	draft?: EntryDraft;
	/** The recorded entry adopted for it. */
	adopted?: TimeEntryRow;
};

/** The endpoints that move, clock-in first: each appended as a correction, or adopted. */
function movedEndpoints(
	change: AmendWorkRecord,
	plan: AmendmentPlan,
	resolved: { clockIn?: ResolvedEndpoint; clockOut?: ResolvedEndpoint },
	current: { clockIn: TimeEntryRow; clockOut: TimeEntryRow },
): MovedEndpoint[] {
	const times = change.times;
	if (!times) return [];
	const moved = (
		endpoint: AmendedEntryEvidence["endpoint"],
		named: ResolvedEndpoint,
		replaces: TimeEntryRow,
	): MovedEndpoint =>
		named.adopted
			? { endpoint, replaces, adopted: named.adopted }
			: {
					endpoint,
					replaces,
					draft: {
						type: "correction",
						at: named.at,
						notes: times.notes,
						provenance: { ...times.entries, capture: named.endpoint.capture },
						replaces,
					},
				};
	return [
		...(plan.changes.clockIn && resolved.clockIn
			? [moved("clock_in", resolved.clockIn, current.clockIn)]
			: []),
		...(plan.changes.clockOut && resolved.clockOut
			? [moved("clock_out", resolved.clockOut, current.clockOut)]
			: []),
	];
}

/**
 * Activates a recorded correction in place of the endpoint it replaces: the
 * entry becomes current and supersedes the endpoint, unless that one already
 * is superseded (a legacy split's generated half keeps a superseded clock-out).
 */
async function adoptRecordedEntry(
	tx: WorkTransactionClient,
	entry: TimeEntryRow,
	replaces: TimeEntryRow,
): Promise<TimeEntryRow> {
	const [activated] = await tx
		.update(timeEntry)
		.set({ isSuperseded: false, supersededById: null })
		.where(
			and(
				eq(timeEntry.id, entry.id),
				eq(timeEntry.organizationId, entry.organizationId),
				eq(timeEntry.employeeId, entry.employeeId),
				eq(timeEntry.type, "correction"),
				eq(timeEntry.replacesEntryId, replaces.id),
				eq(timeEntry.isSuperseded, true),
				isNull(timeEntry.supersededById),
			),
		)
		.returning();
	if (!activated) throw new CompletedWorkIntegrityError("Adopted entry changed under its lock");
	if (!replaces.isSuperseded) {
		const superseded = await tx
			.update(timeEntry)
			.set({ isSuperseded: true, supersededById: activated.id })
			.where(
				and(
					eq(timeEntry.id, replaces.id),
					eq(timeEntry.organizationId, replaces.organizationId),
					eq(timeEntry.employeeId, replaces.employeeId),
					eq(timeEntry.isSuperseded, false),
				),
			)
			.returning({ id: timeEntry.id });
		if (superseded.length !== 1) {
			throw new CompletedWorkIntegrityError("Endpoint changed under its lock");
		}
	}
	return activated;
}

type WrittenPair = { period: WorkPeriodRow } & CanonicalWorkRows;

/**
 * The amended pair: compare-and-set on the work period's revision, which
 * advances; the canonical work record takes the same interval and minutes,
 * and its detail and project allocation change only when the attribution does.
 */
async function writeAmendedPair(
	tx: WorkTransactionClient,
	input: {
		locked: WorkRecordRows & { canonical: CanonicalWorkRows };
		plan: AmendmentPlan;
		clockIn: TimeEntryRow;
		clockOut: TimeEntryRow;
		updatedAt: Date;
		updatedBy: string | null;
	},
): Promise<WrittenPair> {
	const { period, canonical } = input.locked;
	const half = input.plan.result;
	const columns = half.period;
	const [written] = await tx
		.update(workPeriod)
		.set({
			clockInId: input.clockIn.id,
			clockOutId: input.clockOut.id,
			startTime: columns.startTime,
			endTime: columns.endTime,
			durationMinutes: columns.durationMinutes,
			projectId: columns.projectId,
			taskId: columns.taskId,
			isBillable: columns.isBillable,
			workCategoryId: columns.workCategoryId,
			workLocationType: columns.workLocationType,
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
			graphRevision: period.graphRevision + 1,
			updatedAt: input.updatedAt,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, period.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				eq(workPeriod.graphRevision, period.graphRevision),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Work period changed under its lock");

	const record = half.canonical.record;
	const [writtenRecord] = await tx
		.update(timeRecord)
		.set({
			startAt: record.startAt,
			endAt: record.endAt,
			durationMinutes: record.durationMinutes,
			updatedAt: input.updatedAt,
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, canonical.record.id),
				eq(timeRecord.organizationId, period.organizationId),
				eq(timeRecord.employeeId, period.employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.returning();
	if (!writtenRecord) throw new CompletedWorkIntegrityError("Canonical work record update failed");

	let detail = canonical.detail;
	const plannedDetail = half.canonical.detail;
	if (
		!WorkAttribution.fromCanonical(detail, []).equals(
			WorkAttribution.fromCanonical(plannedDetail, []),
		)
	) {
		const [writtenDetail] = await tx
			.update(timeRecordWork)
			.set({
				workCategoryId: plannedDetail.workCategoryId,
				workLocationType: plannedDetail.workLocationType,
				vehicleKind: plannedDetail.vehicleKind,
				vehicleId: plannedDetail.vehicleId,
				odometerStartKm: plannedDetail.odometerStartKm,
				odometerEndKm: plannedDetail.odometerEndKm,
				drivenDistanceKm: plannedDetail.drivenDistanceKm,
			})
			.where(
				and(
					eq(timeRecordWork.recordId, canonical.record.id),
					eq(timeRecordWork.organizationId, period.organizationId),
					eq(timeRecordWork.recordKind, "work"),
				),
			)
			.returning();
		if (!writtenDetail)
			throw new CompletedWorkIntegrityError("Canonical work detail update failed");
		detail = writtenDetail;
	}

	let allocations = canonical.allocations;
	const plannedProject = half.canonical.allocations.filter(
		({ allocationKind }) => allocationKind === "project",
	);
	if (!sameAllocations(allocations, half.canonical.allocations)) {
		// Only the project allocation is attribution; cost-centre rows stay as they are.
		await tx
			.delete(timeRecordAllocation)
			.where(
				and(
					eq(timeRecordAllocation.recordId, canonical.record.id),
					eq(timeRecordAllocation.organizationId, period.organizationId),
					eq(timeRecordAllocation.allocationKind, "project"),
				),
			);
		const inserted: CanonicalWorkRows["allocations"] = [];
		for (const allocation of plannedProject) {
			const [row] = await tx
				.insert(timeRecordAllocation)
				.values({
					organizationId: period.organizationId,
					recordId: canonical.record.id,
					allocationKind: allocation.allocationKind,
					projectId: allocation.projectId,
					taskId: allocation.taskId,
					costCenterId: allocation.costCenterId,
					weightPercent: allocation.weightPercent,
					isBillable: allocation.isBillable,
				})
				.returning();
			if (!row) throw new CompletedWorkIntegrityError("Canonical allocation insert failed");
			inserted.push(row);
		}
		allocations = [
			...allocations.filter(({ allocationKind }) => allocationKind !== "project"),
			...inserted,
		];
	}
	return { period: written, record: writtenRecord, detail, allocations };
}

/** The written rows must agree; anything else is a defect of work records. */
function assertWrittenAgreement(written: WrittenPair): void {
	const agreement = recordAgreement(written.period, written);
	if (!agreement.agrees) {
		throw new CompletedWorkIntegrityError(
			`Work records wrote a pair that disagrees on ${agreement.disagreements.join(", ")}`,
		);
	}
}

function sameAllocations(
	stored: readonly CanonicalAllocationShape[],
	planned: readonly CanonicalAllocationShape[],
): boolean {
	const key = (allocation: CanonicalAllocationShape) =>
		[
			allocation.allocationKind,
			allocation.projectId,
			allocation.taskId,
			allocation.costCenterId,
			allocation.weightPercent,
			allocation.isBillable,
		].join("|");
	const left = stored.map(key).sort();
	const right = planned.map(key).sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
