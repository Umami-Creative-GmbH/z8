"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import {
	db,
	payrollExportConfig,
	type payrollExportFormat,
	scheduledExport,
	scheduledExportExecution,
} from "@/db";
import type {
	ScheduledExport,
	ScheduledExportCustomOffset,
	ScheduledExportFilters,
	ScheduledExportReportConfig,
} from "@/db/schema/scheduled-export";
import { AuditAction } from "@/lib/audit-logger";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { validateScheduledReportConfig } from "@/lib/scheduled-exports/application/executors/registry";
import {
	describeScheduleOwner,
	describeScheduleOwners,
	listScheduleOwnerCandidates,
	type ScheduleOwner,
} from "@/lib/scheduled-exports/application/schedule-owner";
import { resolveRecipientEmails } from "@/lib/scheduled-exports/domain/recipient-emails";
import {
	type AuditedSchedule,
	scheduleUpdateAudit,
} from "@/lib/scheduled-exports/domain/schedule-audit";
import {
	calculateNextExecution,
	getNextExecutions,
	validateCronExpression,
} from "@/lib/scheduled-exports/domain/schedule-evaluator";
import type {
	DateRangeStrategy,
	DeliveryMethod,
	ReportType,
	ScheduleConfig,
	ScheduleType,
} from "@/lib/scheduled-exports/domain/types";

// ============================================
// TYPES
// ============================================

export interface CreateScheduledExportInput {
	organizationId: string;
	name: string;
	description?: string;
	scheduleType: ScheduleType;
	cronExpression?: string;
	timezone?: string;
	reportType: ReportType;
	reportConfig: ScheduledExportReportConfig;
	payrollConfigId?: string;
	filters?: ScheduledExportFilters;
	dateRangeStrategy: DateRangeStrategy;
	customOffset?: ScheduledExportCustomOffset;
	deliveryMethod: DeliveryMethod;
	emailRecipients: string[];
	emailSubjectTemplate?: string;
	useOrgS3Config?: boolean;
	customS3Prefix?: string;
}

export interface UpdateScheduledExportInput {
	id: string;
	organizationId: string;
	name?: string;
	description?: string;
	scheduleType?: ScheduleType;
	cronExpression?: string;
	timezone?: string;
	reportConfig?: ScheduledExportReportConfig;
	filters?: ScheduledExportFilters;
	dateRangeStrategy?: DateRangeStrategy;
	customOffset?: ScheduledExportCustomOffset;
	deliveryMethod?: DeliveryMethod;
	emailRecipients?: string[];
	emailSubjectTemplate?: string;
	isActive?: boolean;
}

export interface ScheduledExportSummary {
	id: string;
	name: string;
	description: string | null;
	scheduleType: ScheduleType;
	cronExpression: string | null;
	timezone: string;
	reportType: ReportType;
	deliveryMethod: DeliveryMethod;
	dateRangeStrategy: DateRangeStrategy;
	isActive: boolean;
	lastExecutionAt: Date | null;
	nextExecutionAt: Date | null;
	createdAt: Date;
	/** The schedule owner: the org admin the schedule acts on behalf of. */
	ownerId: string;
	ownerName: string | null;
	/** False once the owner is no longer an org admin: the schedule can't resume or run until reassigned. */
	ownerEligible: boolean;
}

export interface ScheduleOwnerCandidate {
	userId: string;
	name: string | null;
	email: string | null;
}

type PayrollExportConfigWithFormat = typeof payrollExportConfig.$inferSelect & {
	format: Pick<typeof payrollExportFormat.$inferSelect, "id" | "name"> | null;
};

export interface ExecutionHistoryItem {
	id: string;
	status: string;
	triggeredAt: Date;
	dateRangeStart: string;
	dateRangeEnd: string;
	recordCount: number | null;
	emailsSent: number | null;
	emailsFailed: number | null;
	errorMessage: string | null;
	durationMs: number | null;
	completedAt: Date | null;
}

// Using isOrgAdminCasl from auth-helpers for CASL-based authorization

/** Refuses a report configuration its executor rejects, e.g. an unconfigured payroll format. */
function validateReportConfig(
	organizationId: string,
	reportType: string,
	reportConfig: ScheduledExportReportConfig,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const errors = yield* dbService.query("scheduledExport.validateReportConfig", () =>
			validateScheduledReportConfig(organizationId, reportType, reportConfig),
		);
		if (errors.length > 0) {
			yield* Effect.fail(
				new ValidationError({ message: errors.join("; "), field: "reportConfig" }),
			);
		}
	});
}

/** The normalised recipient emails for the schedule as it will be stored, or a validation failure. */
function recipientEmailsFor(deliveryMethod: DeliveryMethod, emailRecipients: readonly string[]) {
	const result = resolveRecipientEmails(deliveryMethod, emailRecipients);
	return result.ok
		? Effect.succeed(result.recipients)
		: Effect.fail(new ValidationError({ message: result.message, field: "emailRecipients" }));
}

/** An unknown id and another organization's id fail the same way. */
function scheduledExportNotFound(scheduleId: string) {
	return Effect.fail(
		new NotFoundError({
			message: "Scheduled export not found",
			entityType: "scheduled_export",
			entityId: scheduleId,
		}),
	);
}

/** Every scheduled-export action needs an org admin. */
function requireOrgAdmin(organizationId: string, resource: string, action: string) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const hasPermission = yield* Effect.promise(() => isOrgAdminCasl(organizationId));
		if (!hasPermission) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions - admin role required",
					userId: session.user.id,
					resource,
					action,
				}),
			);
		}
		return session;
	});
}

type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

/** A write that commits together with its audit entries; they reach the external service after the commit. */
function auditedWrite<T>(name: string, run: (tx: Transaction, audit: AuditTrail) => Promise<T>) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query(name, () =>
			withAuditTrail((audit) => dbService.db.transaction((tx) => run(tx, audit))),
		);
	});
}

function findSchedule(organizationId: string, scheduleId: string, name: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const schedule = yield* dbService.query(name, () =>
			dbService.db.query.scheduledExport.findFirst({
				where: and(
					eq(scheduledExport.id, scheduleId),
					eq(scheduledExport.organizationId, organizationId),
				),
			}),
		);
		return schedule ?? (yield* scheduledExportNotFound(scheduleId));
	});
}

function ownerOf(organizationId: string, userId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("scheduledExport.describeOwner", () =>
			describeScheduleOwner(dbService.db, { organizationId, userId }),
		);
	});
}

/** Resuming or running a schedule acts on behalf of its owner, who must still be an org admin. */
function requireEligibleOwner(owner: ScheduleOwner, field: string) {
	return owner.eligible
		? Effect.void
		: Effect.fail(
				new ValidationError({
					message: `The schedule owner, ${owner.name ?? owner.email ?? owner.userId}, is no longer an org admin. Make yourself or another org admin its owner first.`,
					field,
				}),
			);
}

function toSummary(schedule: ScheduledExport, owner: ScheduleOwner): ScheduledExportSummary {
	return {
		id: schedule.id,
		name: schedule.name,
		description: schedule.description,
		scheduleType: schedule.scheduleType as ScheduleType,
		cronExpression: schedule.cronExpression,
		timezone: schedule.timezone,
		reportType: schedule.reportType as ReportType,
		deliveryMethod: schedule.deliveryMethod as DeliveryMethod,
		dateRangeStrategy: schedule.dateRangeStrategy as DateRangeStrategy,
		isActive: schedule.isActive,
		lastExecutionAt: schedule.lastExecutionAt,
		nextExecutionAt: schedule.nextExecutionAt,
		createdAt: schedule.createdAt,
		ownerId: schedule.ownerId,
		ownerName: owner.name,
		ownerEligible: owner.eligible,
	};
}

function auditedSettings(schedule: ScheduledExport): AuditedSchedule {
	return {
		name: schedule.name,
		description: schedule.description ?? null,
		scheduleType: schedule.scheduleType,
		cronExpression: schedule.cronExpression ?? null,
		timezone: schedule.timezone,
		reportType: schedule.reportType,
		reportConfig: schedule.reportConfig,
		payrollConfigId: schedule.payrollConfigId ?? null,
		filters: schedule.filters ?? null,
		dateRangeStrategy: schedule.dateRangeStrategy,
		customOffset: schedule.customOffset ?? null,
		deliveryMethod: schedule.deliveryMethod,
		emailRecipients: [...(schedule.emailRecipients ?? [])],
		emailSubjectTemplate: schedule.emailSubjectTemplate ?? null,
		isActive: schedule.isActive,
	};
}

/** What a schedule was, for the entries that outlive it or describe it whole. */
function scheduleSnapshot(schedule: ScheduledExport) {
	const { isActive: _isActive, ...settings } = auditedSettings(schedule);
	return { ...settings, ownerId: schedule.ownerId };
}

// ============================================
// CREATE
// ============================================

export async function createScheduledExportAction(
	input: CreateScheduledExportInput,
): Promise<ServerActionResult<ScheduledExportSummary>> {
	const effect = Effect.gen(function* () {
		const session = yield* requireOrgAdmin(input.organizationId, "scheduled_export", "create");

		// Validate cron expression if provided
		if (input.scheduleType === "cron" && input.cronExpression) {
			try {
				validateCronExpression(input.cronExpression);
			} catch (error) {
				throw new Error(
					`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		const emailRecipients = yield* recipientEmailsFor(
			input.deliveryMethod,
			input.emailRecipients ?? [],
		);

		yield* validateReportConfig(input.organizationId, input.reportType, input.reportConfig);

		// Calculate next execution time
		const scheduleConfig: ScheduleConfig = {
			type: input.scheduleType,
			cronExpression: input.cronExpression,
			timezone: input.timezone || "UTC",
		};
		const nextExecutionAt = calculateNextExecution(scheduleConfig, DateTime.utc());

		// Create schedule; the creating admin becomes its owner.
		const schedule = yield* auditedWrite("scheduledExport.create", async (tx, audit) => {
			const [created] = await tx
				.insert(scheduledExport)
				.values({
					organizationId: input.organizationId,
					name: input.name,
					description: input.description,
					scheduleType: input.scheduleType,
					cronExpression: input.cronExpression,
					timezone: input.timezone || "UTC",
					reportType: input.reportType,
					reportConfig: input.reportConfig,
					payrollConfigId: input.payrollConfigId,
					filters: input.filters,
					dateRangeStrategy: input.dateRangeStrategy,
					customOffset: input.customOffset,
					deliveryMethod: input.deliveryMethod,
					emailRecipients,
					emailSubjectTemplate: input.emailSubjectTemplate,
					useOrgS3Config: input.useOrgS3Config ?? true,
					customS3Prefix: input.customS3Prefix,
					nextExecutionAt: nextExecutionAt.toJSDate(),
					ownerId: session.user.id,
					createdBy: session.user.id,
				})
				.returning();

			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.SCHEDULED_EXPORT_CREATED,
				actorUserId: session.user.id,
				targetType: "scheduled_export",
				targetId: created.id,
				metadata: scheduleSnapshot(created),
			});
			return created;
		});

		revalidatePath("/settings/scheduled-exports");

		return toSummary(schedule, {
			userId: session.user.id,
			name: session.user.name ?? null,
			email: session.user.email ?? null,
			eligible: true,
		});
	});

	return runServerActionSafe(effect);
}

// ============================================
// READ
// ============================================

export async function getScheduledExportsAction(
	organizationId: string,
): Promise<ServerActionResult<ScheduledExportSummary[]>> {
	const effect = Effect.gen(function* () {
		yield* requireOrgAdmin(organizationId, "scheduled_export", "read");

		const dbService = yield* DatabaseService;
		const schedules = yield* dbService.query("scheduledExport.list", () =>
			dbService.db.query.scheduledExport.findMany({
				where: eq(scheduledExport.organizationId, organizationId),
				orderBy: [desc(scheduledExport.createdAt)],
			}),
		);
		const owners = yield* dbService.query("scheduledExport.describeOwners", () =>
			describeScheduleOwners(dbService.db, {
				organizationId,
				userIds: schedules.map((schedule) => schedule.ownerId),
			}),
		);

		return schedules.map((schedule) =>
			toSummary(schedule, owners.get(schedule.ownerId) as ScheduleOwner),
		);
	});

	return runServerActionSafe(effect);
}

/** The org admins a schedule can be handed to. */
export async function getScheduleOwnerCandidatesAction(
	organizationId: string,
): Promise<ServerActionResult<ScheduleOwnerCandidate[]>> {
	const effect = Effect.gen(function* () {
		yield* requireOrgAdmin(organizationId, "scheduled_export", "read");

		const dbService = yield* DatabaseService;
		const candidates = yield* dbService.query("scheduledExport.ownerCandidates", () =>
			listScheduleOwnerCandidates(dbService.db, { organizationId }),
		);
		return candidates.map(({ userId, name, email }) => ({ userId, name, email }));
	});

	return runServerActionSafe(effect);
}

export async function getScheduledExportAction(
	organizationId: string,
	scheduleId: string,
): Promise<ServerActionResult<ScheduledExport | null>> {
	const effect = Effect.gen(function* () {
		yield* requireOrgAdmin(organizationId, "scheduled_export", "read");

		const dbService = yield* DatabaseService;
		const schedule = yield* dbService.query("scheduledExport.get", () =>
			dbService.db.query.scheduledExport.findFirst({
				where: and(
					eq(scheduledExport.id, scheduleId),
					eq(scheduledExport.organizationId, organizationId),
				),
			}),
		);

		return schedule || null;
	});

	return runServerActionSafe(effect);
}

// ============================================
// UPDATE
// ============================================

export async function updateScheduledExportAction(
	input: UpdateScheduledExportInput,
): Promise<ServerActionResult<ScheduledExportSummary>> {
	const effect = Effect.gen(function* () {
		const session = yield* requireOrgAdmin(input.organizationId, "scheduled_export", "update");

		// Validate cron expression if provided
		if (input.scheduleType === "cron" && input.cronExpression) {
			try {
				validateCronExpression(input.cronExpression);
			} catch (error) {
				throw new Error(
					`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		const existing = yield* findSchedule(
			input.organizationId,
			input.id,
			"scheduledExport.getForUpdate",
		);
		// Taken now: the diff compares the stored schedule with the updated one.
		const before = auditedSettings(existing);

		const owner = yield* ownerOf(input.organizationId, existing.ownerId);
		if (input.isActive === true && !existing.isActive) {
			yield* requireEligibleOwner(owner, "isActive");
		}

		if (input.reportConfig !== undefined) {
			yield* validateReportConfig(input.organizationId, existing.reportType, input.reportConfig);
		}

		// Build update object
		const updates: Partial<ScheduledExport> = {
			updatedBy: session.user.id,
		};

		// Validate the recipients the schedule will have after this update
		if (input.deliveryMethod !== undefined || input.emailRecipients !== undefined) {
			const emailRecipients = yield* recipientEmailsFor(
				input.deliveryMethod ?? (existing.deliveryMethod as DeliveryMethod),
				input.emailRecipients ?? existing.emailRecipients,
			);
			if (input.emailRecipients !== undefined) updates.emailRecipients = emailRecipients;
		}

		if (input.name !== undefined) updates.name = input.name;
		if (input.description !== undefined) updates.description = input.description;
		if (input.scheduleType !== undefined) updates.scheduleType = input.scheduleType;
		if (input.cronExpression !== undefined) updates.cronExpression = input.cronExpression;
		if (input.timezone !== undefined) updates.timezone = input.timezone;
		if (input.reportConfig !== undefined) updates.reportConfig = input.reportConfig;
		if (input.filters !== undefined) updates.filters = input.filters;
		if (input.dateRangeStrategy !== undefined) updates.dateRangeStrategy = input.dateRangeStrategy;
		if (input.customOffset !== undefined) updates.customOffset = input.customOffset;
		if (input.deliveryMethod !== undefined) updates.deliveryMethod = input.deliveryMethod;
		if (input.emailSubjectTemplate !== undefined)
			updates.emailSubjectTemplate = input.emailSubjectTemplate;
		if (input.isActive !== undefined) updates.isActive = input.isActive;

		// Recalculate next execution if schedule changed
		if (
			input.scheduleType !== undefined ||
			input.cronExpression !== undefined ||
			input.timezone !== undefined
		) {
			const scheduleConfig: ScheduleConfig = {
				type: input.scheduleType || (existing.scheduleType as ScheduleType),
				cronExpression: input.cronExpression ?? existing.cronExpression ?? undefined,
				timezone: input.timezone || existing.timezone,
			};
			const nextExecutionAt = calculateNextExecution(scheduleConfig, DateTime.utc());
			updates.nextExecutionAt = nextExecutionAt.toJSDate();
		}

		const schedule = yield* auditedWrite("scheduledExport.update", async (tx, audit) => {
			const [updated] = await tx
				.update(scheduledExport)
				.set(updates)
				.where(
					and(
						eq(scheduledExport.id, input.id),
						eq(scheduledExport.organizationId, input.organizationId),
					),
				)
				.returning();
			if (!updated) return null;

			for (const entry of scheduleUpdateAudit(before, auditedSettings(updated))) {
				await audit.record(tx, {
					organizationId: input.organizationId,
					action:
						entry.kind === "updated"
							? AuditAction.SCHEDULED_EXPORT_UPDATED
							: entry.kind === "paused"
								? AuditAction.SCHEDULED_EXPORT_PAUSED
								: AuditAction.SCHEDULED_EXPORT_RESUMED,
					actorUserId: session.user.id,
					targetType: "scheduled_export",
					targetId: updated.id,
					changes: entry.kind === "updated" ? entry.changes : null,
					metadata:
						entry.kind === "updated" ? null : { automatic: false, ownerId: updated.ownerId },
				});
			}
			return updated;
		});

		if (!schedule) {
			return yield* scheduledExportNotFound(input.id);
		}

		revalidatePath("/settings/scheduled-exports");

		return toSummary(schedule, owner);
	});

	return runServerActionSafe(effect);
}

// ============================================
// CHANGE OWNER
// ============================================

/**
 * Hands a schedule to another org admin. Any org admin may take a schedule
 * over; pausing state is unchanged, so a paused schedule is resumed separately.
 */
export async function changeScheduledExportOwnerAction(
	organizationId: string,
	scheduleId: string,
	newOwnerId: string,
): Promise<ServerActionResult<ScheduledExportSummary>> {
	const effect = Effect.gen(function* () {
		const session = yield* requireOrgAdmin(organizationId, "scheduled_export", "update");

		const existing = yield* findSchedule(
			organizationId,
			scheduleId,
			"scheduledExport.getForOwnerChange",
		);
		const newOwner = yield* ownerOf(organizationId, newOwnerId);
		if (!newOwner.eligible) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Only an org admin can own a scheduled export",
					field: "ownerId",
				}),
			);
		}
		const previousOwnerId = existing.ownerId;
		if (previousOwnerId === newOwnerId) return toSummary(existing, newOwner);

		const schedule = yield* auditedWrite("scheduledExport.changeOwner", async (tx, audit) => {
			const [updated] = await tx
				.update(scheduledExport)
				.set({ ownerId: newOwnerId, updatedBy: session.user.id })
				.where(
					and(
						eq(scheduledExport.id, scheduleId),
						eq(scheduledExport.organizationId, organizationId),
					),
				)
				.returning();
			if (!updated) return null;

			await audit.record(tx, {
				organizationId,
				action: AuditAction.SCHEDULED_EXPORT_OWNER_CHANGED,
				actorUserId: session.user.id,
				targetType: "scheduled_export",
				targetId: scheduleId,
				changes: { ownerId: { before: previousOwnerId, after: newOwnerId } },
				metadata: { isActive: updated.isActive },
			});
			return updated;
		});

		if (!schedule) {
			return yield* scheduledExportNotFound(scheduleId);
		}

		revalidatePath("/settings/scheduled-exports");

		return toSummary(schedule, newOwner);
	});

	return runServerActionSafe(effect);
}

// ============================================
// DELETE
// ============================================

export async function deleteScheduledExportAction(
	organizationId: string,
	scheduleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const session = yield* requireOrgAdmin(organizationId, "scheduled_export", "delete");

		const deleted = yield* auditedWrite("scheduledExport.delete", async (tx, audit) => {
			const [removed] = await tx
				.delete(scheduledExport)
				.where(
					and(
						eq(scheduledExport.id, scheduleId),
						eq(scheduledExport.organizationId, organizationId),
					),
				)
				.returning();
			if (!removed) return null;

			await audit.record(tx, {
				organizationId,
				action: AuditAction.SCHEDULED_EXPORT_DELETED,
				actorUserId: session.user.id,
				targetType: "scheduled_export",
				targetId: removed.id,
				metadata: scheduleSnapshot(removed),
			});
			return removed;
		});

		if (!deleted) {
			return yield* scheduledExportNotFound(scheduleId);
		}

		revalidatePath("/settings/scheduled-exports");
	});

	return runServerActionSafe(effect);
}

// ============================================
// TOGGLE ACTIVE
// ============================================

export async function toggleScheduledExportAction(
	organizationId: string,
	scheduleId: string,
	isActive: boolean,
): Promise<ServerActionResult<ScheduledExportSummary>> {
	return updateScheduledExportAction({
		id: scheduleId,
		organizationId,
		isActive,
	});
}

// ============================================
// EXECUTION HISTORY
// ============================================

export async function getExecutionHistoryAction(
	organizationId: string,
	scheduleId: string,
	limit = 50,
): Promise<ServerActionResult<ExecutionHistoryItem[]>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();

		const hasPermission = yield* Effect.promise(() => isOrgAdminCasl(organizationId));

		if (!hasPermission) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions - admin role required",
					userId: session.user.id,
					resource: "scheduled_export_execution",
					action: "read",
				}),
			);
		}

		const executions = yield* Effect.promise(async () => {
			return db.query.scheduledExportExecution.findMany({
				where: and(
					eq(scheduledExportExecution.scheduledExportId, scheduleId),
					eq(scheduledExportExecution.organizationId, organizationId),
				),
				orderBy: [desc(scheduledExportExecution.triggeredAt)],
				limit,
			});
		});

		return executions.map((e) => ({
			id: e.id,
			status: e.status,
			triggeredAt: e.triggeredAt,
			dateRangeStart: e.dateRangeStart,
			dateRangeEnd: e.dateRangeEnd,
			recordCount: e.recordCount,
			emailsSent: e.emailsSent,
			emailsFailed: e.emailsFailed,
			errorMessage: e.errorMessage,
			durationMs: e.durationMs,
			completedAt: e.completedAt,
		}));
	});

	return runServerActionSafe(effect);
}

// ============================================
// PREVIEW NEXT EXECUTIONS
// ============================================

export async function previewNextExecutionsAction(
	scheduleType: ScheduleType,
	cronExpression: string | undefined,
	timezone: string,
	count = 5,
): Promise<ServerActionResult<string[]>> {
	const effect = Effect.gen(function* () {
		// Validate cron expression if provided
		if (scheduleType === "cron" && cronExpression) {
			try {
				validateCronExpression(cronExpression);
			} catch (error) {
				throw new Error(
					`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		const config: ScheduleConfig = {
			type: scheduleType,
			cronExpression,
			timezone,
		};

		const executions = getNextExecutions(config, count, DateTime.utc());
		return executions.map((dt) => dt.toISO()!);
	});

	return runServerActionSafe(effect);
}

// ============================================
// RUN NOW
// ============================================

export async function runScheduledExportNowAction(
	organizationId: string,
	scheduleId: string,
): Promise<ServerActionResult<{ executionId: string }>> {
	const effect = Effect.gen(function* () {
		const session = yield* requireOrgAdmin(organizationId, "scheduled_export", "execute");

		const schedule = yield* findSchedule(organizationId, scheduleId, "scheduledExport.getForRun");
		// The run acts on behalf of the owner, who must still be an org admin.
		yield* requireEligibleOwner(yield* ownerOf(organizationId, schedule.ownerId), "ownerId");

		yield* auditedWrite("scheduledExport.auditRunRequest", (tx, audit) =>
			audit.record(tx, {
				organizationId,
				action: AuditAction.SCHEDULED_EXPORT_RUN_REQUESTED,
				actorUserId: session.user.id,
				targetType: "scheduled_export",
				targetId: schedule.id,
				metadata: { ownerId: schedule.ownerId },
			}),
		);

		// Import and run the orchestrator
		const { ScheduledExportOrchestrator } = yield* Effect.promise(
			() => import("@/lib/scheduled-exports/application/orchestrator"),
		);

		const orchestrator = new ScheduledExportOrchestrator();
		yield* Effect.promise(() =>
			orchestrator.executeSchedule(schedule, DateTime.utc(), {
				trigger: "run_now",
				requestedBy: session.user.id,
			}),
		);

		// Return a placeholder execution ID (the orchestrator creates one internally)
		return { executionId: "started" };
	});

	return runServerActionSafe(effect);
}

// ============================================
// FILTER OPTIONS
// ============================================

export interface FilterOptions {
	employees: Array<{
		id: string;
		firstName: string;
		lastName: string;
		employeeNumber?: string;
	}>;
	teams: Array<{ id: string; name: string }>;
	projects: Array<{ id: string; name: string }>;
}

export async function getFilterOptionsAction(
	organizationId: string,
): Promise<ServerActionResult<FilterOptions>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();

		const hasPermission = yield* Effect.promise(() => isOrgAdminCasl(organizationId));

		if (!hasPermission) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions - admin role required",
					userId: session.user.id,
					resource: "scheduled_export",
					action: "read",
				}),
			);
		}

		// Import employee, team, project tables
		const { employee, team, project, user } = yield* Effect.promise(() => import("@/db"));

		// Fetch employees
		const employees = yield* Effect.promise(async () => {
			return db
				.select({
					id: employee.id,
					firstName: user.firstName,
					lastName: user.lastName,
					employeeNumber: employee.employeeNumber,
				})
				.from(employee)
				.innerJoin(user, eq(employee.userId, user.id))
				.where(eq(employee.organizationId, organizationId))
				.orderBy(asc(user.lastName), asc(user.firstName));
		});

		// Fetch teams
		const teams = yield* Effect.promise(async () => {
			return db.query.team.findMany({
				where: eq(team.organizationId, organizationId),
				columns: {
					id: true,
					name: true,
				},
				orderBy: (t, { asc }) => [asc(t.name)],
			});
		});

		// Fetch projects
		const projects = yield* Effect.promise(async () => {
			return db.query.project.findMany({
				where: eq(project.organizationId, organizationId),
				columns: {
					id: true,
					name: true,
				},
				orderBy: (p, { asc }) => [asc(p.name)],
			});
		});

		return {
			employees: employees.map((employeeRow) => ({
				id: employeeRow.id,
				firstName: employeeRow.firstName ?? "",
				lastName: employeeRow.lastName ?? "",
				employeeNumber: employeeRow.employeeNumber ?? undefined,
			})),
			teams: teams.map((t) => ({
				id: t.id,
				name: t.name,
			})),
			projects: projects.map((p) => ({
				id: p.id,
				name: p.name,
			})),
		};
	});

	return runServerActionSafe(effect);
}

// ============================================
// PAYROLL CONFIGS
// ============================================

export interface PayrollConfigSummary {
	id: string;
	formatId: string;
	formatName: string;
}

export async function getPayrollConfigsAction(
	organizationId: string,
): Promise<ServerActionResult<PayrollConfigSummary[]>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();

		const hasPermission = yield* Effect.promise(() => isOrgAdminCasl(organizationId));

		if (!hasPermission) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions - admin role required",
					userId: session.user.id,
					resource: "scheduled_export",
					action: "read",
				}),
			);
		}

		const configs = yield* Effect.promise(async () => {
			return db.query.payrollExportConfig.findMany({
				where: and(
					eq(payrollExportConfig.organizationId, organizationId),
					eq(payrollExportConfig.isActive, true),
				),
				with: {
					format: true,
				},
			});
		});

		const typedConfigs = configs as unknown as PayrollExportConfigWithFormat[];

		return typedConfigs.map((c) => ({
			id: c.id,
			formatId: c.format?.id ?? c.formatId,
			formatName: c.format?.name ?? c.formatId,
		}));
	});

	return runServerActionSafe(effect);
}
