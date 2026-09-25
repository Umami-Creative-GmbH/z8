import "server-only";

/**
 * Completed-work operation for starting live work from a frozen command (#275 /
 * T11, design #256, resolution #263 §3–§5).
 *
 * One call inside the clock-in outer transaction appends the clock-in entry
 * through the append collaborator, opens the period and inserts the committed
 * operation receipt. The operation ID is also the clock-in entry ID, so a later
 * clock-out command can bind to the work this operation created.
 *
 * Fresh starts enforce symmetric half-open occupancy: active work occupies its
 * start onward, so a start is refused while other undeleted work is active or
 * ends after it. Exact replay of a committed receipt writes nothing.
 */
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
	type CompletedWorkWriter,
	completedWorkOperation,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { assertEmployeeMayClock } from "@/lib/employee-lifecycle/clocking-gate";
import { canonicalJson } from "./canonical-json";
import {
	appendClockEntry,
	ClockingConflictError,
	ClockingOrganizationError,
	createDatabaseClockingStore,
	type Entry,
	LiveWorkOccupiedError,
} from "./clocking-core";
import {
	type CloseActiveWorkWriter,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
} from "./close-active-work";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import type { WorkLocationType } from "./work-location";
import type { WorkTransactionAdmission, WorkTransactionScope } from "./work-transaction";

export { LiveWorkOccupiedError } from "./clocking-core";

export const START_LIVE_WORK_RESULT_VERSION = 1;

/** What the operation reads from a writer's frozen command; the receipt stores it whole. */
export type StartLiveWorkOperationCommand = {
	version: number;
	operationId: string;
	workLocationType: WorkLocationType;
};

/** The same writer identity closures use; replay only matches the same writer. */
export type StartLiveWorkWriter = CloseActiveWorkWriter;

/** Committed result (receipt version 1). Current clock state is a separate read. */
export type StartLiveWorkResult = {
	version: typeof START_LIVE_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	workPeriodId: string;
	clockInEntryId: string;
	start: {
		at: string;
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
	};
	/**
	 * Project and category are recorded only when the start carries them over from
	 * work it resumes (#304); a plain start has none.
	 */
	attribution: {
		workLocationType: WorkLocationType;
		projectId?: string | null;
		workCategoryId?: string | null;
	};
	revisions: { workPeriod: { result: number } };
	append: {
		admission: WorkTransactionAdmission;
		previousEntryId: string | null;
		previousHash: string | null;
	};
};

export type StartLiveWorkReceipt = {
	disposition: "executed" | "replayed";
	result: StartLiveWorkResult;
	entry: Entry;
};


/**
 * Exact receipt replay. Returns null when no receipt exists for the identity. Any
 * mismatch in scope, kind, writer or command is a collision; nothing is repaired.
 */
export async function replayStartLiveWork(
	context: Pick<WorkTransactionScope, "db" | "assertEmployee">,
	input: {
		organizationId: string;
		employeeId: string;
		command: Pick<StartLiveWorkOperationCommand, "version" | "operationId">;
		writer: CompletedWorkWriter;
	},
): Promise<StartLiveWorkReceipt | null> {
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
		receipt.kind !== "start_live_work" ||
		receipt.writer !== input.writer ||
		receipt.commandVersion !== input.command.version ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== START_LIVE_WORK_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported completed-work receipt version");
	}
	const result = receipt.result as StartLiveWorkResult;
	const entry = await findStandingStart(context.db, input, result);
	if (!entry) throw new CompletedWorkCollisionError();
	return { disposition: "replayed", result, entry };
}

/**
 * The committed clock-in entry while the work it started still stands, or null
 * once the entry is superseded or its period was deleted.
 */
export async function findStandingStart(
	tx: WorkTransactionScope["db"],
	scope: { organizationId: string; employeeId: string },
	result: Pick<StartLiveWorkResult, "clockInEntryId" | "workPeriodId">,
): Promise<Entry | null> {
	const [entry] = await tx
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.id, result.clockInEntryId),
				eq(timeEntry.organizationId, scope.organizationId),
				eq(timeEntry.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	const [period] = await tx
		.select({ clockInId: workPeriod.clockInId, deletedAt: workPeriod.deletedAt })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, result.workPeriodId),
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	if (!entry || entry.isSuperseded || period?.clockInId !== entry.id || period.deletedAt !== null) {
		return null;
	}
	return entry;
}

export type StartLiveWorkInput = {
	organizationId: string;
	employeeId: string;
	/** The authenticated human starting the work. */
	actorUserId: string;
	command: StartLiveWorkOperationCommand;
	writer: StartLiveWorkWriter;
	/** Attribution a resumed start carries over from the work it continues. */
	carriedAttribution?: { projectId: string | null; workCategoryId: string | null };
	eventInstant: Instant;
	capture: {
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
	};
};

/**
 * Fresh start. The caller has already ruled out committed replay; an existing
 * entry with this identity is therefore a collision.
 */
export async function startLiveWork(
	context: WorkTransactionScope,
	input: StartLiveWorkInput,
): Promise<StartLiveWorkReceipt & { disposition: "executed" }> {
	const started = await startLiveWorkGraph(context, input);
	await context.db.insert(completedWorkOperation).values({
		id: input.command.operationId,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		kind: "start_live_work",
		writer: input.writer.writer,
		writerVersion: input.writer.writerVersion,
		commandVersion: input.command.version,
		command: input.command,
		appendAdmission: started.result.append.admission,
		actorKind: "human",
		actorUserId: input.actorUserId,
		workPeriodId: started.result.workPeriodId,
		resultVersion: START_LIVE_WORK_RESULT_VERSION,
		result: started.result,
	});
	return started;
}

/**
 * The start's graph without its receipt, for an operation that commits the
 * start as one part of its own receipt (#281). The clock-in entry takes the
 * command's operation ID.
 */
export async function startLiveWorkGraph(
	context: WorkTransactionScope,
	input: StartLiveWorkInput,
): Promise<StartLiveWorkReceipt & { disposition: "executed" }> {
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

	const startAt = dateFromInstant(input.eventInstant);
	const occupants = await tx
		.select({ id: workPeriod.id, endTime: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				isNull(workPeriod.deletedAt),
				or(isNull(workPeriod.endTime), gt(workPeriod.endTime, startAt)),
			),
		);
	if (occupants.some((row) => row.endTime === null)) {
		throw new LiveWorkOccupiedError("active_work");
	}
	if (occupants.length > 0) throw new LiveWorkOccupiedError("completed_work");

	const appended = await appendClockEntry(
		store,
		{
			employeeId,
			organizationId,
			createdBy: input.actorUserId,
			actionId: command.operationId,
			action: { instant: input.eventInstant, ...input.capture },
			source: { ipAddress: null, deviceInfo: input.writer.deviceInfo },
		},
		"clock_in",
		context.admission,
	);
	const [period] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: appended.entry.id,
			startTime: startAt,
			isActive: true,
			workLocationType: command.workLocationType,
			projectId: input.carriedAttribution?.projectId ?? null,
			workCategoryId: input.carriedAttribution?.workCategoryId ?? null,
		})
		.returning({ id: workPeriod.id, graphRevision: workPeriod.graphRevision });
	if (!period) throw new ClockingConflictError("Failed to create work period");

	const result: StartLiveWorkResult = {
		version: START_LIVE_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		workPeriodId: period.id,
		clockInEntryId: appended.entry.id,
		start: {
			at: instantToCanonicalString(input.eventInstant),
			...input.capture,
		},
		attribution: {
			workLocationType: command.workLocationType,
			...(input.carriedAttribution ?? {}),
		},
		revisions: { workPeriod: { result: period.graphRevision } },
		append: {
			admission: appended.admission,
			previousEntryId: appended.previousEntryId,
			previousHash: appended.previousHash,
		},
	};
	return { disposition: "executed", result, entry: appended.entry };
}
