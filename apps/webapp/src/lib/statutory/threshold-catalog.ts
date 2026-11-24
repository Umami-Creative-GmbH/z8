/**
 * The German statutory baselines Z8 seeds into `statutory_threshold` (`country_code = 'DE'`,
 * `organization_id IS NULL`). Values are never hardcoded in monitors: read them through
 * `loadStatutoryThresholds` for the dates being evaluated. A new key needs a seeding migration
 * (setting `z8.statutory_baseline_maintenance = 'on'`) and an entry here.
 */

export const statutoryDomains = [
	"minijob",
	"short_term",
	"working_student",
	"on_call",
	"youth_protection",
	"apprenticeship",
] as const;
export type StatutoryDomain = (typeof statutoryDomains)[number];

export type StatutoryThresholdUnit =
	| "cents"
	| "minutes"
	| "days"
	| "weeks"
	| "months"
	| "percent"
	| "multiplier"
	| "minute_of_day";

interface CatalogEntry {
	readonly domain: StatutoryDomain;
	readonly unit: StatutoryThresholdUnit;
}

export const statutoryThresholdCatalog = {
	de_minijob_monthly_limit_cents: { domain: "minijob", unit: "cents" },
	de_minijob_max_unforeseeable_months_per_12m: { domain: "minijob", unit: "months" },
	de_minijob_unforeseeable_multiplier: { domain: "minijob", unit: "multiplier" },
	de_short_term_max_work_days_per_year: { domain: "short_term", unit: "days" },
	de_short_term_max_months_per_year: { domain: "short_term", unit: "months" },
	de_working_student_weekly_minutes: { domain: "working_student", unit: "minutes" },
	de_working_student_max_over_20h_weeks_per_12m: { domain: "working_student", unit: "weeks" },
	de_working_student_max_over_20h_days_per_12m: { domain: "working_student", unit: "days" },
	de_on_call_notice_full_days: { domain: "on_call", unit: "days" },
	de_on_call_min_call_minutes: { domain: "on_call", unit: "minutes" },
	de_on_call_default_weekly_minutes: { domain: "on_call", unit: "minutes" },
	de_on_call_min_band_plus_pct: { domain: "on_call", unit: "percent" },
	de_on_call_max_band_minus_pct: { domain: "on_call", unit: "percent" },
	de_jarbschg_max_daily_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_max_daily_compensatory_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_max_weekly_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_max_days_per_week: { domain: "youth_protection", unit: "days" },
	de_jarbschg_min_rest_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_break_after_270_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_break_after_360_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_min_break_segment_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_max_uninterrupted_minutes: { domain: "youth_protection", unit: "minutes" },
	de_jarbschg_night_start: { domain: "youth_protection", unit: "minute_of_day" },
	de_jarbschg_night_end: { domain: "youth_protection", unit: "minute_of_day" },
} as const satisfies Record<string, CatalogEntry>;

export type StatutoryThresholdKey = keyof typeof statutoryThresholdCatalog;

export const statutoryThresholdKeys = Object.keys(
	statutoryThresholdCatalog,
) as StatutoryThresholdKey[];

export function isStatutoryThresholdKey(value: string): value is StatutoryThresholdKey {
	return Object.hasOwn(statutoryThresholdCatalog, value);
}

/** Money baselines (EUR caps) are admin-only, like wages: scoped managers never see them. */
export function isMoneyThreshold(key: StatutoryThresholdKey): boolean {
	return statutoryThresholdCatalog[key].unit === "cents";
}
