import "server-only";

/**
 * Completed-work operation for closing live work (#274 / T10, design #256). The
 * web, mobile and all four bot adapters reach it through the shared live
 * clock-out (#277); manager on-behalf closure reaches it directly (#276).
 *
 * One call inside the web clock-out outer transaction establishes the whole
 * completed graph: work records creates the completed work from the live work
 * (#1222: the clock-out entry, the closed period, canonical base/detail/
 * allocation and their effects), then the automatic break intent and the
 * committed operation receipt follow. A live closure never routes approval
 * (#361). Callers supply intent and evidence (operation identity, attribution
 * intent, event instant and capture), never duration, links or storage patches.
 *
 * Exact replay of a committed receipt writes nothing. Receipt-less committed
 * clock-outs keep the legacy matcher in the action; this module never repairs them.
 */
import { and, eq } from "drizzle-orm";
import {
	type CompletedWorkWriter,
	completedWorkOperation,
	timeEntry,
	workCategory,
	workPeriod,
} from "@/db/schema";
import type { WorkPeriodPostCommitDescriptor } from "@/lib/approvals/server/work-period-submission";
import type { BotPlatform } from "@/lib/bot-platform/types";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { assertEmployeeMayClock } from "@/lib/employee-lifecycle/clocking-gate";
import {
	commitAutomaticBreakIntent,
	isClosureCarriedByAutomaticBreak,
} from "./automatic-break-intent";
import { canonicalJson } from "./canonical-json";
import type { KioskTimeSource } from "./clocking/types";
import {
	ClockingConflictError,
	ClockingOrganizationError,
	createDatabaseClockingStore,
	type Entry,
} from "./clocking-core";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "./policy-clock-out-surcharge-snapshot";
import {
	PROJECT_TASK_INELIGIBILITY_MESSAGES,
	type ProjectTaskIneligibility,
	taskBookingIneligibility,
} from "./project-eligibility";
import {
	humanActorUserId,
	KIOSK_CLOCK_WRITER_VERSION,
	kioskDeviceInfo,
	type ReceiptActor,
	receiptActorColumns,
	writerActor,
} from "./receipt-actor";
import { recordedTaskId, taskIdFollowingProject } from "./task-attribution";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import { vehicleUseFromColumns, type WorkVehicleUse } from "./vehicle-use/work-vehicle-use";
import type { WorkTransactionContext } from "./web-clock-out-transaction";
import {
	readProjectBillability,
	resolveWorkBillability,
	resolveWorkBillabilityInTransaction,
} from "./work-billability";
import { WorkIntervalError } from "./work-duration";
import {
	applyWorkRecordChange,
	CompletedWorkIntegrityError,
	isWorkRecordRefusal,
	orRefuse,
	readWorkRecord,
} from "./work-records";
import type { SealedWorkTransactionScope, WorkTransactionAdmission } from "./work-transaction";

// Work records' invariants, which Clocking's receipts share (moved there to break the cycle).
export { CompletedWorkIntegrityError, earliestStartDate } from "./work-records";

export const CLOSE_ACTIVE_WORK_COMMAND_VERSION = 1;
export const CLOSE_ACTIVE_WORK_RESULT_VERSION = 1;
export const WEB_CLOCK_OUT_WRITER_VERSION = 1;
export const BOT_CLOCK_OUT_WRITER_VERSION = 1;
export const DIRECT_HTTP_WRITER_VERSION = 1;

/**
 * The adapter a live clock command arrived through; stored as device evidence.
 * `api` is direct HTTP: frozen clock commands and the legacy route's commands.
 * `employee-offboarding` is the departure's own clock-out (#485). `kiosk` is kiosk
 * clocking (#860), whose entries carry the kiosk's identity as their device.
 */
export type ClockChannel =
	| "web"
	| "mobile"
	| "api"
	| "kiosk"
	| "automatic-clock-out"
	| `${BotPlatform}-bot`
	| typeof DEPARTURE_CLOCK_OUT_WRITER.deviceInfo;

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

/** The inverse of `attributionIntent`: undefined preserves, null clears, an ID replaces. */
export function attributionValue(intent: AttributionIntent): string | null | undefined {
	if (intent.kind === "preserve") return undefined;
	return intent.kind === "clear" ? null : intent.id;
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
	/**
	 * The task of the project (#873). Omitted, never stored, when the writer names
	 * none: the task then follows the project (kept while it stays, else cleared).
	 */
	task?: AttributionIntent;
	/**
	 * Explicit billability (#900). Absent from commands that do not choose it, so
	 * commands frozen before billability still replay byte for byte: absent takes
	 * the project's billable default when the project changes, else preserves.
	 */
	billable?: boolean;
};

/** The writer that submitted the command; replay only matches the same writer. */
export type CloseActiveWorkWriter = {
	writer: CompletedWorkWriter;
	writerVersion: number;
	/** Stored on the clock-out entry as its source device. */
	deviceInfo: string;
	/** Stored on the clock-out entry as its source address; bots record `"bot"`. */
	ipAddress?: string | null;
	/** The kiosk of a kiosk writer (#860): its receipts record the kiosk as actor. */
	kioskId?: string;
};

/** The receipt writer of a live clock channel: bots share one, the platform stays in the command. */
export function liveClockOutWriter(channel: ClockChannel): CloseActiveWorkWriter {
	if (channel === AUTOMATIC_CLOCK_OUT_WRITER.deviceInfo) return AUTOMATIC_CLOCK_OUT_WRITER;
	if (channel === DEPARTURE_CLOCK_OUT_WRITER.deviceInfo) return DEPARTURE_CLOCK_OUT_WRITER;
	if (channel === "api") {
		return {
			writer: "direct_http",
			writerVersion: DIRECT_HTTP_WRITER_VERSION,
			...clockSource(channel),
		};
	}
	// A kiosk command's own writer also names its kiosk (`kioskClockWriter`).
	if (channel === "kiosk") {
		return {
			writer: "kiosk_clock",
			writerVersion: KIOSK_CLOCK_WRITER_VERSION,
			...clockSource(channel),
		};
	}
	return channel.endsWith("-bot")
		? {
				writer: "bot_clock_out",
				writerVersion: BOT_CLOCK_OUT_WRITER_VERSION,
				...clockSource(channel),
			}
		: {
				writer: "web_clock_out",
				writerVersion: WEB_CLOCK_OUT_WRITER_VERSION,
				...clockSource(channel),
			};
}

/** The receipt writer of an on-behalf clock-out of another employee's work (#276). */
export const MANAGER_ON_BEHALF_WRITER = {
	writer: "manager_on_behalf",
	writerVersion: 1,
	// The established device evidence of on-behalf clock-out entries.
	deviceInfo: "web-on-behalf",
	ipAddress: null,
} as const satisfies CloseActiveWorkWriter;

/**
 * The receipt writer of a departure's clock-out of the departing employee's work
 * (#485), inside the offboarding work transaction.
 */
export const DEPARTURE_CLOCK_OUT_WRITER = {
	writer: "employee_departure",
	writerVersion: 1,
	// The established device evidence of departure clock-out entries.
	deviceInfo: "employee-offboarding",
	ipAddress: null,
} as const satisfies CloseActiveWorkWriter;

export const AUTOMATIC_CLOCK_OUT_WRITER = {
	writer: "automatic_clock_out",
	writerVersion: 1,
	deviceInfo: "automatic-clock-out",
	ipAddress: null,
} as const satisfies CloseActiveWorkWriter;

/**
 * The receipt writer of a kiosk's clock commands (#860): its entries carry the
 * kiosk, and those of a frozen kiosk command (#1289) also its time source.
 */
export function kioskClockWriter(
	kioskId: string,
	offlineTimeSource?: KioskTimeSource,
): CloseActiveWorkWriter {
	return {
		writer: "kiosk_clock",
		writerVersion: KIOSK_CLOCK_WRITER_VERSION,
		deviceInfo: kioskDeviceInfo(kioskId, offlineTimeSource),
		ipAddress: null,
		kioskId,
	};
}

export type CompletingActor = ReceiptActor;

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
	/** The durable automatic break adjustment intent committed with the closure (#305). */
	| { kind: "break_enforcement"; delivery: "committed_intent"; intentId: string }
	| { kind: "approval_notification"; delivery: "approval_owner" };

/**
 * Receipt version 1 keeps the approval participation variant it was defined with;
 * live closures only ever commit `none` (#361).
 */
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
		completing: CompletingActor;
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
		/** Absent on receipts committed before billability (#900), which were non-billable. */
		isBillable?: boolean;
		/** Present only when the closure left a task (#873). */
		taskId?: string;
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

export class CompletedWorkAttributionError extends Error {
	constructor(
		readonly field: "projectId" | "workCategoryId" | "taskId",
		/** Why a task cannot be booked; only for `taskId`. */
		readonly taskReason?: ProjectTaskIneligibility,
	) {
		super(
			field === "projectId"
				? "Project not found"
				: field === "workCategoryId"
					? "Work category not found"
					: PROJECT_TASK_INELIGIBILITY_MESSAGES[taskReason ?? "task_not_found"],
		);
		this.name = "CompletedWorkAttributionError";
	}
}

/**
 * The task a write leaves on work whose project it resolved (#873), re-read in
 * the transaction: a replacement must be an open task of that project in this
 * organization. Employee eligibility of the project stays with the caller's
 * validators. A preserving intent keeps the current task without a check.
 */
export async function resolveTaskAttribution(
	tx: Pick<WorkTransactionContext["db"], "select">,
	input: {
		organizationId: string;
		task: AttributionIntent | undefined;
		projectId: string | null;
		current: { projectId: string | null; taskId: string | null };
	},
): Promise<string | null> {
	const taskId = taskIdFollowingProject(input);
	if (input.task?.kind !== "replace" || taskId === null) return taskId;
	// The work transaction already holds the task rows it names.
	const reason = await taskBookingIneligibility(tx, {
		organizationId: input.organizationId,
		projectId: input.projectId,
		taskId,
	});
	if (reason) throw new CompletedWorkAttributionError("taskId", reason);
	return taskId;
}

/**
 * Exact receipt replay. Returns null when no receipt exists for the identity, so
 * the caller can fall back to the legacy matcher. Any mismatch in scope, kind,
 * writer or command is a collision; nothing is re-executed or repaired.
 */
export async function replayCloseActiveWork(
	context: Pick<SealedWorkTransactionScope, "db" | "assertEmployee">,
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
 * null once the entry is superseded or the period was deleted or re-closed. An
 * automatic break adjustment (#305) keeps the closure standing: it moves the
 * closure's clock-out to the segment it generated from the period, never replacing it.
 */
export async function findStandingClosure(
	tx: SealedWorkTransactionScope["db"],
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
	if (!entry || entry.isSuperseded || !period || period.deletedAt !== null) return null;
	if (period.clockOutId === entry.id) return entry;
	return (await isClosureCarriedByAutomaticBreak(tx, scope, result.workPeriodId, entry.id))
		? entry
		: null;
}

export type CloseActiveWorkInput = {
	organizationId: string;
	employeeId: string;
	teamId: string | null;
	/** Required database creator provenance; system closures use the clock-in creator. */
	actorUserId: string;
	/** Internal evidence; omission retains the existing human actor behavior. */
	completingActor?: CompletingActor;
	workPeriodId: string;
	command: CloseActiveWorkOperationCommand;
	writer: CloseActiveWorkWriter;
	eventInstant: Instant;
	capture: {
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
	};
	/**
	 * The clock-out entry's source evidence; the writer's by default. A legacy
	 * break records its request's (#304).
	 */
	entrySource?: { ipAddress: string | null; deviceInfo: string | null };
	/**
	 * The vehicle use the closed work ends with, decided from the live work's own
	 * under its lock (#1122): undefined keeps the live work's.
	 */
	closingVehicleUse?: ClosingVehicleUse;
};

/** Decides the closed work's vehicle use from the live work's; undefined keeps it. */
export type ClosingVehicleUse = (
	live: WorkVehicleUse | null,
) => Promise<WorkVehicleUse | null | undefined>;

export type ClosedActiveWork = CloseActiveWorkReceipt & {
	disposition: "executed";
	/** Evidence for the post-commit immediate surcharge calculation. */
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot;
};

/**
 * Fresh closure. The caller has already ruled out committed replay; an existing
 * entry or receipt with this identity is therefore a collision.
 */
export async function closeActiveWork(
	context: WorkTransactionContext,
	input: CloseActiveWorkInput,
): Promise<ClosedActiveWork> {
	const closed = await closeActiveWorkGraph(context, input, input.command.operationId);
	await context.db.insert(completedWorkOperation).values({
		id: input.command.operationId,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		kind: "close_active_work",
		writer: input.writer.writer,
		writerVersion: input.writer.writerVersion,
		commandVersion: input.command.version,
		command: input.command,
		appendAdmission: closed.result.append.admission,
		...receiptActorColumns(closed.result.actors.completing),
		workPeriodId: closed.result.workPeriodId,
		resultVersion: CLOSE_ACTIVE_WORK_RESULT_VERSION,
		result: closed.result,
	});
	return closed;
}

/**
 * The closure's graph without its receipt, for an operation that commits the
 * closure as one part of its own receipt (#281), and for a legacy closure, which
 * keeps none. Clocking's policy runs here (membership, the lifecycle gate, the
 * attribution of the command, the surcharge snapshot); work records creates the
 * completed work from the live work (#1222). The clock-out entry takes
 * `clockOutEntryId`, which must be unused; a caller that already looked it up
 * passes `identityChecked`.
 */
export async function closeActiveWorkGraph(
	context: WorkTransactionContext,
	input: CloseActiveWorkInput,
	clockOutEntryId: string,
	options: { identityChecked?: boolean } = {},
): Promise<ClosedActiveWork> {
	const { organizationId, employeeId, command } = input;
	context.assertEmployee(organizationId, employeeId);
	const tx = context.db;
	const store = createDatabaseClockingStore(tx);
	if (!(await store.isOrganizationMember(employeeId, organizationId))) {
		throw new ClockingOrganizationError();
	}
	// Enlisted departures and automatic closures may end existing work after access ends.
	if (
		input.writer.writer !== DEPARTURE_CLOCK_OUT_WRITER.writer &&
		!(
			input.writer.writer === AUTOMATIC_CLOCK_OUT_WRITER.writer &&
			input.completingActor?.kind === "system"
		)
	) {
		await assertEmployeeMayClock(store, { employeeId, organizationId });
	}
	if (
		!options.identityChecked &&
		(await store.getEntryByActionId(employeeId, organizationId, clockOutEntryId))
	) {
		throw new CompletedWorkCollisionError();
	}

	// Authoritative source: the routed live work, locked in work records' order.
	const live = await readWorkRecord(
		context,
		{ organizationId, employeeId, workPeriodId: input.workPeriodId },
		{ lock: true },
	);
	if (!live?.period.isActive || live.period.endTime !== null) {
		throw new ClockingConflictError("No active work period found");
	}
	const { period, clockIn } = live;
	if (clockIn?.type !== "clock_in") {
		throw new CompletedWorkIntegrityError("Active period has no clock-in entry");
	}
	const start = instantFromDate(period.startTime);
	// A replacement project must exist in this organization (the coordinator locked
	// it); one read gives both that and its billable facts.
	const replaced =
		command.project.kind === "replace"
			? await readProjectBillability(tx, organizationId, command.project.id)
			: undefined;
	if (replaced === null) throw new CompletedWorkAttributionError("projectId");
	const projectId =
		command.project.kind === "preserve"
			? period.projectId
			: command.project.kind === "clear"
				? null
				: command.project.id;
	// Choosing another project takes its billable default; keeping it keeps the
	// live period's billability, unless the command chose it (#900).
	const billability = {
		projectChosen: projectId !== period.projectId,
		current: period.isBillable,
		requested: command.billable,
	};
	const isBillable = replaced
		? resolveWorkBillability({ ...billability, project: replaced })
		: await resolveWorkBillabilityInTransaction(tx, organizationId, {
				...billability,
				projectId,
			});
	const taskId = await resolveTaskAttribution(tx, {
		organizationId,
		task: command.task,
		projectId,
		current: { projectId: period.projectId, taskId: period.taskId },
	});
	const workCategoryId = await resolveWorkCategory(
		tx,
		organizationId,
		command.workCategory,
		period.workCategoryId,
	);
	const vehicleUse = await input.closingVehicleUse?.(vehicleUseFromColumns(period));
	const surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		startTime: start,
		endTime: input.eventInstant,
	});

	const completing = input.completingActor ?? writerActor(input.writer, input.actorUserId);
	const source = input.entrySource ?? {
		ipAddress: input.writer.ipAddress ?? null,
		deviceInfo: input.writer.deviceInfo,
	};
	const created = await applyWorkRecordChange(context, {
		kind: "create",
		organizationId,
		employeeId,
		expected: live.expected,
		completing: live,
		at: input.eventInstant,
		attribution: {
			project: projectId === null ? null : { projectId, billableDefault: isBillable },
			task: taskId,
			billable: isBillable,
			workCategoryId,
			...(vehicleUse === undefined ? {} : { vehicleUse }),
		},
		recordedBy: input.actorUserId,
		actorUserId: humanActorUserId(completing),
		entries: { createdBy: input.actorUserId, ...source, capture: input.capture },
		clockOutEntryId,
		appendOperation: "live_clock_out",
	});
	// A live closure never ends where it started (#252 §2).
	if (isWorkRecordRefusal(created) && created.kind === "instant_outside_work") {
		throw new WorkIntervalError();
	}
	const { segment, appended, effects } = orRefuse(created);

	// A closure owes any automatic break adjustment later; its intent commits with
	// the work so process loss, dates and review cannot lose it (#305).
	const breakIntentId =
		context.admission !== "append"
			? null
			: await commitAutomaticBreakIntent(tx, {
					organizationId,
					employeeId,
					workPeriodId: period.id,
					closureEntryId: appended.entry.id,
					triggeredByUserId: input.actorUserId,
				});

	const followUps: CompletedWorkFollowUp[] = [
		{
			kind: "work_balance_refresh",
			delivery: "committed_intent",
			dirtyFromDate: effects.workBalanceDirtyFromDate,
		},
		{ kind: "compliance_check", delivery: "post_commit_best_effort" },
		breakIntentId === null
			? { kind: "break_enforcement", delivery: "post_commit_best_effort" }
			: { kind: "break_enforcement", delivery: "committed_intent", intentId: breakIntentId },
		{ kind: "surcharge_calculation", delivery: "post_commit_best_effort" },
	];
	const result: CloseActiveWorkResult = {
		version: CLOSE_ACTIVE_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actors: {
			clockIn: { kind: "human", userId: clockIn.createdBy },
			completing,
		},
		workPeriodId: period.id,
		clockInEntryId: clockIn.id,
		clockOutEntryId: appended.entry.id,
		canonicalRecordId: segment.canonicalRecordId,
		segment: {
			startAt: segment.startAt,
			endAt: segment.endAt,
			durationMinutes: segment.durationMinutes,
			startUtcOffsetMinutes: clockIn.utcOffsetMinutes,
			endUtcOffsetMinutes: input.capture.utcOffsetMinutes,
			endTimezone: input.capture.timezone,
			endTimezoneSource: input.capture.timezoneSource,
		},
		attribution: {
			projectId,
			isBillable,
			...recordedTaskId(taskId),
			workCategoryId,
			workLocationType: period.workLocationType ?? null,
		},
		revisions: {
			workPeriod: { source: period.graphRevision, result: period.graphRevision + 1 },
		},
		append: {
			admission: appended.admission,
			previousEntryId: appended.clockOut.previousEntryId,
			previousHash: appended.clockOut.previousHash,
		},
		approvalState: "approved",
		approval: { participation: "none" },
		followUps,
	};

	return {
		disposition: "executed",
		result,
		entry: appended.entry,
		surchargeSnapshot,
	};
}

/**
 * A replacement work category must exist, active, in this organization (re-read
 * in the transaction; the coordinator locked the requested rows). Employee
 * eligibility stays with the caller's existing assignment validators.
 */
async function resolveWorkCategory(
	tx: WorkTransactionContext["db"],
	organizationId: string,
	intent: AttributionIntent,
	current: string | null,
): Promise<string | null> {
	if (intent.kind === "preserve") return current;
	if (intent.kind === "clear") return null;
	const [row] = await tx
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
	if (!row) throw new CompletedWorkAttributionError("workCategoryId");
	return row.id;
}

export type { WorkPeriodPostCommitDescriptor };
