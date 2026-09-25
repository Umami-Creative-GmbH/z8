import "server-only";

/**
 * Completed-work operation for closing live work (#274 / T10, design #256). The
 * web, mobile and all four bot adapters reach it through the shared live
 * clock-out (#277).
 *
 * One call inside the web clock-out outer transaction establishes the whole
 * completed graph: the clock-out entry through the append collaborator, the
 * closed period, canonical base/detail/allocation, required approval
 * participation, the work-balance refresh intent and the committed operation
 * receipt. Callers supply intent and evidence (operation identity, attribution
 * intent, event instant and capture), never duration, links or storage patches.
 *
 * Exact replay of a committed receipt writes nothing. Receipt-less committed
 * clock-outs keep the legacy matcher in the action; this module never repairs them.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	type CompletedWorkWriter,
	completedWorkOperation,
	project,
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workCategory,
	workPeriod,
} from "@/db/schema";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import type { BotPlatform } from "@/lib/bot-platform/types";
import {
	executeOrdinaryWorkPeriodSubmissionInTransaction,
	type WorkPeriodPostCommitDescriptor,
} from "@/lib/approvals/server/work-period-submission";
import {
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { assertEmployeeMayClock } from "@/lib/employee-lifecycle/clocking-gate";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { canonicalJson } from "./canonical-json";
import {
	appendClockEntry,
	ClockingConflictError,
	ClockingOrganizationError,
	createDatabaseClockingStore,
	type Entry,
} from "./clocking-core";
import { resolvePolicyClockOutBreakSnapshotInTransaction } from "./policy-clock-out-break-snapshot";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "./policy-clock-out-surcharge-snapshot";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import type { WorkTransactionContext } from "./web-clock-out-transaction";
import { deriveWorkDurationMinutes } from "./work-duration";
import type { WorkTransactionAdmission, WorkTransactionScope } from "./work-transaction";

export const CLOSE_ACTIVE_WORK_COMMAND_VERSION = 1;
export const CLOSE_ACTIVE_WORK_RESULT_VERSION = 1;
export const WEB_CLOCK_OUT_WRITER_VERSION = 1;
export const BOT_CLOCK_OUT_WRITER_VERSION = 1;

/** The adapter a live clock command arrived through; stored as device evidence. */
export type ClockChannel = "web" | "mobile" | `${BotPlatform}-bot`;

/** Entry source evidence. Bots keep their established `ip_address = "bot"`. */
export function clockSource(channel: ClockChannel) {
	return {
		ipAddress: channel.endsWith("-bot") ? "bot" : null,
		deviceInfo: channel,
	};
}


/** Omission preserves the period's attribution; clearing and replacement are explicit. */
export type AttributionIntent =
	| { kind: "preserve" }
	| { kind: "clear" }
	| { kind: "replace"; id: string };

export function attributionIntent(value: string | null | undefined): AttributionIntent {
	if (value === undefined) return { kind: "preserve" };
	if (value === null) return { kind: "clear" };
	return { kind: "replace", id: value };
}

/**
 * What the operation reads from a writer's frozen command. The receipt stores the
 * writer's whole command, and a retry must carry exactly the same value.
 */
export type CloseActiveWorkOperationCommand = {
	version: number;
	operationId: string;
	project: AttributionIntent;
	workCategory: AttributionIntent;
};

/** The writer that submitted the command; replay only matches the same writer. */
export type CloseActiveWorkWriter = {
	writer: CompletedWorkWriter;
	writerVersion: number;
	/** Stored on the clock-out entry as its source device. */
	deviceInfo: string;
	/** Stored on the clock-out entry as its source address; bots record `"bot"`. */
	ipAddress?: string | null;
};

/** The receipt writer of a live clock channel: bots share one, the platform stays in the command. */
export function liveClockOutWriter(channel: ClockChannel): CloseActiveWorkWriter {
	return channel.endsWith("-bot")
		? { writer: "bot_clock_out", writerVersion: BOT_CLOCK_OUT_WRITER_VERSION, ...clockSource(channel) }
		: { writer: "web_clock_out", writerVersion: WEB_CLOCK_OUT_WRITER_VERSION, ...clockSource(channel) };
}

/** Versioned web request evidence. A retry must carry exactly the same command. */
export type CloseActiveWorkCommand = CloseActiveWorkOperationCommand & {
	version: typeof CLOSE_ACTIVE_WORK_COMMAND_VERSION;
	/** Client-captured event instant; null when the server sampled it. */
	requestedInstant: string | null;
	browserTimezone: string | null;
	deviceInfo: ClockChannel;
};

export type CompletedWorkFollowUp =
	| {
			kind: "work_balance_refresh";
			delivery: "committed_intent";
			dirtyFromDate: string;
	  }
	| {
			kind: "break_enforcement" | "surcharge_calculation" | "compliance_check";
			delivery: "post_commit_best_effort";
	  }
	| { kind: "approval_notification"; delivery: "approval_owner" };

export type CloseActiveWorkApprovalParticipation =
	| { participation: "none" }
	| {
			participation: "policy_clock_out";
			disposition: "executed" | "replayed";
			outcome: string;
			approvalRequestId: string;
			/**
			 * Immutable submitted revision of this participation (#302), when
			 * evidence capture is active. The current approval state is a
			 * separate read; this records the original participation only.
			 */
			submittedRevisionId?: string | null;
	  };

/** Committed result (receipt version 1). Current state is a separate read. */
export type CloseActiveWorkResult = {
	version: typeof CLOSE_ACTIVE_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actors: {
		clockIn: { kind: "human"; userId: string };
		completing: { kind: "human"; userId: string };
	};
	workPeriodId: string;
	clockInEntryId: string;
	clockOutEntryId: string;
	canonicalRecordId: string;
	segment: {
		startAt: string;
		endAt: string;
		durationMinutes: number;
		startUtcOffsetMinutes: number;
		endUtcOffsetMinutes: number;
		endTimezone: string;
		endTimezoneSource: TimeEntryTimezoneSource;
	};
	attribution: {
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
	revisions: { workPeriod: { source: number; result: number } };
	append: {
		admission: WorkTransactionAdmission;
		previousEntryId: string | null;
		previousHash: string | null;
	};
	approvalState: "approved" | "pending";
	approval: CloseActiveWorkApprovalParticipation;
	followUps: CompletedWorkFollowUp[];
};

export type CloseActiveWorkReceipt = {
	disposition: "executed" | "replayed";
	result: CloseActiveWorkResult;
	entry: Entry;
};

export class CompletedWorkCollisionError extends Error {
	constructor() {
		super("Operation identity collision");
		this.name = "CompletedWorkCollisionError";
	}
}

export class CompletedWorkIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CompletedWorkIntegrityError";
	}
}

export class CompletedWorkAttributionError extends Error {
	constructor(readonly field: "projectId" | "workCategoryId") {
		super(field === "projectId" ? "Project not found" : "Work category not found");
		this.name = "CompletedWorkAttributionError";
	}
}

function approvalDbService(context: WorkTransactionContext): ApprovalDbService {
	return {
		db: context.approval.dbService.db as ApprovalDbService["db"],
		query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
	};
}

const APPROVAL_REASON = "Clock-out requires approval (0-day policy)";

/**
 * Exact receipt replay. Returns null when no receipt exists for the identity, so
 * the caller can fall back to the legacy matcher. Any mismatch in scope, kind,
 * writer or command is a collision; nothing is re-executed or repaired.
 */
export async function replayCloseActiveWork(
	context: Pick<WorkTransactionScope, "db" | "assertEmployee">,
	input: {
		organizationId: string;
		employeeId: string;
		command: Pick<CloseActiveWorkOperationCommand, "version" | "operationId">;
		/** Defaults to the web clock-out writer. */
		writer?: CompletedWorkWriter;
	},
): Promise<CloseActiveWorkReceipt | null> {
	context.assertEmployee(input.organizationId, input.employeeId);
	const [receipt] = await context.db
		.select()
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.command.operationId))
		.limit(1);
	if (!receipt) return null;
	if (
		receipt.organizationId !== input.organizationId ||
		receipt.employeeId !== input.employeeId ||
		receipt.kind !== "close_active_work" ||
		receipt.writer !== (input.writer ?? "web_clock_out") ||
		receipt.commandVersion !== input.command.version ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== CLOSE_ACTIVE_WORK_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported completed-work receipt version");
	}
	const result = receipt.result as CloseActiveWorkResult;
	// Replay returns the original result only while its evidence still stands: a
	// deleted or corrected closure keeps the established conflict behavior.
	const entry = await findStandingClosure(context.db, input, result);
	if (!entry) throw new CompletedWorkCollisionError();
	return { disposition: "replayed", result, entry };
}

/**
 * The committed clock-out entry while the closure it describes still stands, or
 * null once the entry is superseded or the period was deleted or re-closed.
 */
export async function findStandingClosure(
	tx: WorkTransactionScope["db"],
	scope: { organizationId: string; employeeId: string },
	result: Pick<CloseActiveWorkResult, "clockOutEntryId" | "workPeriodId">,
): Promise<Entry | null> {
	const [entry] = await tx
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.id, result.clockOutEntryId),
				eq(timeEntry.organizationId, scope.organizationId),
				eq(timeEntry.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	const [period] = await tx
		.select({
			clockOutId: workPeriod.clockOutId,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, result.workPeriodId),
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	if (
		!entry ||
		entry.isSuperseded ||
		period?.clockOutId !== entry.id ||
		period.deletedAt !== null
	) {
		return null;
	}
	return entry;
}

export type CloseActiveWorkInput = {
	organizationId: string;
	employeeId: string;
	teamId: string | null;
	/** The authenticated human completing the work. */
	actorUserId: string;
	workPeriodId: string;
	command: CloseActiveWorkOperationCommand;
	writer: CloseActiveWorkWriter;
	eventInstant: Instant;
	capture: {
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
	};
};

export type ClosedActiveWork = CloseActiveWorkReceipt & {
	disposition: "executed";
	approvalSubmission: Awaited<
		ReturnType<typeof executeOrdinaryWorkPeriodSubmissionInTransaction>
	> | null;
	/** Evidence for the post-commit immediate surcharge calculation. */
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
};

/**
 * Fresh closure. The caller has already ruled out committed replay; an existing
 * entry or receipt with this identity is therefore a collision.
 */
export async function closeActiveWork(
	context: WorkTransactionContext,
	input: CloseActiveWorkInput,
): Promise<ClosedActiveWork> {
	const { organizationId, employeeId, command } = input;
	context.assertEmployee(organizationId, employeeId);
	const tx = context.db;
	const store = createDatabaseClockingStore(tx);
	if (!(await store.isOrganizationMember(employeeId, organizationId))) {
		throw new ClockingOrganizationError();
	}
	await assertEmployeeMayClock(store, { employeeId, organizationId });
	if (await store.getEntryByActionId(employeeId, organizationId, command.operationId)) {
		throw new CompletedWorkCollisionError();
	}

	// Authoritative source: the routed period row, already locked by the coordinator.
	const [period] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
			),
		)
		.for("update")
		.limit(1);
	if (!period?.isActive || period.endTime !== null || period.deletedAt !== null) {
		throw new ClockingConflictError("No active work period found");
	}
	const [clockIn] = await tx
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.id, period.clockInId),
				eq(timeEntry.organizationId, organizationId),
				eq(timeEntry.employeeId, employeeId),
			),
		)
		.limit(1);
	if (clockIn?.type !== "clock_in") {
		throw new CompletedWorkIntegrityError("Active period has no clock-in entry");
	}

	const start = instantFromDate(period.startTime);
	const durationMinutes = deriveWorkDurationMinutes(start, input.eventInstant);
	const projectId = await resolveAttribution(
		tx,
		organizationId,
		"projectId",
		command.project,
		period.projectId,
	);
	const workCategoryId = await resolveAttribution(
		tx,
		organizationId,
		"workCategoryId",
		command.workCategory,
		period.workCategoryId,
	);
	const endAt = dateFromInstant(input.eventInstant);
	const requiresApproval = context.requiresApproval;
	const approvalState = requiresApproval ? "pending" : "approved";

	const surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		startTime: start,
		endTime: input.eventInstant,
	});
	const breakPolicySnapshot = requiresApproval
		? await resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: tx },
				organizationId,
				employeeId,
				endTime: input.eventInstant,
			})
		: null;

	const [record] = await tx
		.insert(timeRecord)
		.values({
			organizationId,
			employeeId,
			recordKind: "work",
			startAt: period.startTime,
			endAt,
			durationMinutes,
			approvalState,
			origin: "clock",
			createdBy: input.actorUserId,
			updatedBy: input.actorUserId,
		})
		.returning({ id: timeRecord.id });
	if (!record) throw new Error("Failed to create canonical work record");
	await tx.insert(timeRecordWork).values({
		recordId: record.id,
		organizationId,
		recordKind: "work",
		workCategoryId,
		workLocationType: period.workLocationType ?? null,
		computationMetadata: null,
	});
	if (projectId) {
		await tx.insert(timeRecordAllocation).values({
			organizationId,
			recordId: record.id,
			allocationKind: "project",
			projectId,
			weightPercent: 100,
		});
	}

	const appended = await appendClockEntry(
		store,
		{
			employeeId,
			organizationId,
			createdBy: input.actorUserId,
			actionId: command.operationId,
			action: { instant: input.eventInstant, ...input.capture },
			source: { ipAddress: input.writer.ipAddress ?? null, deviceInfo: input.writer.deviceInfo },
		},
		"clock_out",
		context.admission,
	);

	const resultRevision = period.graphRevision + 1;
	const [closed] = await tx
		.update(workPeriod)
		.set({
			clockOutId: appended.entry.id,
			endTime: endAt,
			durationMinutes,
			isActive: false,
			projectId,
			workCategoryId,
			canonicalRecordId: record.id,
			approvalStatus: approvalState,
			pendingChanges: breakPolicySnapshot
				? {
						originalStartTime: period.startTime.toISOString(),
						originalEndTime: endAt.toISOString(),
						originalDurationMinutes: durationMinutes,
						requestedAt: endAt.toISOString(),
						requestedBy: input.actorUserId,
						isNewClockOut: true,
						ordinarySubmission: {
							submissionId: command.operationId,
							kind: "policy_clock_out" as const,
						},
						breakPolicySnapshot,
						surchargeSnapshot,
					}
				: null,
			graphRevision: resultRevision,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, true),
				eq(workPeriod.graphRevision, period.graphRevision),
			),
		)
		.returning({ id: workPeriod.id });
	if (!closed) throw new ClockingConflictError("Active work period changed");

	let approvalSubmission: ClosedActiveWork["approvalSubmission"] = null;
	let approval: CloseActiveWorkApprovalParticipation = { participation: "none" };
	let committedApprovalState: "approved" | "pending" = approvalState;
	if (requiresApproval) {
		approvalSubmission = await executeOrdinaryWorkPeriodSubmissionInTransaction({
			dbService: approvalDbService(context),
			context: context.approval,
			coordination: context,
			organizationId,
			workPeriodId: period.id,
			submissionId: command.operationId,
			requesterEmployeeId: employeeId,
			requesterUserId: input.actorUserId,
			teamId: input.teamId,
			defaultApproverId: null,
			reason: APPROVAL_REASON,
			overtimeRisk: "warning",
			kind: "policy_clock_out",
			metadata: {},
		});
		approval = {
			participation: "policy_clock_out",
			disposition: approvalSubmission.disposition,
			outcome: approvalSubmission.result.kind,
			approvalRequestId: approvalSubmission.result.approvalRequestId,
			submittedRevisionId: approvalSubmission.evidence?.submittedRevisionId ?? null,
		};
		const [after] = await tx
			.select({ approvalStatus: workPeriod.approvalStatus })
			.from(workPeriod)
			.where(and(eq(workPeriod.id, period.id), eq(workPeriod.organizationId, organizationId)))
			.limit(1);
		if (after?.approvalStatus !== "approved" && after?.approvalStatus !== "pending") {
			throw new CompletedWorkIntegrityError("Approval participation left an invalid state");
		}
		committedApprovalState = after.approvalStatus;
	}

	// Required recalculation commits with the work and recovers through the
	// existing balance refresh owner. The earlier of the UTC and captured-offset
	// local start date covers the work's day in either representation.
	const dirtyFromDate = earliestStartDate(start, clockIn.utcOffsetMinutes);
	await markEmployeeWorkBalanceDirty({ employeeId, organizationId, dirtyFromDate }, tx);

	const followUps: CompletedWorkFollowUp[] = [
		{ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate },
		{ kind: "compliance_check", delivery: "post_commit_best_effort" },
		...(requiresApproval
			? [{ kind: "approval_notification" as const, delivery: "approval_owner" as const }]
			: [
					{ kind: "break_enforcement" as const, delivery: "post_commit_best_effort" as const },
					{ kind: "surcharge_calculation" as const, delivery: "post_commit_best_effort" as const },
				]),
	];
	const result: CloseActiveWorkResult = {
		version: CLOSE_ACTIVE_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actors: {
			clockIn: { kind: "human", userId: clockIn.createdBy },
			completing: { kind: "human", userId: input.actorUserId },
		},
		workPeriodId: period.id,
		clockInEntryId: clockIn.id,
		clockOutEntryId: appended.entry.id,
		canonicalRecordId: record.id,
		segment: {
			startAt: instantToCanonicalString(start),
			endAt: instantToCanonicalString(input.eventInstant),
			durationMinutes,
			startUtcOffsetMinutes: clockIn.utcOffsetMinutes,
			endUtcOffsetMinutes: input.capture.utcOffsetMinutes,
			endTimezone: input.capture.timezone,
			endTimezoneSource: input.capture.timezoneSource,
		},
		attribution: {
			projectId,
			workCategoryId,
			workLocationType: period.workLocationType ?? null,
		},
		revisions: { workPeriod: { source: period.graphRevision, result: resultRevision } },
		append: {
			admission: appended.admission,
			previousEntryId: appended.previousEntryId,
			previousHash: appended.previousHash,
		},
		approvalState: committedApprovalState,
		approval,
		followUps,
	};
	await tx.insert(completedWorkOperation).values({
		id: command.operationId,
		organizationId,
		employeeId,
		kind: "close_active_work",
		writer: input.writer.writer,
		writerVersion: input.writer.writerVersion,
		commandVersion: command.version,
		command,
		appendAdmission: appended.admission,
		actorKind: "human",
		actorUserId: input.actorUserId,
		workPeriodId: period.id,
		resultVersion: CLOSE_ACTIVE_WORK_RESULT_VERSION,
		result,
	});

	return {
		disposition: "executed",
		result,
		entry: appended.entry,
		approvalSubmission,
		surchargeSnapshot: requiresApproval ? null : surchargeSnapshot,
	};
}

/**
 * Replacement attribution must exist in this organization (re-read in the
 * transaction; the coordinator locked the requested rows). Employee eligibility
 * stays with the caller's existing assignment validators.
 */
async function resolveAttribution(
	tx: WorkTransactionContext["db"],
	organizationId: string,
	field: "projectId" | "workCategoryId",
	intent: AttributionIntent,
	current: string | null,
): Promise<string | null> {
	if (intent.kind === "preserve") return current;
	if (intent.kind === "clear") return null;
	const [row] =
		field === "projectId"
			? await tx
					.select({ id: project.id })
					.from(project)
					.where(and(eq(project.id, intent.id), eq(project.organizationId, organizationId)))
					.limit(1)
			: await tx
					.select({ id: workCategory.id })
					.from(workCategory)
					.where(
						and(
							eq(workCategory.id, intent.id),
							eq(workCategory.organizationId, organizationId),
							eq(workCategory.isActive, true),
						),
					)
					.limit(1);
	if (!row) throw new CompletedWorkAttributionError(field);
	return row.id;
}

/** The earlier of the UTC and captured-offset local date of an instant. */
export function earliestStartDate(start: Instant, utcOffsetMinutes: number): string {
	const utcDate = start.toZonedDateTimeISO("UTC").toPlainDate();
	const localDate = start.toZonedDateTimeISO(fixedOffsetZone(utcOffsetMinutes)).toPlainDate();
	return (comparePlainDates(localDate, utcDate) < 0 ? localDate : utcDate).toString();
}

export type { WorkPeriodPostCommitDescriptor };

/** The captured event offset as an explicit fixed-offset zone, e.g. `-05:30`. */
function fixedOffsetZone(utcOffsetMinutes: number): string {
	const sign = utcOffsetMinutes < 0 ? "-" : "+";
	const minutes = Math.abs(utcOffsetMinutes);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
