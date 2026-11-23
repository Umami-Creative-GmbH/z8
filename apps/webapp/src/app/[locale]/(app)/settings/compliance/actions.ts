"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { employee, userSettings } from "@/db/schema";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { NotFoundError } from "@/lib/effect/errors";
import {
	ComplianceGuardrailService,
	ComplianceGuardrailServiceLive,
} from "@/lib/effect/services/compliance-guardrail.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { onComplianceExceptionRequested } from "@/lib/notifications/compliance-triggers";
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
