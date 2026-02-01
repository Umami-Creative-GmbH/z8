"use server";

import { and, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db, scheduledExport, scheduledExportExecution } from "@/db";
import { member } from "@/db/auth-schema";
import type {
	ScheduledExport,
	ScheduledExportExecution,
	ScheduledExportReportConfig,
	ScheduledExportFilters,
	ScheduledExportCustomOffset,
} from "@/db/schema/scheduled-export";
import { AuthorizationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	calculateNextExecution,
	validateCronExpression,
	getNextExecutions,
} from "@/lib/scheduled-exports/domain/schedule-evaluator";
import type {
	ScheduleConfig,
	ScheduleType,
	ReportType,
	DeliveryMethod,
	DateRangeStrategy,
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
}

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

// ============================================
// HELPERS
// ============================================

async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

// ============================================
// CREATE
// ============================================

export async function createScheduledExportAction(
	input: CreateScheduledExportInput,
): Promise<ServerActionResult<ScheduledExportSummary>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "create",
					}),
				),
			);
		}

		// Validate cron expression if provided
		if (input.scheduleType === "cron" && input.cronExpression) {
			try {
				validateCronExpression(input.cronExpression);
			} catch (error) {
				throw new Error(`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}

		// Validate email recipients (only required for email-based delivery)
		if (input.deliveryMethod === "s3_and_email" || input.deliveryMethod === "email_only") {
			if (!input.emailRecipients || input.emailRecipients.length === 0) {
				throw new Error("At least one email recipient is required for email delivery");
			}

			// Validate email format
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			const invalidEmails = input.emailRecipients.filter((email) => !emailRegex.test(email));
			if (invalidEmails.length > 0) {
				throw new Error(`Invalid email addresses: ${invalidEmails.join(", ")}`);
			}
		}

		// Calculate next execution time
		const scheduleConfig: ScheduleConfig = {
			type: input.scheduleType,
			cronExpression: input.cronExpression,
			timezone: input.timezone || "UTC",
		};
		const nextExecutionAt = calculateNextExecution(scheduleConfig, DateTime.utc());

		// Create schedule
		const schedule = yield* _(
			Effect.promise(async () => {
				const [created] = await db
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
						emailRecipients: input.emailRecipients,
						emailSubjectTemplate: input.emailSubjectTemplate,
						useOrgS3Config: input.useOrgS3Config ?? true,
						customS3Prefix: input.customS3Prefix,
						nextExecutionAt: nextExecutionAt.toJSDate(),
						createdBy: session.user.id,
					})
					.returning();

				return created;
			}),
		);

		revalidatePath("/settings/scheduled-exports");

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
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// READ
// ============================================

export async function getScheduledExportsAction(
	organizationId: string,
): Promise<ServerActionResult<ScheduledExportSummary[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "read",
					}),
				),
			);
		}

		const schedules = yield* _(
			Effect.promise(async () => {
				return db.query.scheduledExport.findMany({
					where: eq(scheduledExport.organizationId, organizationId),
					orderBy: [desc(scheduledExport.createdAt)],
				});
			}),
		);

		return schedules.map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
			scheduleType: s.scheduleType as ScheduleType,
			cronExpression: s.cronExpression,
			timezone: s.timezone,
			reportType: s.reportType as ReportType,
			deliveryMethod: s.deliveryMethod as DeliveryMethod,
			dateRangeStrategy: s.dateRangeStrategy as DateRangeStrategy,
			isActive: s.isActive,
			lastExecutionAt: s.lastExecutionAt,
			nextExecutionAt: s.nextExecutionAt,
			createdAt: s.createdAt,
		}));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getScheduledExportAction(
	organizationId: string,
	scheduleId: string,
): Promise<ServerActionResult<ScheduledExport | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "read",
					}),
				),
			);
		}

		const schedule = yield* _(
			Effect.promise(async () => {
				return db.query.scheduledExport.findFirst({
					where: and(
						eq(scheduledExport.id, scheduleId),
						eq(scheduledExport.organizationId, organizationId),
					),
				});
			}),
		);

		return schedule || null;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// UPDATE
// ============================================

export async function updateScheduledExportAction(
	input: UpdateScheduledExportInput,
): Promise<ServerActionResult<ScheduledExportSummary>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "update",
					}),
				),
			);
		}

		// Validate cron expression if provided
		if (input.scheduleType === "cron" && input.cronExpression) {
			try {
				validateCronExpression(input.cronExpression);
			} catch (error) {
				throw new Error(`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}

		// Build update object
		const updates: Partial<ScheduledExport> = {
			updatedBy: session.user.id,
		};

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
		if (input.emailRecipients !== undefined) updates.emailRecipients = input.emailRecipients;
		if (input.emailSubjectTemplate !== undefined) updates.emailSubjectTemplate = input.emailSubjectTemplate;
		if (input.isActive !== undefined) updates.isActive = input.isActive;

		// Recalculate next execution if schedule changed
		if (input.scheduleType !== undefined || input.cronExpression !== undefined || input.timezone !== undefined) {
			const existing = yield* _(
				Effect.promise(() =>
					db.query.scheduledExport.findFirst({
						where: eq(scheduledExport.id, input.id),
					}),
				),
			);

			if (existing) {
				const scheduleConfig: ScheduleConfig = {
					type: input.scheduleType || existing.scheduleType as ScheduleType,
					cronExpression: input.cronExpression ?? existing.cronExpression ?? undefined,
					timezone: input.timezone || existing.timezone,
				};
				const nextExecutionAt = calculateNextExecution(scheduleConfig, DateTime.utc());
				updates.nextExecutionAt = nextExecutionAt.toJSDate();
			}
		}

		const schedule = yield* _(
			Effect.promise(async () => {
				const [updated] = await db
					.update(scheduledExport)
					.set(updates)
					.where(
						and(
							eq(scheduledExport.id, input.id),
							eq(scheduledExport.organizationId, input.organizationId),
						),
					)
					.returning();

				return updated;
			}),
		);

		if (!schedule) {
			throw new Error("Scheduled export not found");
		}

		revalidatePath("/settings/scheduled-exports");

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
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// DELETE
// ============================================

export async function deleteScheduledExportAction(
	organizationId: string,
	scheduleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "delete",
					}),
				),
			);
		}

		yield* _(
			Effect.promise(async () => {
				await db
					.delete(scheduledExport)
					.where(
						and(
							eq(scheduledExport.id, scheduleId),
							eq(scheduledExport.organizationId, organizationId),
						),
					);
			}),
		);

		revalidatePath("/settings/scheduled-exports");
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export_execution",
						action: "read",
					}),
				),
			);
		}

		const executions = yield* _(
			Effect.promise(async () => {
				return db.query.scheduledExportExecution.findMany({
					where: and(
						eq(scheduledExportExecution.scheduledExportId, scheduleId),
						eq(scheduledExportExecution.organizationId, organizationId),
					),
					orderBy: [desc(scheduledExportExecution.triggeredAt)],
					limit,
				});
			}),
		);

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

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
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
	const effect = Effect.gen(function* (_) {
		// Validate cron expression if provided
		if (scheduleType === "cron" && cronExpression) {
			try {
				validateCronExpression(cronExpression);
			} catch (error) {
				throw new Error(`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`);
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

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// RUN NOW
// ============================================

export async function runScheduledExportNowAction(
	organizationId: string,
	scheduleId: string,
): Promise<ServerActionResult<{ executionId: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "execute",
					}),
				),
			);
		}

		// Get the schedule
		const schedule = yield* _(
			Effect.promise(async () => {
				return db.query.scheduledExport.findFirst({
					where: and(
						eq(scheduledExport.id, scheduleId),
						eq(scheduledExport.organizationId, organizationId),
					),
				});
			}),
		);

		if (!schedule) {
			throw new Error("Scheduled export not found");
		}

		// Import and run the orchestrator
		const { ScheduledExportOrchestrator } = yield* _(
			Effect.promise(() => import("@/lib/scheduled-exports/application/orchestrator")),
		);

		const orchestrator = new ScheduledExportOrchestrator();
		yield* _(Effect.promise(() => orchestrator.executeSchedule(schedule, DateTime.utc())));

		// Return a placeholder execution ID (the orchestrator creates one internally)
		return { executionId: "started" };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "read",
					}),
				),
			);
		}

		// Import employee, team, project tables
		const { employee, team, project } = yield* _(
			Effect.promise(() => import("@/db")),
		);

		// Fetch employees
		const employees = yield* _(
			Effect.promise(async () => {
				return db.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
					columns: {
						id: true,
						firstName: true,
						lastName: true,
						employeeNumber: true,
					},
					orderBy: (emp, { asc }) => [asc(emp.lastName), asc(emp.firstName)],
				});
			}),
		);

		// Fetch teams
		const teams = yield* _(
			Effect.promise(async () => {
				return db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: {
						id: true,
						name: true,
					},
					orderBy: (t, { asc }) => [asc(t.name)],
				});
			}),
		);

		// Fetch projects
		const projects = yield* _(
			Effect.promise(async () => {
				return db.query.project.findMany({
					where: eq(project.organizationId, organizationId),
					columns: {
						id: true,
						name: true,
					},
					orderBy: (p, { asc }) => [asc(p.name)],
				});
			}),
		);

		return {
			employees: employees.map((e) => ({
				id: e.id,
				firstName: e.firstName ?? "",
				lastName: e.lastName ?? "",
				employeeNumber: e.employeeNumber ?? undefined,
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

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "scheduled_export",
						action: "read",
					}),
				),
			);
		}

		const { payrollExportConfig, payrollExportFormat } = yield* _(
			Effect.promise(() => import("@/db")),
		);

		const configs = yield* _(
			Effect.promise(async () => {
				return db.query.payrollExportConfig.findMany({
					where: and(
						eq(payrollExportConfig.organizationId, organizationId),
						eq(payrollExportConfig.isActive, true),
					),
					with: {
						format: true,
					},
				});
			}),
		);

		return configs.map((c) => ({
			id: c.id,
			formatId: c.format?.id ?? c.formatId,
			formatName: c.format?.name ?? c.formatId,
		}));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
