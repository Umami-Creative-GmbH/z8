import "server-only";

/**
 * Manager on-behalf clock-out (#276 / T12).
 *
 * An authorized manager, owner or admin closes another employee's running work
 * period, named by the caller, at the current server time. The employee owns
 * the work; the acting human completes it; the clock-in keeps its own actor; the
 * event is captured in the target's zone, never the actor's.
 *
 * Order, as in the direct-HTTP transport (#275):
 * 1. current access, the named target in the active organization, creation
 *    authorization for that target, and billing;
 * 2. committed replay of the request's identity, in every adoption mode;
 * 3. fresh checks: the target is still running, explicit attribution is
 *    eligible for the target;
 * 4. the web clock-out coordinator (#272): replay again, then the completed-work
 *    operation in adopted organizations or the legacy closer otherwise.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import {
	type createBillingForbiddenResponse,
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	ClockingAccessError,
	ClockingConflictError,
	ClockingOrganizationError,
	clockingService,
	TimeEntryAppendReviewRequiredError,
} from "@/lib/time-tracking/clocking-service";
import {
	type AttributionIntent,
	attributionIntent,
	attributionValue,
	type CloseActiveWorkOperationCommand,
	type CloseActiveWorkResult,
	type CloseActiveWorkWriter,
	CompletedWorkAttributionError,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
	closeActiveWork,
	replayCloseActiveWork,
} from "@/lib/time-tracking/close-active-work";
import type { Entry } from "@/lib/time-tracking/clocking-core";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import type { OnBehalfClockOutRequest } from "@/lib/time-tracking/on-behalf-clock-out-request";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import {
	type WorkTransactionContext,
	withWebClockOutTransaction,
} from "@/lib/time-tracking/web-clock-out-transaction";
import { WorkIntervalError } from "@/lib/time-tracking/work-duration";
import {
	type ClockOutCommitOutcome,
	completeClockOutAfterCommit,
	createOrdinaryApprovalRuntime,
	validateWorkCategoryAssignment,
} from "./clocking";
import { validateProjectAssignment } from "./entry-helpers";
import { resolveManualEntryTarget, resolveManualEntryTargetZone } from "./manual-entry-target";
import { logger } from "./shared";

export const MANAGER_ON_BEHALF_WRITER = {
	writer: "manager_on_behalf",
	writerVersion: 1,
	// The established device evidence of on-behalf clock-out entries.
	deviceInfo: "web-on-behalf",
	ipAddress: null,
} as const satisfies CloseActiveWorkWriter;

/** Stored verbatim in the receipt; a retry must produce exactly the same value. */
export type OnBehalfClockOutCommand = CloseActiveWorkOperationCommand & {
	version: 1;
	/**
	 * `server` identities are generated for identity-less requests. They commit
	 * the same graph but cannot prove that a later identity-less retry is the same
	 * request.
	 */
	identity: "client" | "server";
	workPeriodId: string;
};

export type OnBehalfClockOutRejection =
	| { code: "access_denied" }
	| { code: "billing_required"; billing: Parameters<typeof createBillingForbiddenResponse>[0] }
	| { code: "target_unknown" }
	| { code: "target_not_active" }
	| { code: "collision" }
	| { code: "invalid_interval" }
	| { code: "attribution_not_allowed"; field: "projectId" | "workCategoryId" }
	| { code: "append_review_required" }
	| { code: "integrity_review_required" };

export type OnBehalfClockOutOutcome =
	| {
			outcome: "executed" | "replayed";
			operationId: string;
			entry: Entry;
			/** The committed receipt result; null for a legacy (pre-adoption) closure. */
			receipt: CloseActiveWorkResult | null;
	  }
	| ({ outcome: "rejected"; operationId: string | null } & OnBehalfClockOutRejection);

export type OnBehalfClockOutSession = {
	userId: string;
	activeOrganizationId: string | null | undefined;
};

type EmployeeRow = typeof employee.$inferSelect;

type Actor = { userId: string; organizationId: string; employee: EmployeeRow };

type Target = { employee: EmployeeRow; period: typeof workPeriod.$inferSelect };

type Committed = { entry: Entry; receipt: CloseActiveWorkResult | null };

class OnBehalfClockOutRejectedError extends Error {
	constructor(readonly rejection: OnBehalfClockOutRejection) {
		super(rejection.code);
		this.name = "OnBehalfClockOutRejectedError";
	}
}

function reject(rejection: OnBehalfClockOutRejection): never {
	throw new OnBehalfClockOutRejectedError(rejection);
}

async function requireActor(session: OnBehalfClockOutSession): Promise<Actor> {
	const actor = await clockingService.requireActor(session);
	const row = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, actor.employee.id),
			eq(employee.organizationId, actor.organizationId),
		),
	});
	if (!row) throw new ClockingAccessError("employee_required");
	return { userId: actor.userId, organizationId: actor.organizationId, employee: row };
}

/**
 * The named period and its owner, only inside the active organization. Another
 * organization's period is indistinguishable from an unknown one.
 */
async function resolveTarget(actor: Actor, workPeriodId: string): Promise<Target> {
	const [row] = await db
		.select({ period: workPeriod, employee })
		.from(workPeriod)
		.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, actor.organizationId),
				eq(employee.organizationId, actor.organizationId),
				eq(employee.isActive, true),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!row) reject({ code: "target_unknown" });
	return row;
}

function intentValue(intent: AttributionIntent, current: string | null): string | null {
	const value = attributionValue(intent);
	return value === undefined ? current : value;
}

function transactionInput(actor: Actor, target: Target, command: OnBehalfClockOutCommand) {
	return {
		organizationId: actor.organizationId,
		employeeId: target.employee.id,
		userId: actor.userId,
		ownerUserId: target.employee.userId,
		submissionId: command.operationId,
	};
}

/**
 * Exact committed replay: the adopted receipt of this writer and actor, else a
 * receipt-less closure the legacy closer committed under this identity. The
 * identity is also the clock-out entry ID either path writes, so any other use
 * of it is a collision.
 */
async function replay(
	scope: Pick<WorkTransactionContext, "db" | "assertEmployee">,
	actor: Actor,
	target: Target,
	command: OnBehalfClockOutCommand,
): Promise<Committed | null> {
	const scoped = { organizationId: actor.organizationId, employeeId: target.employee.id };
	const receipt = await replayCloseActiveWork(scope, {
		...scoped,
		command,
		writer: MANAGER_ON_BEHALF_WRITER.writer,
	});
	if (receipt) {
		if (receipt.result.actors.completing.userId !== actor.userId) {
			throw new CompletedWorkCollisionError();
		}
		return { entry: receipt.entry, receipt: receipt.result };
	}
	// Deliberately unscoped: entry IDs are global keys, so a use anywhere collides.
	const [entry] = await scope.db
		.select()
		.from(timeEntry)
		.where(eq(timeEntry.id, command.operationId))
		.limit(1);
	if (!entry) return null;
	const [period] = await scope.db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, command.workPeriodId),
				eq(workPeriod.organizationId, scoped.organizationId),
				eq(workPeriod.employeeId, scoped.employeeId),
			),
		)
		.limit(1);
	const matchesIntent = (intent: AttributionIntent, value: string | null) =>
		intent.kind === "preserve" || intentValue(intent, null) === value;
	if (
		entry.organizationId !== scoped.organizationId ||
		entry.employeeId !== scoped.employeeId ||
		entry.type !== "clock_out" ||
		entry.isSuperseded ||
		entry.createdBy !== actor.userId ||
		period?.clockOutId !== entry.id ||
		period.deletedAt !== null ||
		!matchesIntent(command.project, period.projectId) ||
		!matchesIntent(command.workCategory, period.workCategoryId)
	) {
		throw new CompletedWorkCollisionError();
	}
	return { entry, receipt: null };
}

function replayTransaction(actor: Actor, target: Target, command: OnBehalfClockOutCommand) {
	return withWebClockOutTransaction(
		transactionInput(actor, target, command),
		createOrdinaryApprovalRuntime,
		(scope) => replay(scope, actor, target, command),
	);
}

function mapFailure(error: unknown): OnBehalfClockOutRejection | null {
	if (error instanceof OnBehalfClockOutRejectedError) return error.rejection;
	if (error instanceof ClockingAccessError || error instanceof ClockingOrganizationError) {
		return { code: "access_denied" };
	}
	if (error instanceof CompletedWorkCollisionError) return { code: "collision" };
	if (error instanceof CompletedWorkIntegrityError) return { code: "integrity_review_required" };
	if (error instanceof WorkIntervalError) return { code: "invalid_interval" };
	if (error instanceof CompletedWorkAttributionError) {
		return { code: "attribution_not_allowed", field: error.field };
	}
	if (error instanceof TimeEntryAppendReviewRequiredError)
		return { code: "append_review_required" };
	if (error instanceof ClockingConflictError) {
		if (error.message === "Clock-out action id collision") return { code: "collision" };
		if (error.message === "Clock-out precedes clock-in") return { code: "invalid_interval" };
		return { code: "target_not_active" };
	}
	return null;
}

/**
 * Closes a named running period on behalf of its owner. Returns the executed or
 * replayed committed outcome, or a typed rejection that wrote nothing. A thrown
 * error leaves the outcome unknown: the client resends the same identity.
 */
export async function closeWorkOnBehalf(input: {
	request: OnBehalfClockOutRequest;
	session: OnBehalfClockOutSession;
	clock?: Clock;
}): Promise<OnBehalfClockOutOutcome> {
	const { request } = input;
	const command: OnBehalfClockOutCommand = {
		version: 1,
		operationId: request.operationId ?? randomUUID(),
		identity: request.operationId ? "client" : "server",
		workPeriodId: request.workPeriodId,
		project: attributionIntent(request.projectId),
		workCategory: attributionIntent(request.workCategoryId),
	};
	try {
		const actor = await requireActor(input.session);
		const target = await resolveTarget(actor, request.workPeriodId);
		// Explicit creation authorization for this target: owners/admins for any
		// active employee, managers for direct reports. Never for oneself here.
		if (target.employee.id === actor.employee.id) reject({ code: "access_denied" });
		const authorized = await resolveManualEntryTarget({
			currentEmployee: actor.employee,
			requestedEmployeeId: target.employee.id,
		});
		if (!authorized.success) reject({ code: "access_denied" });
		const billing = await requireBillingForMutation(actor.organizationId);
		if (!isBillingMutationAllowed(billing)) reject({ code: "billing_required", billing });

		if (command.identity === "client") {
			const committed = await replayTransaction(actor, target, command);
			if (committed) return { outcome: "replayed", operationId: command.operationId, ...committed };
		}
		// The target was read before the replay check, so an identical request that
		// commits after it is found by the replay inside the fresh transaction.
		return await closeFresh(actor, target, command, input.clock ?? systemClock);
	} catch (error) {
		const rejection = mapFailure(error);
		if (!rejection) throw error;
		return {
			outcome: "rejected",
			operationId: command.identity === "client" ? command.operationId : null,
			...rejection,
		};
	}
}

async function closeFresh(
	actor: Actor,
	target: Target,
	command: OnBehalfClockOutCommand,
	clock: Clock,
): Promise<OnBehalfClockOutOutcome> {
	const { period } = target;
	if (!period.isActive || period.endTime !== null) reject({ code: "target_not_active" });
	const organizationId = actor.organizationId;
	const owner = target.employee;
	if (command.project.kind === "replace") {
		const eligibility = await validateProjectAssignment(
			command.project.id,
			owner.id,
			owner.teamId,
			organizationId,
		);
		if (!eligibility.isValid) reject({ code: "attribution_not_allowed", field: "projectId" });
	}
	if (command.workCategory.kind === "replace") {
		const eligibility = await validateWorkCategoryAssignment(
			owner.id,
			command.workCategory.id,
			organizationId,
		);
		if (!eligibility.isValid) {
			reject({ code: "attribution_not_allowed", field: "workCategoryId" });
		}
	}

	// The target's saved zone, then the organization's, then UTC.
	const zone = await resolveManualEntryTargetZone(owner);
	const eventInstant = clock.nowInstant();
	const capture = resolveFallbackTimezoneCapture({
		timestamp: dateFromInstant(eventInstant),
		timezone: zone.timezone,
		timezoneSource: "manager_target_user_setting",
	});
	const result = await withWebClockOutTransaction(
		{
			...transactionInput(actor, target, command),
			workPeriodId: period.id,
			endTime: eventInstant,
			// On-behalf closure never routes the policy clock-out approval: the
			// authorized actor's closure is approved work, as before adoption.
			requiresApproval: false,
			projectId: attributionValue(command.project),
			workCategoryId: attributionValue(command.workCategory),
		},
		createOrdinaryApprovalRuntime,
		async (coordination) => {
			const committed = await replay(coordination, actor, target, command);
			if (committed) return { kind: "replayed" as const, committed };
			if (coordination.admission !== "append") {
				return {
					kind: "legacy" as const,
					...(await closeLegacy(coordination, actor, target, command, eventInstant, capture)),
				};
			}
			const closed = await closeActiveWork(coordination, {
				organizationId,
				employeeId: owner.id,
				teamId: owner.teamId,
				actorUserId: actor.userId,
				workPeriodId: period.id,
				command,
				writer: MANAGER_ON_BEHALF_WRITER,
				eventInstant,
				capture,
			});
			return { kind: "operation" as const, closed };
		},
	);
	if (result.kind === "replayed") {
		return { outcome: "replayed", operationId: command.operationId, ...result.committed };
	}

	const committed: OnBehalfClockOutOutcome = {
		outcome: "executed",
		operationId: command.operationId,
		entry: result.closed.entry,
		receipt: result.kind === "operation" ? result.closed.result : null,
	};
	const outcome: ClockOutCommitOutcome =
		result.kind === "operation"
			? {
					entry: result.closed.entry,
					disposition: result.closed.disposition,
					durationMinutes: result.closed.result.segment.durationMinutes,
					approvalSubmission: undefined,
					workPeriodId: result.closed.result.workPeriodId,
					startTime: dateFromInstant(parseInstant(result.closed.result.segment.startAt)),
					endTime: dateFromInstant(parseInstant(result.closed.result.segment.endAt)),
					surchargeSnapshot: result.closed.surchargeSnapshot,
					balanceRefreshCommitted: true,
				}
			: {
					entry: result.closed.entry,
					disposition: result.closed.disposition,
					durationMinutes: result.closed.durationMinutes,
					approvalSubmission: undefined,
					workPeriodId: period.id,
					startTime: result.closed.activePeriod.startTime,
					endTime: dateFromInstant(eventInstant),
					surchargeSnapshot: result.surchargeSnapshot,
					balanceRefreshCommitted: false,
				};
	// The closure has committed: a follow-up failure must not report it as unsaved.
	try {
		await completeClockOutAfterCommit({
			outcome,
			employee: { id: owner.id, organizationId },
			userId: actor.userId,
			needsClockOutApproval: false,
			timezone: zone.timezone,
			projectId:
				result.kind === "operation" ? result.closed.result.attribution.projectId : result.projectId,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId, workPeriodId: period.id },
			"On-behalf clock-out post-commit error",
		);
	}
	return committed;
}

/**
 * The prefactor closure for organizations that have not adopted, run inside the
 * same coordinator. It writes no canonical record or receipt; omitted
 * attribution is preserved from the locked period rather than cleared.
 */
async function closeLegacy(
	coordination: WorkTransactionContext,
	actor: Actor,
	target: Target,
	command: OnBehalfClockOutCommand,
	eventInstant: Instant,
	capture: ReturnType<typeof resolveFallbackTimezoneCapture>,
) {
	const organizationId = actor.organizationId;
	const employeeId = target.employee.id;
	const [locked] = await coordination.db
		.select({ projectId: workPeriod.projectId, workCategoryId: workPeriod.workCategoryId })
		.from(workPeriod)
		.where(and(eq(workPeriod.id, target.period.id), eq(workPeriod.organizationId, organizationId)))
		.limit(1);
	const projectId = intentValue(command.project, locked?.projectId ?? null);
	let surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null = null;
	const closed = await clockingService.clockOut({
		coordination,
		actionId: command.identity === "client" ? command.operationId : undefined,
		createdBy: actor.userId,
		employeeId,
		organizationId,
		workPeriodId: target.period.id,
		action: { instant: eventInstant, ...capture },
		source: {
			ipAddress: MANAGER_ON_BEHALF_WRITER.ipAddress,
			deviceInfo: MANAGER_ON_BEHALF_WRITER.deviceInfo,
		},
		projectId,
		workCategoryId: intentValue(command.workCategory, locked?.workCategoryId ?? null),
		beforePeriodClose: async ({ activePeriod }) => {
			surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
				dbService: { db: coordination.db },
				organizationId,
				employeeId,
				startTime: instantFromDate(activePeriod.startTime),
				endTime: eventInstant,
			});
			return undefined;
		},
	});
	if (!surchargeSnapshot) throw new Error("Clock-out surcharge snapshot was not captured");
	return {
		closed,
		projectId,
		surchargeSnapshot: surchargeSnapshot as PolicyClockOutSurchargeSnapshot,
	};
}
