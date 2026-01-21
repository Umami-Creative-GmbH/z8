/**
 * Cron Job Execution Tracking Schema
 *
 * Stores execution history for cron jobs, enabling:
 * - Historical tracking independent of BullMQ retention policies
 * - Job metrics and success rate analysis
 * - Debugging and auditing capabilities
 */

import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

/**
 * Cron job execution status
 */
export type CronJobStatus = "pending" | "running" | "completed" | "failed";

/**
 * Cron job execution record
 *
 * Each row represents a single execution of a cron job, whether triggered
 * automatically by BullMQ repeatable jobs or manually via API.
 */
export const cronJobExecution = pgTable(
	"cron_job_execution",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/** Name of the cron job (e.g., "cron:vacation", "cron:export") */
		jobName: varchar("job_name", { length: 100 }).notNull(),

		/** BullMQ job ID for correlation with queue state */
		bullmqJobId: varchar("bullmq_job_id", { length: 100 }),

		/** Current execution status */
		status: varchar("status", { length: 20 }).$type<CronJobStatus>().notNull(),

		/** When the job started executing */
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),

		/** When the job completed (success or failure) */
		completedAt: timestamp("completed_at", { withTimezone: true }),

		/** Execution duration in milliseconds */
		durationMs: integer("duration_ms"),

		/** Job result data (typed per job) */
		result: jsonb("result"),

		/** Error message if the job failed */
		error: text("error"),

		/** Additional metadata (source, manual params, triggered by, etc.) */
		metadata: jsonb("metadata").$type<{
			source?: "scheduler" | "api" | "manual";
			triggeredBy?: string;
			manualParams?: Record<string, unknown>;
			waitForResult?: boolean;
		}>(),

		/** Record creation timestamp */
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Index for querying job history by name (most common query pattern)
		index("idx_cron_job_execution_job_name_started_at").on(table.jobName, table.startedAt),
		// Index for querying recent executions across all jobs
		index("idx_cron_job_execution_started_at").on(table.startedAt),
		// Index for correlating with BullMQ job state
		index("idx_cron_job_execution_bullmq_job_id").on(table.bullmqJobId),
		// Index for filtering by status (useful for finding failed jobs)
		index("idx_cron_job_execution_status").on(table.status),
	],
);

// Type exports
export type CronJobExecution = typeof cronJobExecution.$inferSelect;
export type NewCronJobExecution = typeof cronJobExecution.$inferInsert;
