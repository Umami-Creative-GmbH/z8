"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { complianceException, employee, userSettings } from "@/db/schema";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { asAppSubject } from "@/lib/authorization";
import { organizationAbility } from "@/lib/authorization/organization-ability";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import {
	ComplianceGuardrailService,
	ComplianceGuardrailServiceLive,
} from "@/lib/effect/services/compliance-guardrail.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	onComplianceExceptionApproved,
	onComplianceExceptionRejected,
	onComplianceExceptionRequested,
} from "@/lib/notifications/compliance-triggers";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";

const logger = createLogger("ComplianceActions");

type EmployeeWithUser = typeof employee.$inferSelect & {
	user: {
		firstName?: string | null;
		lastName?: string | null;
		name: string;
		email?: string | null;
	};
};

type ComplianceExceptionWithEmployee = typeof complianceException.$inferSelect & {
	employee: EmployeeWithUser;
};

const employeeProfileNotFound = () =>
	new NotFoundError({ message: "Employee profile not found", entityType: "employee" });

// =============================================================================
// Helper: the actor's employee record
// =============================================================================

/**
 * The actor's employee record with its user and timezone. The module already put
 * the actor on the active organization's current roster; an org admin without an
 * employee record has no compliance data of their own.
 */
function actorEmployee(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		if (!actor.employee) return yield* Effect.fail(employeeProfileNotFound());
		const employeeId = actor.employee.id;
		const dbService = yield* DatabaseService;
		const [record, settings] = yield* dbService.query("compliance.actorEmployee", () =>
			Promise.all([
				dbService.db.query.employee.findFirst({
					where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
					with: { user: true },
				}),
				dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, actor.userId),
					columns: { timezone: true },
				}),
			]),
		);
		if (!record) return yield* Effect.fail(employeeProfileNotFound());
		return {
			employee: record as EmployeeWithUser,
			timezone: settings?.timezone || "UTC",
		};
	});
}

function authorizeComplianceExceptionDecision(
	actor: OrganizationActor,
	organizationId: string,
	input: { exceptionId: string; action: "approve" | "reject" },
) {
	return Effect.gen(function* () {
		const refuse = (message: string) =>
			Effect.fail(
				new AuthorizationError({
					message,
					userId: actor.userId,
					action: input.action,
					resource: "ComplianceException",
				}),
			);
		if (!actor.employee) return yield* refuse("Active organization employee required");
		const approverId = actor.employee.id;

		const dbService = yield* DatabaseService;
		const [approverRecord, exceptionRecord] = yield* dbService.query(
			"compliance.decisionRecords",
			() =>
				Promise.all([
					dbService.db.query.employee.findFirst({
						where: and(eq(employee.id, approverId), eq(employee.organizationId, organizationId)),
						with: { user: true },
					}),
					dbService.db.query.complianceException.findFirst({
						where: and(
							eq(complianceException.id, input.exceptionId),
							eq(complianceException.organizationId, organizationId),
							eq(complianceException.status, "pending"),
						),
						with: { employee: { with: { user: true } } },
					}),
				]),
		);

		const approver = approverRecord as EmployeeWithUser | undefined;
		const exception = exceptionRecord as ComplianceExceptionWithEmployee | undefined;
		if (!approver || !exception) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Exception not found or already processed",
					entityType: "complianceException",
					entityId: input.exceptionId,
				}),
			);
		}

		if (exception.employeeId === approver.id) {
			return yield* refuse("You cannot process your own compliance exception");
		}

		const ability = yield* organizationAbility({ userId: actor.userId, organizationId });
		if (
			!ability.can(
				input.action,
				asAppSubject("Approval", {
					organizationId,
					requestedBy: exception.employeeId,
					approverId: approver.id,
					status: "pending",
				}),
			)
		) {
			return yield* refuse(`Not authorized to ${input.action} this compliance exception`);
		}

		return { approver, exception };
	});
}

// =============================================================================
// REST PERIOD CHECK
// =============================================================================

/**
 * Check if the current employee can clock in (rest period validation)
 */
export const checkRestPeriod = organizationAction(
	{ name: "compliance.checkRestPeriod", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const { employee: emp, timezone } = yield* actorEmployee(actor, organizationId);
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.checkRestPeriod({ employeeId: emp.id, timezone });
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() => logger.error({ error }, "Failed to check rest period")),
			),
			Effect.provide(ComplianceGuardrailServiceLive),
		),
);

// =============================================================================
// PROACTIVE ALERTS
// =============================================================================

const sessionMinutesSchema = z.strictObject({ currentSessionMinutes: z.number().min(0) });

/**
 * Get proactive compliance alerts for an ongoing work session
 */
export const getProactiveAlerts = organizationAction(
	{ name: "compliance.getProactiveAlerts", requires: "member", schema: sessionMinutesSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employee: emp, timezone } = yield* actorEmployee(actor, organizationId);
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.getProactiveAlerts({
				employeeId: emp.id,
				currentSessionMinutes: input.currentSessionMinutes,
				timezone,
			});
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);

// =============================================================================
// COMPLIANCE STATUS
// =============================================================================

/**
 * Get full compliance status including stats and alerts
 */
export const getComplianceStatus = organizationAction(
	{ name: "compliance.getStatus", requires: "member", schema: sessionMinutesSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employee: emp, timezone } = yield* actorEmployee(actor, organizationId);
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.getComplianceStatus({
				employeeId: emp.id,
				currentSessionMinutes: input.currentSessionMinutes,
				timezone,
			});
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);

// =============================================================================
// OVERTIME STATS
// =============================================================================

/**
 * Get overtime statistics for the current employee
 */
export const getOvertimeStats = organizationAction(
	{ name: "compliance.getOvertimeStats", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const { employee: emp, timezone } = yield* actorEmployee(actor, organizationId);
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.getOvertimeStats({ employeeId: emp.id, timezone });
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);

// =============================================================================
// EXCEPTION REQUESTS
// =============================================================================

const exceptionTypeSchema = z.enum([
	"rest_period",
	"overtime_daily",
	"overtime_weekly",
	"overtime_monthly",
]);

/**
 * Request a compliance exception (pre-approval)
 */
export const requestComplianceException = organizationAction(
	{
		name: "compliance.requestException",
		requires: "member",
		schema: z.strictObject({
			exceptionType: exceptionTypeSchema,
			reason: z.string(),
			plannedDurationMinutes: z.number().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employee: emp } = yield* actorEmployee(actor, organizationId);
			const dbService = yield* DatabaseService;
			const complianceService = yield* ComplianceGuardrailService;
			const exceptionId = yield* complianceService.requestException({
				employeeId: emp.id,
				organizationId,
				exceptionType: input.exceptionType,
				reason: input.reason,
				plannedDurationMinutes: input.plannedDurationMinutes,
				createdBy: actor.userId,
			});
			const managerId = yield* dbService.query("getComplianceExceptionPrimaryManager", () =>
				getPrimaryEligibleManagerIdForRequester({
					db: dbService.db,
					requesterEmployeeId: emp.id,
					organizationId,
				}),
			);

			// Trigger notification to manager (fire-and-forget)
			void onComplianceExceptionRequested({
				exceptionId,
				employeeId: emp.id,
				employeeName: buildAuthUserDisplayName(emp.user),
				organizationId,
				exceptionType: input.exceptionType,
				reason: input.reason,
				managerId: managerId ?? undefined,
			});

			logger.info(
				{ exceptionId, employeeId: emp.id, exceptionType: input.exceptionType },
				"Compliance exception requested",
			);
			return { exceptionId };
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() => logger.error({ error, input }, "Failed to request compliance exception")),
			),
			Effect.provide(ComplianceGuardrailServiceLive),
		),
);

/**
 * Check if the current employee has a valid exception
 */
export const hasValidException = organizationAction(
	{
		name: "compliance.hasValidException",
		requires: "member",
		schema: z.strictObject({ exceptionType: z.string() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employee: emp } = yield* actorEmployee(actor, organizationId);
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.hasValidException({
				employeeId: emp.id,
				exceptionType: input.exceptionType,
			});
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);

/**
 * Get the current employee's exceptions
 */
export const getMyExceptions = organizationAction(
	{
		name: "compliance.getMyExceptions",
		requires: "member",
		schema: z.strictObject({ includeExpired: z.boolean().default(false) }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employee: emp } = yield* actorEmployee(actor, organizationId);
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.getMyExceptions({
				employeeId: emp.id,
				includeExpired: input.includeExpired,
			});
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);

// =============================================================================
// MANAGER ACTIONS
// =============================================================================

/**
 * Get pending exception requests: every one for a compliance manager, else those of
 * the employees a manager manages.
 */
export const getPendingExceptions = organizationAction(
	{ name: "compliance.getPendingExceptions", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const { employee: emp } = yield* actorEmployee(actor, organizationId);
			const ability = yield* organizationAbility({ userId: actor.userId, organizationId });
			const canManageAll = ability.can("manage", "Compliance");
			if (!canManageAll && emp.role !== "manager") {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Not authorized to view pending compliance exceptions",
						userId: actor.userId,
						action: "read",
						resource: "ComplianceException",
					}),
				);
			}

			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.getPendingExceptions({
				organizationId,
				managerId: canManageAll ? undefined : emp.id,
			});
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);

const exceptionIdSchema = z.string().min(1, "Exception is required");

/**
 * Approve a compliance exception
 */
export const approveComplianceException = organizationAction(
	{
		name: "compliance.approveException",
		requires: "member",
		schema: z.strictObject({ exceptionId: exceptionIdSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { approver, exception } = yield* authorizeComplianceExceptionDecision(
				actor,
				organizationId,
				{ exceptionId: input.exceptionId, action: "approve" },
			);

			const complianceService = yield* ComplianceGuardrailService;
			yield* complianceService.approveException({
				exceptionId: input.exceptionId,
				approverId: approver.id,
				organizationId,
			});

			// Trigger notification (fire-and-forget)
			void onComplianceExceptionApproved({
				exceptionId: input.exceptionId,
				employeeUserId: exception.employee.userId,
				employeeName: buildAuthUserDisplayName(exception.employee.user),
				organizationId: exception.organizationId,
				exceptionType: exception.exceptionType,
				approverName: buildAuthUserDisplayName(approver.user),
				validUntil: exception.validUntil,
			});

			logger.info(
				{ exceptionId: input.exceptionId, approverId: approver.id },
				"Compliance exception approved",
			);
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() =>
					logger.error(
						{ error, exceptionId: input.exceptionId },
						"Failed to approve compliance exception",
					),
				),
			),
			Effect.provide(ComplianceGuardrailServiceLive),
		),
);

/**
 * Reject a compliance exception
 */
export const rejectComplianceException = organizationAction(
	{
		name: "compliance.rejectException",
		requires: "member",
		schema: z.strictObject({ exceptionId: exceptionIdSchema, reason: z.string().optional() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { approver, exception } = yield* authorizeComplianceExceptionDecision(
				actor,
				organizationId,
				{ exceptionId: input.exceptionId, action: "reject" },
			);

			const complianceService = yield* ComplianceGuardrailService;
			yield* complianceService.rejectException({
				exceptionId: input.exceptionId,
				approverId: approver.id,
				organizationId,
				reason: input.reason,
			});

			// Trigger notification (fire-and-forget)
			void onComplianceExceptionRejected({
				exceptionId: input.exceptionId,
				employeeUserId: exception.employee.userId,
				employeeName: buildAuthUserDisplayName(exception.employee.user),
				organizationId: exception.organizationId,
				exceptionType: exception.exceptionType,
				approverName: buildAuthUserDisplayName(approver.user),
				reason: input.reason,
			});

			logger.info(
				{ exceptionId: input.exceptionId, approverId: approver.id, reason: input.reason },
				"Compliance exception rejected",
			);
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() =>
					logger.error(
						{ error, exceptionId: input.exceptionId, reason: input.reason },
						"Failed to reject compliance exception",
					),
				),
			),
			Effect.provide(ComplianceGuardrailServiceLive),
		),
);

// =============================================================================
// ADMIN ACTIONS
// =============================================================================

/**
 * Expire old pre-approval exceptions (for cron jobs or admin use)
 */
export const expireOldExceptions = organizationAction(
	{ name: "compliance.expireOldExceptions", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const complianceService = yield* ComplianceGuardrailService;
			return yield* complianceService.expireOldExceptions(organizationId);
		}).pipe(Effect.provide(ComplianceGuardrailServiceLive)),
);
