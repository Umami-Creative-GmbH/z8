import "server-only";

/**
 * Completed-work operation for direct amendments (#286 / T22, design #256).
 *
 * One call inside the completed-work outer transaction corrects the endpoints
 * and/or changes the attribution of one completed period. It owns the
 * authoritative locked reads, current scoped authorization, symmetric
 * occupancy, fresh duration, the correction entries through the append
 * collaborator, the period, canonical base/detail/allocation, the work revision,
 * the work-balance refresh intent and the committed receipt. Callers supply
 * intent and evidence, never durations, links or storage patches.
 *
 * Replaced entries are superseded, never removed: their hashes stay predecessor
 * evidence. Exact replay of a committed receipt writes nothing, and a receipt
 * whose work has since changed or been deleted is a collision, never new work.
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
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import {
	authorizeTimeCorrectionCategoryChange,
	lockTrustedTimeCorrectionEmployeeTeamId,
} from "@/lib/approvals/server/time-correction-category-authorization";
import { BOOKABLE_PROJECT_STATUSES } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	compareInstants,
	dateFromInstant,
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
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
	type AmendmentIntent,
	AmendmentNoChangeError,
	AmendmentRangeError,
	type EndpointIntent,
	planAttributionChange,
	planCompletedWorkAmendment,
} from "./amend-completed-work-plan";
import { calculateHash } from "./blockchain";
import {
	type AttributionIntent,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
	type CompletedWorkFollowUp,
	earliestStartDate,
} from "./close-active-work";
import { canonicalJson } from "./canonical-json";
import { admitTimeEntryAppend, TimeEntryAppendReviewRequiredError } from "./time-entry-append";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import { WorkIntervalError } from "./work-duration";
import type { WorkLocationType } from "./work-location";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { assertWorkOccupancyFree, WorkOccupancyConflictError } from "./work-occupancy";
import { assertNoUnresolvedWorkPeriodReview } from "./work-period-review";
import type { WorkTransactionScope } from "./work-transaction";

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
 */
export type AmendmentAuthority = "owner" | "organization_admin" | "owner_or_manager";

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
	workCategory: AttributionIntent;
	workLocation: AttributionIntent;
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
		workCategoryId: string | null;
		workLocationType: string | null;
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
		workCategory: boolean;
		workLocation: boolean;
	};
	corrections: Array<{
		endpoint: "clock_in" | "clock_out";
		entryId: string;
		replacesEntryId: string;
		previousEntryId: string | null;
		previousHash: string | null;
	}>;
	revisions: { workPeriod: { source: number; result: number } };
	append: { admission: "append"; used: boolean };
	/** Unchanged by a direct amendment; recorded as committed evidence. */
	approvalState: string | null;
	followUps: CompletedWorkFollowUp[];
};

export type AmendCompletedWorkReceipt = {
	disposition: "executed" | "replayed";
	result: AmendCompletedWorkResult;
	correctionEntries: Array<typeof timeEntry.$inferSelect>;
};

/** Evidence the work graph needs review before this operation may change it. */
export class CompletedWorkReviewRequiredError extends Error {
	constructor(
		readonly reason: "canonical_record_missing" | "canonical_divergence" | "endpoint_entry_missing",
	) {
		super("This work needs review before it can be changed");
		this.name = "CompletedWorkReviewRequiredError";
	}
}

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

type TransactionClient = WorkTransactionScope["db"];

const logger = createLogger("CompletedWorkAmendment");

function staleSource(): ConflictError {
	return new ConflictError({
		message: "Work period changed while editing",
		conflictType: "time_correction_work_period_stale",
	});
}

function alreadyCorrected(): ConflictError {
	return new ConflictError({
		message: "Time entry was already corrected by another process",
		conflictType: "time_entry_already_corrected",
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
	scope: WorkTransactionScope,
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
	await lockAuthority(scope.db, { ...input, authority: result.authority });
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
	scope: WorkTransactionScope,
	input: AmendCompletedWorkInput,
): Promise<AmendCompletedWorkReceipt> {
	return (await replayAmendCompletedWork(scope, input)) ?? (await amendCompletedWork(scope, input));
}

async function lockAuthority(
	tx: TransactionClient,
	input: Pick<
		AmendCompletedWorkInput,
		"organizationId" | "employeeId" | "actorUserId" | "authority"
	>,
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

	if (input.authority === "organization_admin") {
		if (
			!hasOrganizationRole(membership.role, "owner") &&
			!hasOrganizationRole(membership.role, "admin")
		) {
			throw new AuthorizationError({
				message: "Only organization owners and admins can edit this time entry",
				userId: input.actorUserId,
				resource: "time_entry",
				action: "correct",
			});
		}
		return target;
	}
	const actorEmployee = actorEmployees.length === 1 ? actorEmployees[0] : undefined;
	if (!actorEmployee) throw notAuthorized(input.actorUserId);
	if (actorEmployee.id === input.employeeId) return target;
	if (input.authority === "owner") throw notAuthorized(input.actorUserId);
	if (actorEmployee.role !== "admin") {
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
		if (!link) throw notAuthorized(input.actorUserId);
	}
	return target;
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

/**
 * Fresh amendment. The caller has already ruled out committed replay under the
 * same transaction, so an existing receipt with this identity is a collision.
 */
export async function amendCompletedWork(
	scope: WorkTransactionScope,
	input: AmendCompletedWorkInput,
): Promise<AmendCompletedWorkReceipt> {
	const { organizationId, employeeId, command, intent: requested } = input;
	scope.assertEmployee(organizationId, employeeId);
	if (scope.admission !== "append") {
		throw new Error("Completed-work amendment requires the adopted work transaction");
	}
	const tx = scope.db;
	const [existing] = await tx
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, command.operationId))
		.limit(1);
	if (existing) throw new CompletedWorkCollisionError();

	const target = await lockAuthority(tx, input);
	const changesAttribution =
		requested.project.kind === "replace" || requested.workCategory.kind === "replace";
	const teamId = changesAttribution
		? await lockTrustedTimeCorrectionEmployeeTeamId({
				tx,
				employeeId,
				employeeTeamId: target.teamId,
				organizationId,
			})
		: null;

	// Authoritative source: the routed period and its entries, locked.
	const [period] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, requested.workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.for("update");
	if (!period) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: requested.workPeriodId,
		});
	}
	if (
		period.clockInId !== input.expectedSource.clockInId ||
		period.clockOutId !== input.expectedSource.clockOutId ||
		!sameInstant(period.startTime, input.expectedSource.startAt) ||
		!sameInstant(period.endTime, input.expectedSource.endAt)
	) {
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
		return amendActiveAttribution(tx, input, period, teamId);
	}
	if (period.isActive || !period.endTime || !period.clockOutId) throw running;

	const endpointIds = [period.clockInId, period.clockOutId];
	const originals = await tx
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, organizationId),
				eq(timeEntry.employeeId, employeeId),
				inArray(timeEntry.id, endpointIds),
			),
		)
		.orderBy(asc(timeEntry.id))
		.for("update");
	const originalClockIn = originals.find(({ id }) => id === period.clockInId);
	const originalClockOut = originals.find(({ id }) => id === period.clockOutId);
	if (!originalClockIn || !originalClockOut) {
		throw new CompletedWorkReviewRequiredError("endpoint_entry_missing");
	}
	if (originalClockIn.isSuperseded || originalClockOut.isSuperseded) throw alreadyCorrected();

	// The period and its canonical record must describe the same segment before
	// this operation changes both. A missing or diverging record is evidence for
	// review (historical repair), never something to rebuild inline.
	if (!period.canonicalRecordId) {
		throw new CompletedWorkReviewRequiredError("canonical_record_missing");
	}
	const [record] = await tx
		.select()
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.for("update");
	const [detail] = await tx
		.select()
		.from(timeRecordWork)
		.where(
			and(
				eq(timeRecordWork.recordId, period.canonicalRecordId),
				eq(timeRecordWork.organizationId, organizationId),
				eq(timeRecordWork.recordKind, "work"),
			),
		)
		.for("update");
	const projectAllocations = await tx
		.select()
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.recordId, period.canonicalRecordId),
				eq(timeRecordAllocation.organizationId, organizationId),
				eq(timeRecordAllocation.allocationKind, "project"),
			),
		)
		.orderBy(asc(timeRecordAllocation.id))
		.for("update");
	if (!record || !detail) throw new CompletedWorkReviewRequiredError("canonical_record_missing");
	const allocationAgrees = period.projectId
		? projectAllocations.length === 1 &&
			projectAllocations[0]?.projectId === period.projectId &&
			projectAllocations[0]?.weightPercent === 100
		: projectAllocations.length === 0;
	if (
		!sameInstant(record.startAt, instantFromDate(period.startTime)) ||
		!sameInstant(record.endAt, instantFromDate(period.endTime)) ||
		detail.workCategoryId !== period.workCategoryId ||
		detail.workLocationType !== period.workLocationType ||
		!allocationAgrees
	) {
		throw new CompletedWorkReviewRequiredError("canonical_divergence");
	}

	const intent: AmendmentIntent = {
		clockIn: endpointIntent(requested.clockIn),
		clockOut: endpointIntent(requested.clockOut),
		project: requested.project,
		workCategory: requested.workCategory,
		workLocation: requested.workLocation,
	};
	let plan: ReturnType<typeof planCompletedWorkAmendment>;
	try {
		plan = planCompletedWorkAmendment(
			{
				startAt: instantFromDate(period.startTime),
				endAt: instantFromDate(period.endTime),
				durationMinutes: period.durationMinutes,
				projectId: period.projectId,
				workCategoryId: period.workCategoryId,
				workLocationType: period.workLocationType,
			},
			intent,
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
	});
	const endpointsChanged = changes.clockIn || changes.clockOut;
	if (endpointsChanged) {
		await assertWorkOccupancyFree(tx, {
			organizationId,
			employeeId,
			interval: { startAt: resulting.startAt, endAt: resulting.endAt },
			excludeWorkPeriodIds: [period.id],
		});
	}

	// Correction entries: exact predecessor from the append collaborator.
	const corrections: AmendCompletedWorkResult["corrections"] = [];
	const correctionEntries: Array<typeof timeEntry.$inferSelect> = [];
	const replacements = new Map<string, typeof timeEntry.$inferSelect>();
	if (endpointsChanged) {
		const admission = await admitTimeEntryAppend(
			tx,
			{ organizationId, employeeId },
			"completed_work_correction",
		);
		if (admission.kind === "review_required") {
			throw new TimeEntryAppendReviewRequiredError(admission.requirement);
		}
		const append = admission.append;
		for (const endpoint of [
			{
				kind: "clock_in" as const,
				changed: changes.clockIn,
				command: requested.clockIn,
				original: originalClockIn,
			},
			{
				kind: "clock_out" as const,
				changed: changes.clockOut,
				command: requested.clockOut,
				original: originalClockOut,
			},
		]) {
			if (!endpoint.changed || endpoint.command.kind !== "set") continue;
			const timestamp = dateFromInstant(parseInstant(endpoint.command.at));
			const previousHash = append.predecessor?.hash ?? null;
			const previousEntryId = append.predecessor?.id ?? null;
			const [entry] = await tx
				.insert(timeEntry)
				.values({
					employeeId,
					organizationId,
					type: "correction",
					timestamp,
					hash: calculateHash({
						employeeId,
						type: "correction",
						timestamp: timestamp.toISOString(),
						previousHash,
					}),
					previousHash,
					previousEntryId,
					replacesEntryId: endpoint.original.id,
					notes: requested.notes,
					ipAddress: input.request.ipAddress,
					deviceInfo: input.request.deviceInfo,
					createdBy: input.actorUserId,
					utcOffsetMinutes: endpoint.command.utcOffsetMinutes,
					timezone: endpoint.command.timezone,
					timezoneSource: endpoint.command.timezoneSource,
				})
				.returning();
			if (!entry) throw new Error("Correction entry insert failed");
			await append.record({ id: entry.id, hash: entry.hash, previousEntryId, previousHash });
			const superseded = await tx
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: entry.id })
				.where(
					and(
						eq(timeEntry.id, endpoint.original.id),
						eq(timeEntry.organizationId, organizationId),
						eq(timeEntry.employeeId, employeeId),
						eq(timeEntry.isSuperseded, false),
					),
				)
				.returning({ id: timeEntry.id });
			if (superseded.length !== 1) throw alreadyCorrected();
			replacements.set(endpoint.original.id, entry);
			correctionEntries.push(entry);
			corrections.push({
				endpoint: endpoint.kind,
				entryId: entry.id,
				replacesEntryId: endpoint.original.id,
				previousEntryId,
				previousHash,
			});
		}
	}
	const resultClockIn = replacements.get(originalClockIn.id) ?? originalClockIn;
	const resultClockOut = replacements.get(originalClockOut.id) ?? originalClockOut;

	const startAt = dateFromInstant(resulting.startAt);
	const endAt = dateFromInstant(resulting.endAt);
	const updatedAt = new Date();
	const resultRevision = period.graphRevision + 1;
	const updated = await tx
		.update(workPeriod)
		.set({
			clockInId: resultClockIn.id,
			clockOutId: resultClockOut.id,
			startTime: startAt,
			endTime: endAt,
			durationMinutes: resulting.durationMinutes,
			projectId: resulting.projectId,
			workCategoryId: resulting.workCategoryId,
			workLocationType: resulting.workLocationType as WorkLocationType | null,
			graphRevision: resultRevision,
			updatedAt,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.clockInId, period.clockInId),
				eq(workPeriod.clockOutId, period.clockOutId),
				eq(workPeriod.graphRevision, period.graphRevision),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (updated.length !== 1) throw staleSource();

	// Metadata-only changes keep the record's own, possibly historical, minutes.
	const updatedRecords = await tx
		.update(timeRecord)
		.set({
			...(endpointsChanged ? { startAt, endAt, durationMinutes: resulting.durationMinutes } : {}),
			updatedAt,
			updatedBy: input.actorUserId,
		})
		.where(
			and(
				eq(timeRecord.id, record.id),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.returning({ id: timeRecord.id });
	if (updatedRecords.length !== 1) {
		throw new CompletedWorkIntegrityError("Canonical work record update failed");
	}
	if (changes.workCategory || changes.workLocation) {
		const updatedDetails = await tx
			.update(timeRecordWork)
			.set({
				workCategoryId: resulting.workCategoryId,
				workLocationType: resulting.workLocationType as WorkLocationType | null,
			})
			.where(
				and(
					eq(timeRecordWork.recordId, record.id),
					eq(timeRecordWork.organizationId, organizationId),
					eq(timeRecordWork.recordKind, "work"),
				),
			)
			.returning({ recordId: timeRecordWork.recordId });
		if (updatedDetails.length !== 1) {
			throw new CompletedWorkIntegrityError("Canonical work metadata update failed");
		}
	}
	// Only project allocations follow the project; other allocation kinds stay.
	if (changes.project) {
		if (projectAllocations.length > 0) {
			await tx.delete(timeRecordAllocation).where(
				and(
					eq(timeRecordAllocation.organizationId, organizationId),
					inArray(
						timeRecordAllocation.id,
						projectAllocations.map(({ id }) => id),
					),
				),
			);
		}
		if (resulting.projectId) {
			await tx.insert(timeRecordAllocation).values({
				organizationId,
				recordId: record.id,
				allocationKind: "project",
				projectId: resulting.projectId,
				weightPercent: 100,
			});
		}
	}

	const followUps: CompletedWorkFollowUp[] = [];
	if (endpointsChanged) {
		// Required recalculation commits with the work: from the earliest UTC or
		// captured-offset local date of every original and resulting endpoint.
		// Entries without a captured offset fall back to their UTC date.
		const [dirtyFromDate] = [originalClockIn, originalClockOut, resultClockIn, resultClockOut]
			.map((entry) =>
				earliestStartDate(instantFromDate(entry.timestamp), entry.utcOffsetMinutes ?? 0),
			)
			.sort();
		if (!dirtyFromDate) throw new Error("Work balance refresh date is missing");
		await markEmployeeWorkBalanceDirty({ employeeId, organizationId, dirtyFromDate }, tx);
		followUps.push({ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate });
	}

	const segmentOf = (
		clockIn: typeof timeEntry.$inferSelect,
		clockOut: typeof timeEntry.$inferSelect,
		values: {
			startAt: Instant;
			endAt: Instant;
			durationMinutes: number | null;
			projectId: string | null;
			workCategoryId: string | null;
			workLocationType: string | null;
		},
	): AmendedSegment => ({
		clockInEntryId: clockIn.id,
		clockOutEntryId: clockOut.id,
		startAt: instantToCanonicalString(values.startAt),
		endAt: instantToCanonicalString(values.endAt),
		durationMinutes: values.durationMinutes,
		startUtcOffsetMinutes: clockIn.utcOffsetMinutes ?? null,
		endUtcOffsetMinutes: clockOut.utcOffsetMinutes ?? null,
		attribution: {
			projectId: values.projectId,
			workCategoryId: values.workCategoryId,
			workLocationType: values.workLocationType,
		},
	});
	const result: AmendCompletedWorkResult = {
		version: AMEND_COMPLETED_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		authority: input.authority,
		intent: requested,
		workPeriodId: period.id,
		canonicalRecordId: record.id,
		source: segmentOf(originalClockIn, originalClockOut, {
			startAt: instantFromDate(period.startTime),
			endAt: instantFromDate(period.endTime),
			durationMinutes: period.durationMinutes,
			projectId: period.projectId,
			workCategoryId: period.workCategoryId,
			workLocationType: period.workLocationType,
		}),
		segment: segmentOf(resultClockIn, resultClockOut, resulting),
		changes,
		corrections,
		revisions: { workPeriod: { source: period.graphRevision, result: resultRevision } },
		append: { admission: "append", used: endpointsChanged },
		approvalState: period.approvalStatus,
		followUps,
	};
	await insertReceipt(tx, input, period.id, result);

	return { disposition: "executed", result, correctionEntries };
}

/** Replacement attribution must be eligible for the owner, re-checked under locks. */
async function assertAttributionEligible(
	tx: TransactionClient,
	input: {
		organizationId: string;
		employeeId: string;
		teamId: string | null;
		changes: { project: boolean; workCategory: boolean };
		resulting: { projectId: string | null; workCategoryId: string | null };
		currentWorkCategoryId: string | null;
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
}

/**
 * Attribution of active work. There is no canonical record or end yet; the
 * closing operation carries the period's attribution into them (#274 preserves
 * omitted attribution). The period revision advances so a closure routed on the
 * earlier revision cannot commit over this change.
 */
async function amendActiveAttribution(
	tx: TransactionClient,
	input: AmendCompletedWorkInput,
	period: typeof workPeriod.$inferSelect,
	teamId: string | null,
): Promise<AmendCompletedWorkReceipt> {
	const { organizationId, employeeId, command, intent: requested } = input;
	const source = {
		projectId: period.projectId,
		workCategoryId: period.workCategoryId,
		workLocationType: period.workLocationType,
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
	});
	const resultRevision = period.graphRevision + 1;
	const updated = await tx
		.update(workPeriod)
		.set({
			projectId: planned.result.projectId,
			workCategoryId: planned.result.workCategoryId,
			workLocationType: planned.result.workLocationType as WorkLocationType | null,
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
		source: activeSegment(source),
		segment: activeSegment(planned.result),
		changes: { clockIn: false, clockOut: false, ...planned.changes },
		corrections: [],
		revisions: { workPeriod: { source: period.graphRevision, result: resultRevision } },
		append: { admission: "append", used: false },
		approvalState: period.approvalStatus,
		followUps: [],
	};
	await insertReceipt(tx, input, period.id, result);
	return { disposition: "executed", result, correctionEntries: [] };
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

/** User-facing outcome of an operation error, or null for unexpected failures. */
export function describeAmendmentFailure(error: unknown): { message: string; code: string } | null {
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
