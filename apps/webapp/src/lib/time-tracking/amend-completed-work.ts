import "server-only";

/**
 * Completed-work operation for direct amendments (#286 / T22, design #256).
 *
 * One call inside the completed-work work transaction corrects the endpoints
 * and/or changes the attribution of one completed period. It owns the caller
 * policy: current scoped authorization, the unresolved-review guard, the
 * requested times (range rule, no future endpoints), attribution eligibility
 * and, in append admission, the committed receipt with its exact replay. Work
 * records amends the work period and its canonical work record together,
 * appends the replacing correction entries and applies the effects (ADR 0010,
 * #1225). Callers supply intent and evidence, never durations, links or
 * storage patches.
 *
 * Replaced entries are superseded, never removed: their hashes stay predecessor
 * evidence. Exact replay of a committed receipt writes nothing, and a receipt
 * whose work has since changed or been deleted is a collision, never new work.
 * In legacy admission the same policy and change run without a receipt
 * (`amendLegacyCompletedWork`).
 */
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	completedWorkOperation,
	employee,
	employeeManagers,
	project,
	projectAssignment,
	projectManager,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import {
	authorizeTimeCorrectionCategoryChange,
	lockTrustedTimeCorrectionEmployeeTeamId,
} from "@/lib/approvals/server/time-correction-category-authorization";
import {
	BOOKABLE_PROJECT_STATUSES,
	PROJECT_TASK_INELIGIBILITY_MESSAGES,
	type ProjectTaskIneligibility,
	taskBookingIneligibility,
} from "./project-eligibility";
import { recordedTaskId } from "./task-attribution";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	compareInstants,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import {
	AmendmentNoChangeError,
	AmendmentRangeError,
	type BillableIntent,
	type EndpointIntent,
	planAttributionChange,
	planCompletedWorkAmendment,
} from "./amend-completed-work-plan";
import {
	type AttributionIntent,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
	type CompletedWorkFollowUp,
} from "./close-active-work";
import { canonicalJson } from "./canonical-json";
import { monthClosedRefusalOf } from "./closed-months/refusal";
import { sendBackChangedPeriodSubmissions } from "./period-submissions/submission-send-back";
import { TimeEntryAppendReviewRequiredError } from "./time-entry-append";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import { BillableWorkRefusedError, resolveWorkBillabilityInTransaction } from "./work-billability";
import { WorkIntervalError } from "./work-duration";
import { assertWorkVehicleUseChangeAllowed } from "./vehicle-use/work-vehicle-use-eligibility";
import {
	type VehicleUseIntent,
	vehicleUseColumns,
	vehicleUseFromColumns,
	type WorkVehicleUse,
} from "./vehicle-use/work-vehicle-use";
import type { WorkLocationType } from "./work-location";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { WorkOccupancyConflictError } from "./work-occupancy";
import { assertNoUnresolvedWorkPeriodReview } from "./work-period-review";
import type { SealedWorkTransactionScope } from "./work-transaction";
import {
	type AmendAttributionPatch,
	type AmendedEndpoint,
	applyWorkRecordChange,
	CompletedWorkReviewRequiredError,
	orRefuse,
	readWorkRecord,
	type WorkSegment,
} from "./work-records";

export const AMEND_COMPLETED_WORK_COMMAND_VERSION = 1;
export const AMEND_COMPLETED_WORK_RESULT_VERSION = 1;
export const AMEND_COMPLETED_WORK_WRITER_VERSION = 1;

export type AmendmentWriter =
	| "admin_time_edit"
	| "self_service_time_edit"
	| "http_direct_correction"
	| "work_period_attribution_edit";

/**
 * Current authority the operation verifies under its locks:
 * - `owner`: the actor's own active employee record owns the work;
 * - `organization_admin`: the actor is an approved owner/admin member;
 * - `owner_or_manager`: the owner, an admin employee, or a direct manager.
 * - `owner_manager_or_project_manager` (#900): the owner, an approved owner/admin
 *   member, an admin employee, a direct manager, or a project manager of the
 *   work's project. It permits billability-only changes and nothing else.
 */
export type AmendmentAuthority =
	| "owner"
	| "organization_admin"
	| "owner_or_manager"
	| "owner_manager_or_project_manager";

export type EndpointCommand =
	| { kind: "preserve" }
	| {
			kind: "set";
			/** Canonical UTC instant. */
			at: string;
			precision: "exact" | "minute";
			utcOffsetMinutes: number;
			timezone: string;
			timezoneSource: TimeEntryTimezoneSource;
	  };

/**
 * Versioned request evidence: the writer's request exactly as the caller
 * submitted it, before any server interpretation. A retry must carry exactly the
 * same command, so a committed receipt can be matched before fresh preflight
 * reads (which may have changed because of the committed work itself).
 */
export type AmendCompletedWorkCommand = {
	version: typeof AMEND_COMPLETED_WORK_COMMAND_VERSION;
	operationId: string;
	request: Record<string, string | null>;
};

/** The adapter's interpretation of the request; recorded in the result. */
export type AmendCompletedWorkIntent = {
	workPeriodId: string;
	clockIn: EndpointCommand;
	clockOut: EndpointCommand;
	project: AttributionIntent;
	/**
	 * The task of the project (#873). Omitted, never stored, when the writer names
	 * none: the task then follows the project (kept while it stays, else cleared).
	 */
	task?: AttributionIntent;
	workCategory: AttributionIntent;
	workLocation: AttributionIntent;
	/**
	 * Billability (#900). Absent or `preserve` keeps it with the project and applies
	 * a new project's billable default; `set` is an explicit choice that wins.
	 * Intents recorded before #900 omit it.
	 */
	billable?: BillableIntent;
	/**
	 * Vehicle use (#1120). Omitted, never stored, when the writer names none: the
	 * recorded vehicle use is kept.
	 */
	vehicleUse?: VehicleUseIntent;
	/** Note recorded on each correction entry. */
	notes: string | null;
};

/** `clockOutEntryId`/`endAt` are null only for active work. */
export type AmendedSegment = {
	clockInEntryId: string;
	clockOutEntryId: string | null;
	startAt: string;
	endAt: string | null;
	durationMinutes: number | null;
	startUtcOffsetMinutes: number | null;
	endUtcOffsetMinutes: number | null;
	attribution: {
		projectId: string | null;
		/** Absent on receipts committed before billability (#900), which were non-billable. */
		isBillable?: boolean;
		/** Present only when the segment has a task (#873). */
		taskId?: string;
		workCategoryId: string | null;
		workLocationType: string | null;
		/** Present only when the segment has vehicle use (#1120). */
		vehicleUse?: WorkVehicleUse;
	};
};

/** Committed result (receipt version 1). Current state is a separate read. */
export type AmendCompletedWorkResult = {
	version: typeof AMEND_COMPLETED_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	authority: AmendmentAuthority;
	intent: AmendCompletedWorkIntent;
	workPeriodId: string;
	/** Null for active work, which has no canonical record yet. */
	canonicalRecordId: string | null;
	source: AmendedSegment;
	segment: AmendedSegment;
	changes: {
		clockIn: boolean;
		clockOut: boolean;
		project: boolean;
		/** Present only when the task changed (#873). */
		task?: true;
		workCategory: boolean;
		workLocation: boolean;
		/** Whether billability changed (#900); absent on receipts committed before it. */
		billable?: boolean;
		/** Present only when vehicle use changed (#1120). */
		vehicleUse?: true;
	};
	corrections: Array<{
		endpoint: "clock_in" | "clock_out";
		entryId: string;
		replacesEntryId: string;
		previousEntryId: string | null;
		previousHash: string | null;
	}>;
	revisions: { workPeriod: { source: number; result: number } };
	/** Receipts are committed in append admission only; legacy amendments return the same shape. */
	append: { admission: "append" | "legacy"; used: boolean };
	/** Unchanged by a direct amendment; recorded as committed evidence. */
	approvalState: string | null;
	followUps: CompletedWorkFollowUp[];
};

export type AmendCompletedWorkReceipt = {
	disposition: "executed" | "replayed";
	result: AmendCompletedWorkResult;
	correctionEntries: Array<typeof timeEntry.$inferSelect>;
};

// Work records owns the review refusal (ADR 0010); re-exported for existing callers.
export { CompletedWorkReviewRequiredError };

export type AmendCompletedWorkInput = {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	authority: AmendmentAuthority;
	writer: AmendmentWriter;
	command: AmendCompletedWorkCommand;
	intent: AmendCompletedWorkIntent;
	/**
	 * The period state the caller validated and showed. The operation re-reads it
	 * under its locks; any difference is a stale source.
	 */
	expectedSource: {
		clockInId: string;
		clockOutId: string | null;
		startAt: Instant;
		endAt: Instant | null;
	};
	/** Authoritative instant for the fresh future-endpoint check. */
	evaluatedAt: Instant;
	request: { ipAddress: string | null; deviceInfo: string | null };
};

type TransactionClient = SealedWorkTransactionScope["db"];

const logger = createLogger("CompletedWorkAmendment");

function staleSource(): ConflictError {
	return new ConflictError({
		message: "Work period changed while editing",
		conflictType: "time_correction_work_period_stale",
	});
}

function notAuthorized(userId: string): AuthorizationError {
	return new AuthorizationError({
		message: "Not authorized to correct this time entry",
		userId,
		resource: "time_entry",
		action: "correct",
	});
}

function sameInstant(left: Date | null, right: Instant | null): boolean {
	if (left === null || right === null) return left === null && right === null;
	return compareInstants(instantFromDate(left), right) === 0;
}

/** Planning outcomes as the established validation failures. */
function planningFailure(error: unknown): unknown {
	if (error instanceof AmendmentNoChangeError) {
		return new ValidationError({ message: error.message, field: "correction" });
	}
	if (error instanceof WorkIntervalError) {
		return new ValidationError({
			message: "Clock out time must be after clock in time",
			field: "timestamp",
		});
	}
	if (error instanceof AmendmentRangeError) {
		return new ValidationError({ message: error.message, field: "timestamp" });
	}
	return error;
}

function endpointIntent(command: EndpointCommand): EndpointIntent {
	return command.kind === "preserve"
		? command
		: { kind: "set", at: parseInstant(command.at), precision: command.precision };
}

type ReplayInput = {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	writer: AmendmentWriter;
	command: AmendCompletedWorkCommand;
};

/**
 * Exact receipt replay, in every admission mode. Returns null when no receipt
 * exists for the identity. Any mismatch in scope, kind, writer, actor or command
 * is a collision. A committed result only replays while its work still stands
 * exactly as committed; later corrections or deletion keep the established
 * conflict behavior and never recreate work.
 */
export async function replayAmendCompletedWork(
	scope: SealedWorkTransactionScope,
	input: ReplayInput,
): Promise<AmendCompletedWorkReceipt | null> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const [receipt] = await scope.db
		.select()
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.command.operationId))
		.limit(1);
	if (!receipt) return null;
	if (
		receipt.organizationId !== input.organizationId ||
		receipt.employeeId !== input.employeeId ||
		receipt.kind !== "amend_completed_work" ||
		receipt.writer !== input.writer ||
		receipt.actorUserId !== input.actorUserId ||
		receipt.commandVersion !== input.command.version ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== AMEND_COMPLETED_WORK_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported completed-work receipt version");
	}
	const result = receipt.result as AmendCompletedWorkResult;
	// Replay keeps current access rules: the actor must still hold the authority
	// the operation was committed under.
	await lockAuthority(scope.db, {
		...input,
		authority: result.authority,
		workPeriodId: result.workPeriodId,
	});
	const [period] = await scope.db
		.select({
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, result.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.limit(1);
	// The committed evidence must still stand: the same endpoint entries, not
	// deleted, and no correction superseded since. A later revision alone (for
	// example an approval or attribution change) does not invalidate the receipt.
	if (
		!period ||
		period.deletedAt !== null ||
		period.clockInId !== result.segment.clockInEntryId ||
		period.clockOutId !== result.segment.clockOutEntryId
	) {
		throw new CompletedWorkCollisionError();
	}
	const correctionIds = result.corrections.map(({ entryId }) => entryId);
	const correctionEntries = correctionIds.length
		? await scope.db
				.select()
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, input.organizationId),
						eq(timeEntry.employeeId, input.employeeId),
						inArray(timeEntry.id, correctionIds),
					),
				)
		: [];
	if (
		correctionEntries.length !== correctionIds.length ||
		correctionEntries.some((entry) => entry.isSuperseded)
	) {
		throw new CompletedWorkCollisionError();
	}
	return { disposition: "replayed", result, correctionEntries };
}

/**
 * Lookup-only replay before an adapter's fresh preflight: finds a committed
 * receipt for the identity in the organization and replays it under the
 * coordinated transaction of the receipt's employee. Returns null when nothing
 * was committed with this identity; never creates or repairs anything.
 */
export async function replayCommittedAmendment(
	input: Omit<ReplayInput, "employeeId">,
): Promise<AmendCompletedWorkReceipt | null> {
	const [receipt] = await db
		.select({ employeeId: completedWorkOperation.employeeId })
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.id, input.command.operationId),
				eq(completedWorkOperation.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!receipt) return null;
	return withCompletedWorkTransaction(
		{
			organizationId: input.organizationId,
			employeeId: receipt.employeeId,
			actorUserId: input.actorUserId,
		},
		(scope) => replayAmendCompletedWork(scope, { ...input, employeeId: receipt.employeeId }),
	);
}

/** In one coordinated scope: exact replay first, otherwise the fresh operation. */
export async function replayOrAmendCompletedWork(
	scope: SealedWorkTransactionScope,
	input: AmendCompletedWorkInput,
): Promise<AmendCompletedWorkReceipt> {
	return (await replayAmendCompletedWork(scope, input)) ?? (await amendCompletedWork(scope, input));
}

/**
 * Locks and verifies the actor's current authority over the owner's work. Shared
 * with the other direct completed-work writers (#304 calendar splits).
 *
 * `owner_manager_or_project_manager` needs `workPeriodId`: a project manager's
 * authority comes from the work's project, whose `project_manager` row (and
 * project) are share-locked here, before the work rows. The result names that
 * project as `authorizedProjectId`; the caller must find the locked work still on
 * it. It is null for every other path.
 */
export async function lockAuthority(
	tx: TransactionClient,
	input: Pick<
		AmendCompletedWorkInput,
		"organizationId" | "employeeId" | "actorUserId" | "authority"
	> & { workPeriodId?: string },
) {
	// Lock order: employees by ascending ID, membership, manager link, teams, then work rows.
	const lockedEmployees = await tx
		.select({
			id: employee.id,
			userId: employee.userId,
			isActive: employee.isActive,
			role: employee.role,
			teamId: employee.teamId,
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				or(eq(employee.id, input.employeeId), eq(employee.userId, input.actorUserId)),
			),
		)
		.orderBy(asc(employee.id))
		.for("update");
	const target = lockedEmployees.find(({ id }) => id === input.employeeId);
	if (!target?.isActive) {
		throw new NotFoundError({
			message: "Employee not found in organization",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}
	const actorEmployees = lockedEmployees.filter(
		({ userId, isActive }) => userId === input.actorUserId && isActive,
	);
	const [membership] = await tx
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.userId, input.actorUserId),
				eq(member.organizationId, input.organizationId),
				eq(member.status, "approved"),
			),
		)
		.for("update");
	if (!membership) throw notAuthorized(input.actorUserId);
	const authorized = { ...target, authorizedProjectId: null as string | null };
	const isOrganizationAdmin =
		hasOrganizationRole(membership.role, "owner") || hasOrganizationRole(membership.role, "admin");

	if (input.authority === "organization_admin") {
		if (!isOrganizationAdmin) {
			throw new AuthorizationError({
				message: "Only organization owners and admins can edit this time entry",
				userId: input.actorUserId,
				resource: "time_entry",
				action: "correct",
			});
		}
		return authorized;
	}
	const billability = input.authority === "owner_manager_or_project_manager";
	if (billability && isOrganizationAdmin) return authorized;
	const actorEmployee = actorEmployees.length === 1 ? actorEmployees[0] : undefined;
	if (!actorEmployee) throw notAuthorized(input.actorUserId);
	if (actorEmployee.id === input.employeeId) return authorized;
	if (input.authority === "owner") throw notAuthorized(input.actorUserId);
	if (actorEmployee.role === "admin") return authorized;
	const [link] = await tx
		.select({ id: employeeManagers.id })
		.from(employeeManagers)
		.where(
			and(
				eq(employeeManagers.employeeId, input.employeeId),
				eq(employeeManagers.managerId, actorEmployee.id),
			),
		)
		.for("update");
	if (link) return authorized;
	if (billability) {
		const projectId = await lockManagedProjectOfWork(tx, input, actorEmployee.id);
		if (projectId) return { ...authorized, authorizedProjectId: projectId };
	}
	throw notAuthorized(input.actorUserId);
}

/**
 * The work's project when the actor is one of its project managers (#900), with
 * the `project_manager` row and the project share-locked; otherwise null. The
 * work row is read without a lock: the amendment locks it afterwards and checks
 * that it is still on this project.
 */
async function lockManagedProjectOfWork(
	tx: TransactionClient,
	input: { organizationId: string; employeeId: string; workPeriodId?: string },
	actorEmployeeId: string,
): Promise<string | null> {
	if (!input.workPeriodId) return null;
	const [work] = await tx
		.select({ projectId: workPeriod.projectId })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.limit(1);
	if (!work?.projectId) return null;
	const [managed] = await tx
		.select({ id: projectManager.id })
		.from(projectManager)
		.innerJoin(project, eq(project.id, projectManager.projectId))
		.where(
			and(
				eq(projectManager.projectId, work.projectId),
				eq(projectManager.employeeId, actorEmployeeId),
				eq(project.organizationId, input.organizationId),
			),
		)
		.for("share");
	return managed ? work.projectId : null;
}

/** The billability authority changes billability and nothing else (#900). */
function assertAuthorityPermitsIntent(input: AmendCompletedWorkInput): void {
	if (input.authority !== "owner_manager_or_project_manager") return;
	const { intent } = input;
	if (
		intent.clockIn.kind !== "preserve" ||
		intent.clockOut.kind !== "preserve" ||
		intent.project.kind !== "preserve" ||
		intent.workCategory.kind !== "preserve" ||
		intent.workLocation.kind !== "preserve" ||
		(intent.vehicleUse !== undefined && intent.vehicleUse.kind !== "preserve") ||
		intent.billable?.kind !== "set"
	) {
		throw new AuthorizationError({
			message: "Only billability can be changed with this authority",
			userId: input.actorUserId,
			resource: "time_entry",
			action: "correct",
		});
	}
}

async function assertProjectEligible(
	tx: TransactionClient,
	input: { organizationId: string; employeeId: string; teamId: string | null; projectId: string },
) {
	const [row] = await tx
		.select({ id: project.id, isActive: project.isActive, status: project.status })
		.from(project)
		.where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId)))
		.for("share");
	if (!row) throw new ValidationError({ message: "Project not found", field: "projectId" });
	if (!row.isActive) {
		throw new ValidationError({
			message: "Cannot book time to an inactive project",
			field: "projectId",
		});
	}
	if (!(BOOKABLE_PROJECT_STATUSES as readonly string[]).includes(row.status)) {
		throw new ValidationError({
			message: `Cannot book time to ${row.status} projects. Project must be planned, active, or paused.`,
			field: "projectId",
		});
	}
	const [assignment] = await tx
		.select({ id: projectAssignment.id })
		.from(projectAssignment)
		.where(
			and(
				eq(projectAssignment.projectId, input.projectId),
				eq(projectAssignment.organizationId, input.organizationId),
				input.teamId
					? or(
							eq(projectAssignment.employeeId, input.employeeId),
							eq(projectAssignment.teamId, input.teamId),
						)
					: eq(projectAssignment.employeeId, input.employeeId),
			),
		)
		.limit(1);
	if (!assignment) {
		throw new ValidationError({
			message: "You are not assigned to this project. Contact your administrator.",
			field: "projectId",
		});
	}
}

function taskRefusal(reason: ProjectTaskIneligibility) {
	return new ValidationError({
		message: PROJECT_TASK_INELIGIBILITY_MESSAGES[reason],
		field: "taskId",
		value: reason,
	});
}

/**
 * A newly booked task (#873), re-checked under locks: an open task of the
 * resulting project, which must itself stay bookable for the owner (the project
 * row is locked like a project change). The stable reason is the refusal's `value`.
 */
async function assertTaskBookable(
	tx: TransactionClient,
	input: {
		organizationId: string;
		employeeId: string;
		teamId: string | null;
		projectId: string | null;
		taskId: string;
	},
) {
	const reason = await taskBookingIneligibility(tx, input, { lock: "share" });
	if (reason) throw taskRefusal(reason);
	try {
		// The task is in the resulting project, so that project is not null here.
		await assertProjectEligible(tx, { ...input, projectId: input.projectId as string });
	} catch (error) {
		if (error instanceof ValidationError) throw taskRefusal("project_not_bookable");
		throw error;
	}
}

/**
 * A segment's attribution; the task and vehicle use are recorded only when there
 * is one, keeping earlier receipts' shape.
 */
function segmentAttribution(values: {
	projectId: string | null;
	taskId?: string | null;
	isBillable: boolean;
	workCategoryId: string | null;
	workLocationType: string | null;
	vehicleUse?: WorkVehicleUse | null;
}): AmendedSegment["attribution"] {
	return {
		projectId: values.projectId,
		...recordedTaskId(values.taskId),
		isBillable: values.isBillable,
		workCategoryId: values.workCategoryId,
		workLocationType: values.workLocationType,
		...(values.vehicleUse ? { vehicleUse: values.vehicleUse } : {}),
	};
}

/**
 * The receipt's changes: `task` and `vehicleUse` only when they changed, keeping
 * earlier receipts' shape.
 */
function receiptChanges(
	changes: Omit<AmendCompletedWorkResult["changes"], "task" | "vehicleUse"> & {
		task: boolean;
		vehicleUse: boolean;
	},
): AmendCompletedWorkResult["changes"] {
	const { task, vehicleUse, ...rest } = changes;
	return {
		...rest,
		...(task ? { task: true as const } : {}),
		...(vehicleUse ? { vehicleUse: true as const } : {}),
	};
}

/**
 * Fresh amendment in append admission, with its receipt. The caller has already
 * ruled out committed replay under the same transaction, so an existing receipt
 * with this identity is a collision.
 */
export async function amendCompletedWork(
	scope: SealedWorkTransactionScope,
	input: AmendCompletedWorkInput,
): Promise<AmendCompletedWorkReceipt> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	if (scope.admission !== "append") {
		throw new Error("Completed-work amendment requires the adopted work transaction");
	}
	const [existing] = await scope.db
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.command.operationId))
		.limit(1);
	if (existing) throw new CompletedWorkCollisionError();

	const amended = await amendWork(scope, input);
	await insertReceipt(scope.db, input, amended.result.workPeriodId, amended.result);
	return { disposition: "executed", ...amended };
}

/**
 * The amendment of an organization in legacy admission (#1225): the same
 * caller policy and the same change through work records, whose legacy writer
 * appends any correction entries. Legacy admission commits no receipt, so a
 * retry is not recognized; callers choose by admission until admission is
 * hidden (#1231).
 */
export async function amendLegacyCompletedWork(
	scope: SealedWorkTransactionScope,
	input: AmendCompletedWorkInput,
): Promise<AmendCompletedWorkReceipt> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	if (scope.admission !== "legacy") {
		throw new Error("Legacy completed-work amendment requires the legacy work transaction");
	}
	return { disposition: "executed", ...(await amendWork(scope, input)) };
}

/**
 * The amendment's caller policy, then the change: current authority, the
 * caller's own change policy (the billability authority, a project manager's
 * project), the unresolved-review guard, the requested times (range rule, no
 * future endpoints) and attribution eligibility, on exactly the rows work
 * records will change, locked. Work records applies the times and the
 * attribution patch to both records with the effects (ADR 0010).
 */
async function amendWork(
	scope: SealedWorkTransactionScope,
	input: AmendCompletedWorkInput,
): Promise<Omit<AmendCompletedWorkReceipt, "disposition">> {
	const { organizationId, employeeId, intent: requested } = input;
	const tx = scope.db;
	assertAuthorityPermitsIntent(input);
	const target = await lockAuthority(tx, { ...input, workPeriodId: requested.workPeriodId });
	const changesAttribution =
		requested.project.kind === "replace" ||
		requested.task?.kind === "replace" ||
		requested.workCategory.kind === "replace";
	const teamId = changesAttribution
		? await lockTrustedTimeCorrectionEmployeeTeamId({
				tx,
				employeeId,
				employeeTeamId: target.teamId,
				organizationId,
			})
		: null;

	// Authoritative source: the routed period with its entries and canonical work record, locked.
	const current = await readWorkRecord(
		scope,
		{ organizationId, employeeId, workPeriodId: requested.workPeriodId },
		{ lock: true },
	);
	if (!current) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: requested.workPeriodId,
		});
	}
	const { period } = current;
	if (
		period.clockInId !== input.expectedSource.clockInId ||
		period.clockOutId !== input.expectedSource.clockOutId ||
		!sameInstant(period.startTime, input.expectedSource.startAt) ||
		!sameInstant(period.endTime, input.expectedSource.endAt)
	) {
		throw staleSource();
	}
	// A project manager's authority holds only while the work is on their project.
	if (target.authorizedProjectId !== null && period.projectId !== target.authorizedProjectId) {
		throw staleSource();
	}
	await assertNoUnresolvedWorkPeriodReview(tx, organizationId, period);
	const running = new ConflictError({
		message: "Cannot edit an active work period. Please clock out first.",
		conflictType: "work_period_running",
	});
	if (period.isActive && period.endTime === null && period.clockOutId === null) {
		if (requested.clockIn.kind !== "preserve" || requested.clockOut.kind !== "preserve") {
			throw running;
		}
		// Legacy clock-outs decide billability at recording: live work keeps it until then.
		if (scope.admission === "legacy" && requested.project.kind === "preserve") throw running;
		return amendActiveAttribution(scope, input, period, teamId);
	}
	if (period.isActive || !period.endTime || !period.clockOutId) throw running;

	const sourceVehicleUse = vehicleUseFromColumns(period);
	let plan: ReturnType<typeof planCompletedWorkAmendment>;
	try {
		plan = planCompletedWorkAmendment(
			{
				startAt: instantFromDate(period.startTime),
				endAt: instantFromDate(period.endTime),
				durationMinutes: period.durationMinutes,
				projectId: period.projectId,
				taskId: period.taskId,
				workCategoryId: period.workCategoryId,
				workLocationType: period.workLocationType,
				isBillable: period.isBillable,
				vehicleUse: sourceVehicleUse,
			},
			{
				clockIn: endpointIntent(requested.clockIn),
				clockOut: endpointIntent(requested.clockOut),
				project: requested.project,
				task: requested.task,
				workCategory: requested.workCategory,
				workLocation: requested.workLocation,
				billable: requested.billable,
				vehicleUse: requested.vehicleUse,
			},
		);
	} catch (error) {
		throw planningFailure(error);
	}
	const { changes, result: resulting } = plan;
	if (changes.clockIn && compareInstants(resulting.startAt, input.evaluatedAt) > 0) {
		throw new ValidationError({
			message: "Clock in time cannot be in the future",
			field: "timestamp",
		});
	}
	if (changes.clockOut && compareInstants(resulting.endAt, input.evaluatedAt) > 0) {
		throw new ValidationError({
			message: "Clock out time cannot be in the future",
			field: "timestamp",
		});
	}
	await assertAttributionEligible(tx, {
		organizationId,
		employeeId,
		teamId,
		changes,
		resulting,
		currentWorkCategoryId: period.workCategoryId,
		currentVehicleUse: sourceVehicleUse,
	});

	const amendment = orRefuse(
		await applyWorkRecordChange(scope, {
			kind: "amend",
			organizationId,
			employeeId,
			expected: current.expected,
			times:
				changes.clockIn || changes.clockOut
					? {
							...(changes.clockIn ? { clockIn: amendedEndpoint(requested.clockIn) } : {}),
							...(changes.clockOut ? { clockOut: amendedEndpoint(requested.clockOut) } : {}),
							notes: requested.notes,
							entries: {
								createdBy: input.actorUserId,
								ipAddress: input.request.ipAddress,
								deviceInfo: input.request.deviceInfo,
							},
							appendOperation: "completed_work_correction",
						}
					: undefined,
			attribution: attributionPatch(plan, requested.billable),
			actorUserId: input.actorUserId,
		}),
	);
	const parts = new Set(amendment.changes.attribution);
	const result: AmendCompletedWorkResult = {
		version: AMEND_COMPLETED_WORK_RESULT_VERSION,
		operationId: input.command.operationId,
		owner: { employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		authority: input.authority,
		intent: requested,
		workPeriodId: period.id,
		canonicalRecordId: amendment.segment.canonicalRecordId,
		source: amendedSegment(amendment.source.segment),
		segment: amendedSegment(amendment.segment),
		changes: receiptChanges({
			clockIn: amendment.changes.clockIn,
			clockOut: amendment.changes.clockOut,
			project: parts.has("project"),
			task: parts.has("task"),
			workCategory: parts.has("work_category"),
			workLocation: parts.has("work_location"),
			billable: parts.has("billable"),
			vehicleUse: parts.has("vehicle_use"),
		}),
		corrections: amendment.appended.corrections.map((correction) => ({
			endpoint: correction.endpoint,
			entryId: correction.entryId,
			replacesEntryId: correction.replacesEntryId,
			previousEntryId: correction.previousEntryId,
			previousHash: correction.previousHash,
		})),
		revisions: {
			workPeriod: { source: amendment.source.revision, result: amendment.after.revision },
		},
		append: {
			admission: amendment.appended.admission,
			used: amendment.appended.corrections.length > 0,
		},
		approvalState: period.approvalStatus,
		followUps: [
			{
				kind: "work_balance_refresh",
				delivery: "committed_intent",
				dirtyFromDate: amendment.effects.workBalanceDirtyFromDate,
			},
		],
	};
	return { result, correctionEntries: amendment.appended.entries };
}

/** A set endpoint as work records takes it: the instant and its capture. */
function amendedEndpoint(command: EndpointCommand): AmendedEndpoint | undefined {
	if (command.kind !== "set") return undefined;
	return {
		at: parseInstant(command.at),
		capture: {
			utcOffsetMinutes: command.utcOffsetMinutes,
			timezone: command.timezone,
			timezoneSource: command.timezoneSource,
		},
	};
}

/**
 * The attribution patch work records applies: the parts the request changes,
 * named by their resulting value, and an explicit billability. Work records
 * applies the rules again (the task follows the project, a new project takes
 * its billable default).
 */
function attributionPatch(
	plan: ReturnType<typeof planCompletedWorkAmendment>,
	billable: BillableIntent | undefined,
): AmendAttributionPatch | undefined {
	const { changes, result } = plan;
	const patch: AmendAttributionPatch = {
		...(changes.project ? { project: result.projectId } : {}),
		...(changes.task ? { task: result.taskId } : {}),
		...(changes.workCategory ? { workCategoryId: result.workCategoryId } : {}),
		...(changes.workLocation
			? { workLocationType: result.workLocationType as WorkLocationType | null }
			: {}),
		...(changes.vehicleUse ? { vehicleUse: result.vehicleUse } : {}),
		...(billable?.kind === "set" ? { billable: billable.billable } : {}),
	};
	return Object.keys(patch).length > 0 ? patch : undefined;
}

/** A work records segment in the receipt's segment shape (receipt version 1). */
function amendedSegment(segment: WorkSegment): AmendedSegment {
	const { attribution } = segment;
	return {
		clockInEntryId: segment.clockInEntryId,
		clockOutEntryId: segment.clockOutEntryId,
		startAt: segment.startAt,
		endAt: segment.endAt,
		durationMinutes: segment.durationMinutes,
		startUtcOffsetMinutes: segment.startUtcOffsetMinutes,
		endUtcOffsetMinutes: segment.endUtcOffsetMinutes,
		attribution: segmentAttribution({
			projectId: attribution.projectId,
			taskId: attribution.taskId ?? null,
			isBillable: attribution.isBillable ?? false,
			workCategoryId: attribution.workCategoryId,
			workLocationType: attribution.workLocationType,
			vehicleUse: attribution.vehicleUse ?? null,
		}),
	};
}

/** Replacement attribution must be eligible for the owner, re-checked under locks. */
async function assertAttributionEligible(
	tx: TransactionClient,
	input: {
		organizationId: string;
		employeeId: string;
		teamId: string | null;
		changes: { project: boolean; task: boolean; workCategory: boolean; vehicleUse: boolean };
		resulting: {
			projectId: string | null;
			taskId: string | null;
			workCategoryId: string | null;
			vehicleUse: WorkVehicleUse | null;
		};
		currentWorkCategoryId: string | null;
		currentVehicleUse: WorkVehicleUse | null;
	},
) {
	if (input.changes.project && input.resulting.projectId) {
		await assertProjectEligible(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			teamId: input.teamId,
			projectId: input.resulting.projectId,
		});
	}
	if (input.changes.task && input.resulting.taskId) {
		await assertTaskBookable(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			teamId: input.teamId,
			projectId: input.resulting.projectId,
			taskId: input.resulting.taskId,
		});
	}
	if (input.changes.workCategory) {
		await authorizeTimeCorrectionCategoryChange({
			tx,
			employeeId: input.employeeId,
			teamId: input.teamId,
			organizationId: input.organizationId,
			proposedWorkCategoryId: input.resulting.workCategoryId,
			currentWorkCategoryId: input.currentWorkCategoryId,
		});
	}
	if (input.changes.vehicleUse) {
		await assertWorkVehicleUseChangeAllowed(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			previous: input.currentVehicleUse,
			resulting: input.resulting.vehicleUse,
		});
	}
}

/**
 * Attribution of active work. There is no canonical record or end yet; the
 * closing operation carries the period's attribution into them (#274 preserves
 * omitted attribution). The period revision advances so a closure routed on the
 * earlier revision cannot commit over this change.
 */
async function amendActiveAttribution(
	scope: SealedWorkTransactionScope,
	input: AmendCompletedWorkInput,
	period: typeof workPeriod.$inferSelect,
	teamId: string | null,
): Promise<Omit<AmendCompletedWorkReceipt, "disposition">> {
	const tx = scope.db;
	const { organizationId, employeeId, command, intent: requested } = input;
	const source = {
		projectId: period.projectId,
		taskId: period.taskId,
		workCategoryId: period.workCategoryId,
		workLocationType: period.workLocationType,
		isBillable: period.isBillable,
		vehicleUse: vehicleUseFromColumns(period),
	};
	let planned: ReturnType<typeof planAttributionChange>;
	try {
		planned = planAttributionChange(source, requested);
	} catch (error) {
		throw planningFailure(error);
	}
	await assertAttributionEligible(tx, {
		organizationId,
		employeeId,
		teamId,
		changes: planned.changes,
		resulting: planned.result,
		currentWorkCategoryId: period.workCategoryId,
		currentVehicleUse: source.vehicleUse,
	});
	const isBillable = await resolveWorkBillabilityInTransaction(tx, organizationId, {
		projectId: planned.result.projectId,
		projectChosen: planned.changes.project,
		current: period.isBillable,
		requested: requested.billable?.kind === "set" ? requested.billable.billable : undefined,
	});
	const changes = { ...planned.changes, billable: isBillable !== period.isBillable };
	const resultRevision = period.graphRevision + 1;
	const vehicle = vehicleUseColumns(planned.result.vehicleUse);
	const updated = await tx
		.update(workPeriod)
		.set({
			projectId: planned.result.projectId,
			isBillable,
			taskId: planned.result.taskId,
			workCategoryId: planned.result.workCategoryId,
			workLocationType: planned.result.workLocationType as WorkLocationType | null,
			vehicleKind: vehicle.vehicleKind,
			vehicleId: vehicle.vehicleId,
			odometerStartKm: vehicle.odometerStartKm,
			odometerEndKm: vehicle.odometerEndKm,
			drivenDistanceKm: vehicle.drivenDistanceKm,
			graphRevision: resultRevision,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.clockOutId),
				eq(workPeriod.graphRevision, period.graphRevision),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (updated.length !== 1) throw staleSource();
	// Live work's attribution covers it from its start on: submitted periods it touches go
	// back to the employee (#805).
	if (Object.values(changes).some(Boolean)) {
		await sendBackChangedPeriodSubmissions(tx, {
			organizationId,
			employeeId,
			causedByUserId: input.actorUserId,
			work: [{ start: instantFromDate(period.startTime), end: null }],
		});
	}

	const [clockIn] = await tx
		.select({ utcOffsetMinutes: timeEntry.utcOffsetMinutes })
		.from(timeEntry)
		.where(and(eq(timeEntry.id, period.clockInId), eq(timeEntry.organizationId, organizationId)))
		.limit(1);
	const activeSegment = (attribution: AmendedSegment["attribution"]): AmendedSegment => ({
		clockInEntryId: period.clockInId,
		clockOutEntryId: null,
		startAt: instantToCanonicalString(instantFromDate(period.startTime)),
		endAt: null,
		durationMinutes: null,
		startUtcOffsetMinutes: clockIn?.utcOffsetMinutes ?? null,
		endUtcOffsetMinutes: null,
		attribution,
	});
	const result: AmendCompletedWorkResult = {
		version: AMEND_COMPLETED_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		authority: input.authority,
		intent: requested,
		workPeriodId: period.id,
		canonicalRecordId: null,
		source: activeSegment(segmentAttribution(source)),
		segment: activeSegment(segmentAttribution({ ...planned.result, isBillable })),
		changes: receiptChanges({ clockIn: false, clockOut: false, ...changes }),
		corrections: [],
		revisions: { workPeriod: { source: period.graphRevision, result: resultRevision } },
		append: { admission: scope.admission, used: false },
		approvalState: period.approvalStatus,
		followUps: [],
	};
	return { result, correctionEntries: [] };
}

async function insertReceipt(
	tx: TransactionClient,
	input: AmendCompletedWorkInput,
	workPeriodId: string,
	result: AmendCompletedWorkResult,
) {
	await tx.insert(completedWorkOperation).values({
		id: input.command.operationId,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		kind: "amend_completed_work",
		writer: input.writer,
		writerVersion: AMEND_COMPLETED_WORK_WRITER_VERSION,
		commandVersion: input.command.version,
		command: input.command,
		appendAdmission: "append",
		actorKind: "human",
		actorUserId: input.actorUserId,
		workPeriodId,
		resultVersion: AMEND_COMPLETED_WORK_RESULT_VERSION,
		result,
	});
}

/**
 * User-facing outcome of an operation error, or null for unexpected failures.
 * A closed month (#762) also names the month, for translated wording.
 */
export function describeAmendmentFailure(
	error: unknown,
): { message: string; code: string; month?: string } | null {
	const closed = monthClosedRefusalOf(error);
	if (closed) {
		return { message: closed.message, code: "month_closed", month: closed.month };
	}
	if (error instanceof CompletedWorkCollisionError) {
		return {
			message:
				"This change conflicts with an earlier request or changed work. Please refresh and try again.",
			code: "completed_work_collision",
		};
	}
	if (error instanceof WorkOccupancyConflictError) {
		return { message: error.message, code: "work_interval_occupied" };
	}
	if (error instanceof BillableWorkRefusedError) {
		return { message: error.message, code: "billable_not_allowed" };
	}
	if (error instanceof CompletedWorkReviewRequiredError) {
		return { message: error.message, code: "completed_work_review_required" };
	}
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		return {
			message: "This work needs review before it can be changed",
			code: "completed_work_review_required",
		};
	}
	if (error instanceof CompletedWorkIntegrityError) {
		// A committed-evidence or graph invariant failed: an incident, not user error.
		logger.error({ error }, "Completed-work amendment integrity failure");
		return {
			message: "This work could not be changed because its records disagree",
			code: "completed_work_integrity",
		};
	}
	return null;
}
