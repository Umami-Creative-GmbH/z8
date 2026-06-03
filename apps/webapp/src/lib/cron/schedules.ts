import { CRON_JOBS, type CronJobName, getAllCronJobNames } from "./registry";

export interface CronSchedulePreset {
	id: string;
	pattern: string;
	label: string;
}

export interface CronScheduleOverrideLike {
	jobName: CronJobName;
	presetId: string | null;
	pattern: string;
}

export interface RepeatableCronJobLike {
	name: string;
	pattern?: string | null;
	next?: string | number | null;
}

export interface EffectiveCronSchedule {
	jobName: CronJobName;
	defaultPattern: string;
	effectivePattern: string;
	presetId: string | null;
	isOverridden: boolean;
	canEdit: boolean;
}

export interface ScheduledCronJobRow extends EffectiveCronSchedule {
	name: CronJobName;
	next: string | number | null;
	currentBullMqPattern: string | null;
	hasScheduleMismatch: boolean;
}

export const CRON_SCHEDULE_PRESETS = [
	{ id: "every-minute", pattern: "* * * * *", label: "Every minute" },
	{ id: "every-5-minutes", pattern: "*/5 * * * *", label: "Every 5 minutes" },
	{ id: "every-15-minutes", pattern: "*/15 * * * *", label: "Every 15 minutes" },
	{ id: "every-30-minutes", pattern: "*/30 * * * *", label: "Every 30 minutes" },
	{ id: "hourly", pattern: "0 * * * *", label: "Hourly" },
	{ id: "every-3-hours", pattern: "0 */3 * * *", label: "Every 3 hours" },
	{ id: "daily-midnight", pattern: "0 0 * * *", label: "Daily at midnight" },
	{ id: "daily-1am", pattern: "0 1 * * *", label: "Daily at 1 AM" },
	{ id: "daily-230am", pattern: "30 2 * * *", label: "Daily at 2:30 AM" },
	{
		id: "weekly-sunday-midnight",
		pattern: "0 0 * * 0",
		label: "Weekly on Sunday at midnight",
	},
] as const satisfies readonly CronSchedulePreset[];

const HIGH_RISK_CRON_JOBS = new Set<CronJobName>([
	"cron:billing-seat-reconciliation",
	"cron:execution-cleanup",
	"cron:organization-cleanup",
	"cron:break-enforcement",
	"cron:teams-daily-digest",
	"cron:teams-escalation",
	"cron:telegram-daily-digest",
	"cron:telegram-escalation",
	"cron:discord-daily-digest",
	"cron:discord-escalation",
	"cron:slack-daily-digest",
	"cron:slack-escalation",
]);

export function getPresetById(presetId: string): CronSchedulePreset | null {
	return CRON_SCHEDULE_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function getPresetByPattern(pattern: string): CronSchedulePreset | null {
	return CRON_SCHEDULE_PRESETS.find((preset) => preset.pattern === pattern) ?? null;
}

export function isHighRiskCronJob(jobName: CronJobName): boolean {
	return HIGH_RISK_CRON_JOBS.has(jobName);
}

export function resolveEffectiveCronSchedules({
	overrides,
}: {
	overrides: readonly CronScheduleOverrideLike[];
}): Record<CronJobName, EffectiveCronSchedule> {
	const overridesByJobName = new Map(overrides.map((override) => [override.jobName, override]));

	return Object.fromEntries(
		getAllCronJobNames().map((jobName) => {
			const defaultPattern = CRON_JOBS[jobName].schedule;
			const override = overridesByJobName.get(jobName);
			const defaultPreset = getPresetByPattern(defaultPattern);
			const effectivePattern = override?.pattern ?? defaultPattern;

			return [
				jobName,
				{
					jobName,
					defaultPattern,
					effectivePattern,
					presetId: override?.presetId ?? getPresetByPattern(effectivePattern)?.id ?? null,
					isOverridden: Boolean(override && override.pattern !== defaultPattern),
					canEdit: defaultPreset !== null,
				},
			];
		}),
	) as Record<CronJobName, EffectiveCronSchedule>;
}

export function buildScheduledJobRows({
	overrides,
	repeatableJobs,
}: {
	overrides: readonly CronScheduleOverrideLike[];
	repeatableJobs: readonly RepeatableCronJobLike[];
}): ScheduledCronJobRow[] {
	const repeatableJobsByName = new Map(repeatableJobs.map((job) => [job.name, job]));
	const schedules = resolveEffectiveCronSchedules({ overrides });

	return getAllCronJobNames()
		.map((name) => {
			const schedule = schedules[name];
			const repeatableJob = repeatableJobsByName.get(name);
			const currentBullMqPattern = repeatableJob?.pattern ?? null;

			return {
				...schedule,
				name,
				next: repeatableJob?.next ?? null,
				currentBullMqPattern,
				hasScheduleMismatch: currentBullMqPattern !== schedule.effectivePattern,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}
