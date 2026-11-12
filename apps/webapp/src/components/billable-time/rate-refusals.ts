import type { RefusalOverrides } from "@/lib/organization-action/action-error-message";

/** The billable and cost rate settings' texts for `actionErrorMessage`. */
export const RATE_REFUSALS = {
	billable_time_off: ["settings.billableTime.rates.switchedOff", "Billable Time is switched off."],
	invalid_rate: [
		"settings.billableTime.rates.invalidRate",
		"Enter a positive hourly rate with at most two decimals.",
	],
	invalid_date: ["settings.billableTime.rates.invalidDate", "Enter a valid date."],
	NotFoundError: [
		"settings.billableTime.rates.targetNotFound",
		"The employee, project or customer was not found.",
	],
} satisfies RefusalOverrides;
