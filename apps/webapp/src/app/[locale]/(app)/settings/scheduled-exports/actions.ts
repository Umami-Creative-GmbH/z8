"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	employee,
	payrollExportConfig,
	type payrollExportFormat,
	project,
	scheduledExport,
	scheduledExportExecution,
	team,
	user,
} from "@/db";
import type {
	ScheduledExport,
	ScheduledExportCustomOffset,
	ScheduledExportFilters,
	ScheduledExportReportConfig,
} from "@/db/schema/scheduled-export";
import { AuditAction } from "@/lib/audit-logger";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
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
// INPUT SCHEMAS
// ============================================

const scheduleTypeSchema = z.enum(["daily", "weekly", "monthly", "quarterly", "cron"]);
const reportTypeSchema = z.enum(["payroll_export", "data_export", "audit_report"]);
const dateRangeStrategySchema = z.enum([
	"previous_day",
	"previous_week",
	"previous_month",
	"previous_quarter",
	"custom_offset",
]);
const deliveryMethodSchema = z.enum(["s3_only", "email_only", "s3_and_email"]);

const reportConfigSchema = z.object({
	formatId: z.string().optional(),
	categories: z.array(z.string()).optional(),
	auditEventTypes: z.array(z.string()).optional(),
	includeMetadata: z.boolean().optional(),
}) satisfies z.ZodType<ScheduledExportReportConfig>;

const filtersSchema = z.object({
	employeeIds: z.array(z.string()).optional(),
	teamIds: z.array(z.string()).optional(),
	projectIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<ScheduledExportFilters>;

const offsetSchema = z.object({
	days: z.number().int().optional(),
	months: z.number().int().optional(),
});
const customOffsetSchema = z.object({
	startOffset: offsetSchema.optional(),
	endOffset: offsetSchema.optional(),
}) satisfies z.ZodType<ScheduledExportCustomOffset>;

const scheduleIdSchema = z.string().min(1, "Scheduled export is required");

/**
 * The edit dialog sends the form's values, which include fields a schedule
 * stores but never changes (report type, S3 options) and nulls loaded from the
 * row, so the schemas accept nulls and drop unknown keys.
 */
const createScheduledExportSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().nullish(),
	scheduleType: scheduleTypeSchema,
	cronExpression: z.string().nullish(),
	timezone: z.string().nullish(),
	reportType: reportTypeSchema,
	reportConfig: reportConfigSchema,
	payrollConfigId: z.string().nullish(),
	filters: filtersSchema.nullish(),
	dateRangeStrategy: dateRangeStrategySchema,
	customOffset: customOffsetSchema.nullish(),
	deliveryMethod: deliveryMethodSchema,
	emailRecipients: z.array(z.string()).default([]),
	emailSubjectTemplate: z.string().nullish(),
	useOrgS3Config: z.boolean().nullish(),
	customS3Prefix: z.string().nullish(),
});

const updateScheduledExportSchema = z.object({
	id: scheduleIdSchema,
	name: z.string().min(1, "Name is required").optional(),
	description: z.string().nullish(),
	scheduleType: scheduleTypeSchema.optional(),
	cronExpression: z.string().nullish(),
	timezone: z.string().optional(),
	reportConfig: reportConfigSchema.optional(),
	filters: filtersSchema.nullish(),
	dateRangeStrategy: dateRangeStrategySchema.optional(),
	customOffset: customOffsetSchema.nullish(),
	deliveryMethod: deliveryMethodSchema.optional(),
	emailRecipients: z.array(z.string()).optional(),
	emailSubjectTemplate: z.string().nullish(),
	isActive: z.boolean().optional(),
});

// ============================================
// TYPES
// ============================================

export type CreateScheduledExportInput = z.input<typeof createScheduledExportSchema>;
export type UpdateScheduledExportInput = z.input<typeof updateScheduledExportSchema>;
type UpdateScheduledExport = z.output<typeof updateScheduledExportSchema>;

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

/** Refuses a cron expression the evaluator cannot parse. */
function validateCron(
	scheduleType: ScheduleType | undefined,
	cronExpression: string | null | undefined,
) {
	if (scheduleType !== "cron" || !cronExpression) return Effect.void;
	try {
		validateCronExpression(cronExpression);
		return Effect.void;
	} catch (error) {
		return Effect.fail(
			new ValidationError({
				message: `Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`,
				field: "cronExpression",
			}),
		);
	}
}

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
function validateEligibleOwner(owner: ScheduleOwner, field: string) {
	return owner.eligible
		? Effect.void
		: Effect.fail(
				new ValidationError({
					message: `The schedule owner, ${owner.name ?? owner.email ?? owner.userId}, is no longer an org admin. Make yourself or another org admin its owner first.`,
					field,
					refusal: "owner_not_org_admin",
					value: { owner: owner.name ?? owner.email ?? owner.userId },
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

export const createScheduledExportAction = organizationAction(
	{ name: "scheduledExport.create", requires: "orgAdmin", schema: createScheduledExportSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* validateCron(input.scheduleType, input.cronExpression);

			const emailRecipients = yield* recipientEmailsFor(
				input.deliveryMethod,
				input.emailRecipients,
			);

			yield* validateReportConfig(organizationId, input.reportType, input.reportConfig);

			// Calculate next execution time
			const timezone = input.timezone || "UTC";
			const scheduleConfig: ScheduleConfig = {
				type: input.scheduleType,
				cronExpression: input.cronExpression ?? undefined,
				timezone,
			};
			const nextExecutionAt = calculateNextExecution(scheduleConfig, DateTime.utc());

			// Create schedule; the creating admin becomes its owner.
			const schedule = yield* auditedWrite("scheduledExport.create", async (tx, audit) => {
				const [created] = await tx
					.insert(scheduledExport)
					.values({
						organizationId,
						name: input.name,
						description: input.description,
						scheduleType: input.scheduleType,
						cronExpression: input.cronExpression,
						timezone,
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
						ownerId: actor.userId,
						createdBy: actor.userId,
					})
					.returning();

				await audit.record(tx, {
					organizationId,
					action: AuditAction.SCHEDULED_EXPORT_CREATED,
					actorUserId: actor.userId,
					targetType: "scheduled_export",
					targetId: created.id,
					metadata: scheduleSnapshot(created),
				});
				return created;
			});

			revalidatePath("/settings/scheduled-exports");

			const authService = yield* AuthService;
			const session = yield* authService.getSession();
			return toSummary(schedule, {
				userId: actor.userId,
				name: session.user.name ?? null,
				email: session.user.email ?? null,
				eligible: true,
			});
		}),
);

// ============================================
// READ
// ============================================

export const getScheduledExportsAction = organizationAction(
	{ name: "scheduledExport.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
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
		}),
);

/** The org admins a schedule can be handed to. */
export const getScheduleOwnerCandidatesAction = organizationAction(
	{ name: "scheduledExport.ownerCandidates", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const candidates = yield* dbService.query("scheduledExport.ownerCandidates", () =>
				listScheduleOwnerCandidates(dbService.db, { organizationId }),
			);
			return candidates.map(
				({ userId, name, email }): ScheduleOwnerCandidate => ({ userId, name, email }),
			);
		}),
);

export const getScheduledExportAction = organizationAction(
	{
		name: "scheduledExport.get",
		requires: "orgAdmin",
		schema: z.strictObject({ scheduleId: scheduleIdSchema }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const schedule = yield* dbService.query("scheduledExport.get", () =>
				dbService.db.query.scheduledExport.findFirst({
					where: and(
						eq(scheduledExport.id, input.scheduleId),
						eq(scheduledExport.organizationId, organizationId),
					),
				}),
			);

			return schedule || null;
		}),
);

// ============================================
// UPDATE
// ============================================

function updateSchedule(
	actor: OrganizationActor,
	organizationId: string,
	input: UpdateScheduledExport,
) {
	return Effect.gen(function* () {
		yield* validateCron(input.scheduleType, input.cronExpression);

		const existing = yield* findSchedule(organizationId, input.id, "scheduledExport.getForUpdate");
		// Taken now: the diff compares the stored schedule with the updated one.
		const before = auditedSettings(existing);

		const owner = yield* ownerOf(organizationId, existing.ownerId);
		if (input.isActive === true && !existing.isActive) {
			yield* validateEligibleOwner(owner, "isActive");
		}

		if (input.reportConfig !== undefined) {
			yield* validateReportConfig(organizationId, existing.reportType, input.reportConfig);
		}

		// Build update object
		const updates: Partial<ScheduledExport> = {
			updatedBy: actor.userId,
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
					and(eq(scheduledExport.id, input.id), eq(scheduledExport.organizationId, organizationId)),
				)
				.returning();
			if (!updated) return null;

			for (const entry of scheduleUpdateAudit(before, auditedSettings(updated))) {
				await audit.record(tx, {
					organizationId,
					action:
						entry.kind === "updated"
							? AuditAction.SCHEDULED_EXPORT_UPDATED
							: entry.kind === "paused"
								? AuditAction.SCHEDULED_EXPORT_PAUSED
								: AuditAction.SCHEDULED_EXPORT_RESUMED,
					actorUserId: actor.userId,
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
}

export const updateScheduledExportAction = organizationAction(
	{ name: "scheduledExport.update", requires: "orgAdmin", schema: updateScheduledExportSchema },
	({ actor, organizationId, input }) => updateSchedule(actor, organizationId, input),
);

// ============================================
// CHANGE OWNER
// ============================================

/**
 * Hands a schedule to another org admin. Any org admin may take a schedule
 * over; pausing state is unchanged, so a paused schedule is resumed separately.
 */
export const changeScheduledExportOwnerAction = organizationAction(
	{
		name: "scheduledExport.changeOwner",
		requires: "orgAdmin",
		schema: z.strictObject({
			scheduleId: scheduleIdSchema,
			newOwnerId: z.string().min(1, "Owner is required"),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { scheduleId, newOwnerId } = input;
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
					.set({ ownerId: newOwnerId, updatedBy: actor.userId })
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
					actorUserId: actor.userId,
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
		}),
);

// ============================================
// DELETE
// ============================================

export const deleteScheduledExportAction = organizationAction(
	{
		name: "scheduledExport.delete",
		requires: "orgAdmin",
		schema: z.strictObject({ scheduleId: scheduleIdSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const deleted = yield* auditedWrite("scheduledExport.delete", async (tx, audit) => {
				const [removed] = await tx
					.delete(scheduledExport)
					.where(
						and(
							eq(scheduledExport.id, input.scheduleId),
							eq(scheduledExport.organizationId, organizationId),
						),
					)
					.returning();
				if (!removed) return null;

				await audit.record(tx, {
					organizationId,
					action: AuditAction.SCHEDULED_EXPORT_DELETED,
					actorUserId: actor.userId,
					targetType: "scheduled_export",
					targetId: removed.id,
					metadata: scheduleSnapshot(removed),
				});
				return removed;
			});

			if (!deleted) {
				return yield* scheduledExportNotFound(input.scheduleId);
			}

			revalidatePath("/settings/scheduled-exports");
		}),
);

// ============================================
// TOGGLE ACTIVE
// ============================================

export const toggleScheduledExportAction = organizationAction(
	{
		name: "scheduledExport.toggle",
		requires: "orgAdmin",
		schema: z.strictObject({ scheduleId: scheduleIdSchema, isActive: z.boolean() }),
	},
	({ actor, organizationId, input }) =>
		updateSchedule(actor, organizationId, { id: input.scheduleId, isActive: input.isActive }),
);

// ============================================
// EXECUTION HISTORY
// ============================================

export const getExecutionHistoryAction = organizationAction(
	{
		name: "scheduledExport.executionHistory",
		requires: "orgAdmin",
		schema: z.strictObject({
			scheduleId: scheduleIdSchema,
			limit: z.number().int().positive().max(500).optional(),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const executions = yield* dbService.query("scheduledExport.executionHistory", () =>
				dbService.db.query.scheduledExportExecution.findMany({
					where: and(
						eq(scheduledExportExecution.scheduledExportId, input.scheduleId),
						eq(scheduledExportExecution.organizationId, organizationId),
					),
					orderBy: [desc(scheduledExportExecution.triggeredAt)],
					limit: input.limit ?? 50,
				}),
			);

			return executions.map(
				(e): ExecutionHistoryItem => ({
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
				}),
			);
		}),
);

// ============================================
// PREVIEW NEXT EXECUTIONS
// ============================================

/** Reads no organization data; it needs only a member of the active organization. */
export const previewNextExecutionsAction = organizationAction(
	{
		name: "scheduledExport.previewNextExecutions",
		requires: "member",
		schema: z.strictObject({
			scheduleType: scheduleTypeSchema,
			cronExpression: z.string().optional(),
			timezone: z.string().min(1, "Timezone is required"),
			count: z.number().int().positive().max(50).optional(),
		}),
	},
	({ input }) =>
		Effect.gen(function* () {
			yield* validateCron(input.scheduleType, input.cronExpression);

			const config: ScheduleConfig = {
				type: input.scheduleType,
				cronExpression: input.cronExpression,
				timezone: input.timezone,
			};

			const executions = getNextExecutions(config, input.count ?? 5, DateTime.utc());
			return executions.map((dt) => dt.toISO()!);
		}),
);

// ============================================
// RUN NOW
// ============================================

export const runScheduledExportNowAction = organizationAction(
	{
		name: "scheduledExport.runNow",
		requires: "orgAdmin",
		schema: z.strictObject({ scheduleId: scheduleIdSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const schedule = yield* findSchedule(
				organizationId,
				input.scheduleId,
				"scheduledExport.getForRun",
			);
			// The run acts on behalf of the owner, who must still be an org admin.
			yield* validateEligibleOwner(yield* ownerOf(organizationId, schedule.ownerId), "ownerId");

			yield* auditedWrite("scheduledExport.auditRunRequest", (tx, audit) =>
				audit.record(tx, {
					organizationId,
					action: AuditAction.SCHEDULED_EXPORT_RUN_REQUESTED,
					actorUserId: actor.userId,
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
					requestedBy: actor.userId,
				}),
			);

			// Return a placeholder execution ID (the orchestrator creates one internally)
			return { executionId: "started" };
		}),
);

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

export const getFilterOptionsAction = organizationAction(
	{ name: "scheduledExport.filterOptions", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const { db } = dbService;

			const employees = yield* dbService.query("scheduledExport.filterEmployees", () =>
				db
					.select({
						id: employee.id,
						firstName: user.firstName,
						lastName: user.lastName,
						employeeNumber: employee.employeeNumber,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.where(eq(employee.organizationId, organizationId))
					.orderBy(asc(user.lastName), asc(user.firstName)),
			);

			const teams = yield* dbService.query("scheduledExport.filterTeams", () =>
				db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: (t, { asc }) => [asc(t.name)],
				}),
			);

			const projects = yield* dbService.query("scheduledExport.filterProjects", () =>
				db.query.project.findMany({
					where: eq(project.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: (p, { asc }) => [asc(p.name)],
				}),
			);

			return {
				employees: employees.map((employeeRow) => ({
					id: employeeRow.id,
					firstName: employeeRow.firstName ?? "",
					lastName: employeeRow.lastName ?? "",
					employeeNumber: employeeRow.employeeNumber ?? undefined,
				})),
				teams: teams.map((t) => ({ id: t.id, name: t.name })),
				projects: projects.map((p) => ({ id: p.id, name: p.name })),
			} satisfies FilterOptions;
		}),
);

// ============================================
// PAYROLL CONFIGS
// ============================================

export interface PayrollConfigSummary {
	id: string;
	formatId: string;
	formatName: string;
}

export const getPayrollConfigsAction = organizationAction(
	{ name: "scheduledExport.payrollConfigs", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const configs = yield* dbService.query("scheduledExport.payrollConfigs", () =>
				dbService.db.query.payrollExportConfig.findMany({
					where: and(
						eq(payrollExportConfig.organizationId, organizationId),
						eq(payrollExportConfig.isActive, true),
					),
					with: { format: true },
				}),
			);

			const typedConfigs = configs as unknown as PayrollExportConfigWithFormat[];

			return typedConfigs.map(
				(c): PayrollConfigSummary => ({
					id: c.id,
					formatId: c.format?.id ?? c.formatId,
					formatName: c.format?.name ?? c.formatId,
				}),
			);
		}),
);
