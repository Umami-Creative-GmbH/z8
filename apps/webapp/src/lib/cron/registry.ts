/**
 * Cron Job Registry
 *
 * Single source of truth for all cron job definitions.
 * Defines schedules, processors, and metadata for each job type.
 *
 * Key benefits:
 * - Type-safe job data and results
 * - Easy to add new cron jobs (single location)
 * - Consistent scheduling configuration
 * - Clear documentation of each job's purpose
 */

import type { JobsOptions } from "bullmq";

// ============================================
// TYPES
// ============================================

/**
 * Cron job processor function signature
 *
 * Note: manualParams is typed as `unknown` to allow processors to cast
 * to their specific parameter types internally.
 */
export type CronJobProcessor<TResult = unknown> = (params: {
	triggeredAt: string;
	manualParams?: unknown;
}) => Promise<TResult>;

/**
 * Cron job definition structure
 */
export interface CronJobDefinition<TResult = unknown> {
	/** Cron pattern (e.g., "0 0 * * *" for daily at midnight) */
	schedule: string;
	/** Human-readable description of the job's purpose */
	description: string;
	/** The function that executes the job logic */
	processor: CronJobProcessor<TResult>;
	/** Optional BullMQ job options (attempts, priority, etc.) */
	defaultJobOptions?: Partial<JobsOptions>;
}

// ============================================
// JOB RESULT TYPES (imported from job processors)
// ============================================

/** Result from vacation automation job */
export interface VacationAutomationResult {
	carryover?: {
		success: boolean;
		startedAt: Date;
		completedAt: Date;
		organizationsProcessed: number;
		results: Array<{
			organizationId: string;
			organizationName: string;
			error?: string;
		}>;
		errors: string[];
	};
	expiry?: {
		success: boolean;
		startedAt: Date;
		completedAt: Date;
		organizationsProcessed: number;
		results: Array<{
			organizationId: string;
			organizationName: string;
			error?: string;
		}>;
		errors: string[];
	};
	accrual?: {
		success: boolean;
		startedAt: Date;
		completedAt: Date;
		month: number;
		year: number;
		organizationsProcessed: number;
		totalEmployeesProcessed: number;
		totalDaysAccrued: number;
		errors: string[];
	};
}

/** Result from export processor job */
export interface ExportProcessorResult {
	success: boolean;
	exportsProcessed: number;
	errors: string[];
}

/** Result from organization cleanup job */
export interface OrganizationCleanupResult {
	success: boolean;
	organizationsDeleted: number;
	errors: string[];
}

/** Result from break enforcement job */
export interface BreakEnforcementResult {
	processedCount: number;
	adjustedCount: number;
	errors: Array<{ workPeriodId: string; error: string }>;
}

/** Result from project deadlines job */
export interface ProjectDeadlinesResult {
	notificationsSent: number;
	projectsChecked: number;
}

/** Result from telemetry job */
export interface TelemetryResult {
	success: boolean;
	message: string;
}

/** Result from scheduled exports job */
export interface ScheduledExportsResult {
	success: boolean;
	processed: number;
	succeeded: number;
	failed: number;
	errors: Array<{ scheduleId: string; error: string }>;
}

/** Result from Teams daily digest job */
export interface TeamsDailyDigestResult {
	success: boolean;
	tenantsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/** Result from Teams escalation checker job */
export interface TeamsEscalationResult {
	success: boolean;
	tenantsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/** Result from Telegram daily digest job */
export interface TelegramDailyDigestResult {
	success: boolean;
	botsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/** Result from Telegram escalation checker job */
export interface TelegramEscalationResult {
	success: boolean;
	botsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/** Result from Discord daily digest job */
export interface DiscordDailyDigestResult {
	success: boolean;
	botsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/** Result from Discord escalation checker job */
export interface DiscordEscalationResult {
	success: boolean;
	botsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/** Result from Slack daily digest job */
export interface SlackDailyDigestResult {
	success: boolean;
	botsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/** Result from Slack escalation checker job */
export interface SlackEscalationResult {
	success: boolean;
	botsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

// ============================================
// CRON JOB REGISTRY
// ============================================

/**
 * Central registry of all cron jobs
 *
 * Each job defines:
 * - schedule: Cron pattern for automatic execution
 * - description: What the job does
 * - processor: Function that executes the job logic (lazily imported)
 * - defaultJobOptions: BullMQ options for retry, priority, etc.
 */
export const CRON_JOBS = {
	"cron:vacation": {
		schedule: "0 0 * * *", // Daily at midnight
		description: "Vacation automation (carryover, expiry, accrual)",
		processor: async () => {
			const { runVacationAutomation } = await import("@/lib/jobs/carryover-automation");
			return runVacationAutomation();
		},
		defaultJobOptions: { attempts: 2, priority: 5 },
	},

	"cron:export": {
		schedule: "*/5 * * * *", // Every 5 minutes
		description: "Process pending data exports",
		processor: async () => {
			const { runExportProcessor } = await import("@/lib/jobs/export-processor");
			return runExportProcessor();
		},
		defaultJobOptions: { attempts: 3, priority: 3 },
	},

	"cron:organization-cleanup": {
		schedule: "0 1 * * *", // Daily at 1 AM
		description: "Delete soft-deleted organizations older than 5 days",
		processor: async () => {
			const { runOrganizationCleanup } = await import("@/lib/jobs/organization-cleanup");
			return runOrganizationCleanup();
		},
		defaultJobOptions: { attempts: 2, priority: 8 },
	},

	"cron:break-enforcement": {
		schedule: "* * * * *", // Every minute
		description: "Check break compliance for active work periods",
		processor: async ({ manualParams }) => {
			const { runBreakEnforcementCheck } = await import(
				"@/lib/effect/services/break-enforcement.service"
			);
			const params = manualParams as { organizationId?: string; date?: string } | undefined;
			return runBreakEnforcementCheck(
				params
					? {
							organizationId: params.organizationId,
							date: params.date ? new Date(params.date) : undefined,
						}
					: undefined,
			);
		},
		defaultJobOptions: { attempts: 2, priority: 4 },
	},

	"cron:project-deadlines": {
		schedule: "0 * * * *", // Hourly
		description: "Send project deadline notifications",
		processor: async () => {
			const { checkAndSendDeadlineNotifications } = await import(
				"@/lib/notifications/project-notification-triggers"
			);
			return checkAndSendDeadlineNotifications();
		},
		defaultJobOptions: { attempts: 2, priority: 6 },
	},

	"cron:telemetry": {
		schedule: "*/15 * * * *", // Every 15 minutes
		description: "Collect and export telemetry data",
		processor: async (): Promise<TelemetryResult> => {
			// Telemetry collection - placeholder for actual implementation
			return { success: true, message: "Telemetry collected" };
		},
		defaultJobOptions: { attempts: 1, priority: 9 },
	},

	"cron:scheduled-exports": {
		schedule: "*/5 * * * *", // Every 5 minutes
		description: "Process due scheduled exports (payroll, data, audit reports)",
		processor: async (): Promise<ScheduledExportsResult> => {
			const { runScheduledExportsProcessor } = await import(
				"@/lib/jobs/scheduled-exports-processor"
			);
			return runScheduledExportsProcessor();
		},
		defaultJobOptions: { attempts: 2, priority: 4 },
	},

	"cron:teams-daily-digest": {
		schedule: "*/15 * * * *", // Every 15 minutes (checks configured digest times)
		description: "Send Teams daily digest cards to managers",
		processor: async (): Promise<TeamsDailyDigestResult> => {
			const { runDailyDigestJob } = await import("@/lib/teams/jobs/daily-digest");
			return runDailyDigestJob();
		},
		defaultJobOptions: { attempts: 2, priority: 5 },
	},

	"cron:teams-escalation": {
		schedule: "*/30 * * * *", // Every 30 minutes
		description: "Check and escalate stale approval requests via Teams",
		processor: async (): Promise<TeamsEscalationResult> => {
			const { runEscalationCheckerJob } = await import("@/lib/teams/jobs/escalation-checker");
			return runEscalationCheckerJob();
		},
		defaultJobOptions: { attempts: 2, priority: 6 },
	},

	"cron:telegram-daily-digest": {
		schedule: "*/15 * * * *", // Every 15 minutes (checks configured digest times)
		description: "Send Telegram daily digest messages to managers",
		processor: async (): Promise<TelegramDailyDigestResult> => {
			const { runTelegramDailyDigestJob } = await import("@/lib/telegram/jobs/daily-digest");
			return runTelegramDailyDigestJob();
		},
		defaultJobOptions: { attempts: 2, priority: 5 },
	},

	"cron:telegram-escalation": {
		schedule: "*/30 * * * *", // Every 30 minutes
		description: "Check and escalate stale approval requests via Telegram",
		processor: async (): Promise<TelegramEscalationResult> => {
			const { runTelegramEscalationCheckerJob } = await import(
				"@/lib/telegram/jobs/escalation-checker"
			);
			return runTelegramEscalationCheckerJob();
		},
		defaultJobOptions: { attempts: 2, priority: 6 },
	},

	"cron:discord-daily-digest": {
		schedule: "*/15 * * * *", // Every 15 minutes (checks configured digest times)
		description: "Send Discord daily digest messages to managers",
		processor: async (): Promise<DiscordDailyDigestResult> => {
			const { runDiscordDailyDigestJob } = await import("@/lib/discord/jobs/daily-digest");
			return runDiscordDailyDigestJob();
		},
		defaultJobOptions: { attempts: 2, priority: 5 },
	},

	"cron:discord-escalation": {
		schedule: "*/30 * * * *", // Every 30 minutes
		description: "Check and escalate stale approval requests via Discord",
		processor: async (): Promise<DiscordEscalationResult> => {
			const { runDiscordEscalationCheckerJob } = await import(
				"@/lib/discord/jobs/escalation-checker"
			);
			return runDiscordEscalationCheckerJob();
		},
		defaultJobOptions: { attempts: 2, priority: 6 },
	},

	"cron:slack-daily-digest": {
		schedule: "*/15 * * * *", // Every 15 minutes (checks configured digest times)
		description: "Send Slack daily digest messages to managers",
		processor: async (): Promise<SlackDailyDigestResult> => {
			const { runSlackDailyDigestJob } = await import("@/lib/slack/jobs/daily-digest");
			return runSlackDailyDigestJob();
		},
		defaultJobOptions: { attempts: 2, priority: 5 },
	},

	"cron:slack-escalation": {
		schedule: "*/30 * * * *", // Every 30 minutes
		description: "Check and escalate stale approval requests via Slack",
		processor: async (): Promise<SlackEscalationResult> => {
			const { runSlackEscalationCheckerJob } = await import("@/lib/slack/jobs/escalation-checker");
			return runSlackEscalationCheckerJob();
		},
		defaultJobOptions: { attempts: 2, priority: 6 },
	},

} as const satisfies Record<string, CronJobDefinition>;

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Union type of all cron job names
 */
export type CronJobName = keyof typeof CRON_JOBS;

/**
 * Data payload for cron jobs in the queue
 */
export interface CronJobData<T extends CronJobName = CronJobName> {
	/** Job type identifier */
	type: T;
	/** ISO timestamp when the job was triggered */
	triggeredAt: string;
	/** Reference to the database execution record */
	executionId: string;
	/** Optional parameters for manual triggers */
	manualParams?: Record<string, unknown>;
}

/**
 * Infer the result type for a specific cron job
 */
export type CronJobResult<T extends CronJobName> = Awaited<
	ReturnType<(typeof CRON_JOBS)[T]["processor"]>
>;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a cron job definition by name
 */
export function getCronJobDefinition<T extends CronJobName>(name: T): (typeof CRON_JOBS)[T] {
	return CRON_JOBS[name];
}

/**
 * Get all cron job names
 */
export function getAllCronJobNames(): CronJobName[] {
	return Object.keys(CRON_JOBS) as CronJobName[];
}

/**
 * Check if a string is a valid cron job name
 */
export function isCronJobName(name: string): name is CronJobName {
	return name in CRON_JOBS;
}

/**
 * Get schedule info for all jobs (useful for worker setup)
 */
export function getCronSchedules(): Record<CronJobName, { pattern: string; description: string }> {
	return Object.fromEntries(
		Object.entries(CRON_JOBS).map(([name, def]) => [
			name,
			{ pattern: def.schedule, description: def.description },
		]),
	) as Record<CronJobName, { pattern: string; description: string }>;
}
