/**
 * Scheduled Export Orchestrator
 *
 * Main application service that coordinates:
 * - Finding due schedules
 * - Calculating date ranges
 * - Executing reports
 * - Delivering results
 * - Updating next execution times
 */

import { and, eq, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, scheduledExport, scheduledExportExecution } from "@/db";
import type { ScheduledExport, ScheduledExportExecution } from "@/db/schema/scheduled-export";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { calculateDateRange } from "../domain/date-range-calculator";
import { calculateNextExecution } from "../domain/schedule-evaluator";
import {
	type DateRangeConfig,
	type DeliveryConfig,
	deliversByEmail,
	type FilterConfig,
	type ReportConfig,
	type ScheduleConfig,
	type ScheduledExportsProcessorResult,
} from "../domain/types";
import { DeliveryService } from "../infrastructure/delivery-service";
import { executorRegistry } from "./executors/registry";
import { pauseSchedulesWithIneligibleOwners } from "./schedule-owner";

const logger = createLogger("ScheduledExportOrchestrator");

/** Why a run happened: its schedule came due, or an org admin asked for it. */
export type RunTrigger = { trigger: "schedule" } | { trigger: "run_now"; requestedBy: string };

/**
 * Scheduled Export Orchestrator
 */
export class ScheduledExportOrchestrator {
	private deliveryService = new DeliveryService();

	/**
	 * Find and process all due scheduled exports
	 * Called by the cron job processor
	 */
	async processDueExports(): Promise<ScheduledExportsProcessorResult> {
		const now = DateTime.utc();
		const result: ScheduledExportsProcessorResult = {
			success: true,
			processed: 0,
			succeeded: 0,
			failed: 0,
			errors: [],
		};

		try {
			// A schedule whose owner is no longer an org admin pauses instead of running (#988).
			// Departures take effect by date, so this tick is what notices them.
			await pauseSchedulesWithIneligibleOwners(db, { now: instantFromDate(now.toJSDate()) });

			// Find all active schedules that are due
			const dueSchedules = await this.findDueSchedules(now);

			logger.info({ count: dueSchedules.length }, "Found due scheduled exports");

			const scheduleResults = await Promise.all(
				dueSchedules.map(async (schedule) => {
					try {
						await this.executeSchedule(schedule, now);
						return { scheduleId: schedule.id, success: true as const };
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error";
						logger.error(
							{ scheduleId: schedule.id, error: errorMessage },
							"Schedule execution failed",
						);
						return { scheduleId: schedule.id, success: false as const, error: errorMessage };
					}
				}),
			);

			result.processed = scheduleResults.length;
			result.succeeded = scheduleResults.filter((scheduleResult) => scheduleResult.success).length;
			result.failed = scheduleResults.length - result.succeeded;
			result.success = result.failed === 0;
			result.errors = scheduleResults.flatMap((scheduleResult) =>
				scheduleResult.success
					? []
					: [{ scheduleId: scheduleResult.scheduleId, error: scheduleResult.error }],
			);

			logger.info(
				{ processed: result.processed, succeeded: result.succeeded, failed: result.failed },
				"Scheduled exports processing completed",
			);

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error: errorMessage }, "Failed to process due exports");

			return {
				success: false,
				processed: result.processed,
				succeeded: result.succeeded,
				failed: result.failed + 1,
				errors: [...result.errors, { scheduleId: "orchestrator", error: errorMessage }],
			};
		}
	}

	/**
	 * Execute a single scheduled export
	 */
	async executeSchedule(
		schedule: ScheduledExport,
		triggeredAt: DateTime,
		run: RunTrigger = { trigger: "schedule" },
	): Promise<void> {
		const startTime = Date.now();

		logger.info({ scheduleId: schedule.id, name: schedule.name }, "Executing scheduled export");

		// Create execution record
		const execution = await this.createExecution(schedule, triggeredAt);

		try {
			// Update status to processing
			await this.updateExecutionStatus(execution.id, "processing");

			// Build schedule config
			const scheduleConfig: ScheduleConfig = {
				type: schedule.scheduleType,
				cronExpression: schedule.cronExpression || undefined,
				timezone: schedule.timezone,
			};

			// Calculate date range
			const dateRangeConfig: DateRangeConfig = {
				strategy: schedule.dateRangeStrategy,
				customOffset: schedule.customOffset || undefined,
			};
			const dateRange = calculateDateRange(dateRangeConfig, triggeredAt, schedule.timezone);

			logger.info(
				{
					scheduleId: schedule.id,
					dateRange: {
						start: dateRange.start.toISODate(),
						end: dateRange.end.toISODate(),
					},
				},
				"Calculated date range",
			);

			// Get executor for report type
			const executor = executorRegistry.get(schedule.reportType);
			if (!executor) {
				throw new Error(`No executor found for report type: ${schedule.reportType}`);
			}

			// Build report config
			const reportConfig = schedule.reportConfig as ReportConfig;

			// Build filter config
			const filterConfig: FilterConfig | undefined = schedule.filters || undefined;

			// Execute report
			const exportResult = await executor.execute({
				executionId: execution.id,
				organizationId: schedule.organizationId,
				reportConfig,
				dateRange,
				filters: filterConfig,
				payrollConfigId: schedule.payrollConfigId || undefined,
				ownerId: schedule.ownerId,
				emailRecipients: deliversByEmail(schedule.deliveryMethod) ? schedule.emailRecipients : [],
			});

			if (!exportResult.success) {
				throw new Error(exportResult.error || "Export execution failed");
			}

			// Build delivery config
			const deliveryConfig: DeliveryConfig = {
				method: schedule.deliveryMethod,
				emailRecipients: schedule.emailRecipients,
				emailSubjectTemplate: schedule.emailSubjectTemplate || undefined,
				useOrgS3Config: schedule.useOrgS3Config,
				customS3Prefix: schedule.customS3Prefix || undefined,
			};

			// Deliver results
			const deliveryResult = await this.deliveryService.deliver({
				organizationId: schedule.organizationId,
				scheduleName: schedule.name,
				dateRange,
				deliveryConfig,
				exportResult,
			});

			// Update execution with results; the run's delivery entry commits with it.
			const durationMs = Date.now() - startTime;
			const emailed = deliversByEmail(schedule.deliveryMethod) ? schedule.emailRecipients : [];
			await withAuditTrail((audit) =>
				db.transaction(async (tx) => {
					await tx
						.update(scheduledExportExecution)
						.set({
							status: "completed",
							underlyingJobId: exportResult.underlyingJobId,
							underlyingJobType: exportResult.underlyingJobType,
							s3Key: deliveryResult.s3Key,
							s3Url: deliveryResult.s3Url,
							fileSizeBytes: exportResult.fileSizeBytes,
							recordCount: exportResult.recordCount,
							emailsSent: deliveryResult.emailsSent,
							emailsFailed: deliveryResult.emailsFailed,
							emailErrors: deliveryResult.emailErrors,
							completedAt: DateTime.utc().toJSDate(),
							durationMs,
						})
						.where(eq(scheduledExportExecution.id, execution.id));
					await audit.record(tx, {
						organizationId: schedule.organizationId,
						action: AuditAction.SCHEDULED_EXPORT_DELIVERED,
						// The run acts on behalf of the schedule owner (#988).
						actorUserId: schedule.ownerId,
						targetType: "scheduled_export",
						targetId: schedule.id,
						metadata: {
							...this.runMetadata(execution.id, run, dateRange),
							deliveryMethod: schedule.deliveryMethod,
							fileStored: Boolean(deliveryResult.s3Key),
							recipients: emailed,
							failedRecipients: (deliveryResult.emailErrors ?? []).map((error) => error.recipient),
							skippedRecipients: [],
						},
					});
				}),
			);

			// Update schedule's next execution time
			await this.updateNextExecution(schedule, scheduleConfig);

			logger.info(
				{ scheduleId: schedule.id, executionId: execution.id, durationMs },
				"Schedule executed successfully",
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const errorStack = error instanceof Error ? error.stack : undefined;
			const durationMs = Date.now() - startTime;

			await withAuditTrail((audit) =>
				db.transaction(async (tx) => {
					await tx
						.update(scheduledExportExecution)
						.set({
							// A run whose result could not be recorded is a failed run too.
							status: "failed",
							errorMessage,
							errorStack,
							completedAt: DateTime.utc().toJSDate(),
							durationMs,
						})
						.where(eq(scheduledExportExecution.id, execution.id));
					await audit.record(tx, {
						organizationId: schedule.organizationId,
						action: AuditAction.SCHEDULED_EXPORT_RUN_FAILED,
						actorUserId: schedule.ownerId,
						targetType: "scheduled_export",
						targetId: schedule.id,
						metadata: { ...this.runMetadata(execution.id, run), error: errorMessage },
					});
				}),
			);

			// Still update next execution time so we don't get stuck
			try {
				const scheduleConfig: ScheduleConfig = {
					type: schedule.scheduleType,
					cronExpression: schedule.cronExpression || undefined,
					timezone: schedule.timezone,
				};
				await this.updateNextExecution(schedule, scheduleConfig);
			} catch (updateError) {
				logger.error(
					{ scheduleId: schedule.id, error: updateError },
					"Failed to update next execution time after failure",
				);
			}

			throw error;
		}
	}

	/** What every run entry in the audit log says about its run. */
	private runMetadata(
		executionId: string,
		run: RunTrigger,
		dateRange?: { start: DateTime; end: DateTime },
	): Record<string, unknown> {
		return {
			executionId,
			trigger: run.trigger,
			requestedBy: run.trigger === "run_now" ? run.requestedBy : null,
			...(dateRange
				? { dateRange: { start: dateRange.start.toISODate(), end: dateRange.end.toISODate() } }
				: {}),
		};
	}

	/**
	 * Find all schedules that are due for execution
	 */
	private async findDueSchedules(currentTime: DateTime): Promise<ScheduledExport[]> {
		const schedules = await db.query.scheduledExport.findMany({
			where: and(
				eq(scheduledExport.isActive, true),
				lte(scheduledExport.nextExecutionAt, currentTime.toJSDate()),
			),
		});

		return schedules;
	}

	/**
	 * Create execution record
	 */
	private async createExecution(
		schedule: ScheduledExport,
		triggeredAt: DateTime,
	): Promise<{ id: string }> {
		// Calculate date range for recording
		const dateRangeConfig: DateRangeConfig = {
			strategy: schedule.dateRangeStrategy,
			customOffset: schedule.customOffset || undefined,
		};
		const dateRange = calculateDateRange(dateRangeConfig, triggeredAt, schedule.timezone);

		const [execution] = await db
			.insert(scheduledExportExecution)
			.values({
				scheduledExportId: schedule.id,
				organizationId: schedule.organizationId,
				triggeredAt: triggeredAt.toJSDate(),
				scheduledFor: schedule.nextExecutionAt!,
				dateRangeStart: dateRange.start.toISODate()!,
				dateRangeEnd: dateRange.end.toISODate()!,
				status: "pending",
			})
			.returning({ id: scheduledExportExecution.id });

		return execution;
	}

	/**
	 * Update execution status
	 */
	private async updateExecutionStatus(
		executionId: string,
		status: "pending" | "processing" | "completed" | "failed",
	): Promise<void> {
		const updates: Partial<ScheduledExportExecution> = { status };
		if (status === "processing") {
			updates.startedAt = DateTime.utc().toJSDate();
		}

		await db
			.update(scheduledExportExecution)
			.set(updates)
			.where(eq(scheduledExportExecution.id, executionId));
	}

	/**
	 * Update schedule's next execution time
	 */
	private async updateNextExecution(
		schedule: ScheduledExport,
		scheduleConfig: ScheduleConfig,
	): Promise<void> {
		const now = DateTime.utc();
		const nextExecution = calculateNextExecution(scheduleConfig, now);

		await db
			.update(scheduledExport)
			.set({
				lastExecutionAt: now.toJSDate(),
				nextExecutionAt: nextExecution.toJSDate(),
			})
			.where(eq(scheduledExport.id, schedule.id));

		logger.debug(
			{ scheduleId: schedule.id, nextExecutionAt: nextExecution.toISO() },
			"Updated next execution time",
		);
	}
}
