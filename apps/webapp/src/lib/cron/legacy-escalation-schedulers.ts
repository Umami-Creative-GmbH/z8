import type { CronJobName } from "./registry";

export const LEGACY_ESCALATION_JOB_NAMES = [
	"cron:teams-escalation",
	"cron:telegram-escalation",
	"cron:discord-escalation",
	"cron:slack-escalation",
] as const satisfies readonly CronJobName[];

/** Infrastructure retirement only; this never grants organization ownership. */
export function isLegacyEscalationSchedulerRetired(jobName: CronJobName): boolean {
	return process.env.RETIRE_LEGACY_ESCALATION_SCHEDULERS === "true" &&
		LEGACY_ESCALATION_JOB_NAMES.some((name) => name === jobName);
}
