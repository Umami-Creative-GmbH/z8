import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { instantFromDate, type PlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { formatPlainDate, getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";

/** Locale and the organization's IANA zone that violation instants are shown in. */
export interface ViolationDisplayContext {
	locale: string;
	timezone: string;
}

/**
 * A violation's `violationDate` is a stored UTC instant (the start of the offending work),
 * so the day it belongs to is resolved in the organization's timezone — never the viewer's.
 */
export function violationLocalDate(violationDate: Date, timezone: string): PlainDate {
	return plainDateAt(instantFromDate(violationDate), timezone);
}

/** The organization-local violation day, formatted in the UI locale. */
export function formatViolationDate(violationDate: Date, display: ViolationDisplayContext): string {
	return formatPlainDate(violationLocalDate(violationDate, display.timezone), display.locale, "dateMedium");
}

/** The organization-local violation day as ISO `YYYY-MM-DD` for exports. */
export function formatViolationCsvDate(violationDate: Date, timezone: string): string {
	return violationLocalDate(violationDate, timezone).toString();
}

/** An instant as organization-local `YYYY-MM-DD HH:mm` for exports. */
export function formatCsvLocalMinute(value: Date, timezone: string): string {
	const { date, time } = getInstantLocalMinuteFields(instantFromDate(value), timezone);
	return `${date} ${time}`;
}

type EmployeeRecord =
	| {
			firstName?: string | null;
			lastName?: string | null;
			user?: {
				firstName?: string | null;
				lastName?: string | null;
				name?: string | null;
				email?: string | null;
			} | null;
	  }
	| null
	| undefined;

type Translate = (key: string, fallback: string) => string;

export const violationTypeColors: Record<string, "destructive" | "secondary" | "outline"> = {
	max_daily: "destructive",
	max_weekly: "destructive",
	max_uninterrupted: "secondary",
	break_required: "outline",
	schedule_deviation: "outline",
	// JArbSchG youth protection (#1993): hard limits, then work a sector exception may allow.
	jarbschg_daily_max: "destructive",
	jarbschg_weekly_max: "destructive",
	jarbschg_days_per_week: "destructive",
	jarbschg_rest_period: "destructive",
	jarbschg_uninterrupted: "secondary",
	jarbschg_break: "outline",
	jarbschg_night_work: "secondary",
	jarbschg_saturday_work: "secondary",
	jarbschg_sunday_work: "secondary",
	jarbschg_holiday_work: "secondary",
};

export function formatEmployeeName(employeeRecord: EmployeeRecord, fallback: string) {
	return employeeRecord
		? buildAuthUserDisplayName({
				firstName: employeeRecord.user?.firstName,
				lastName: employeeRecord.user?.lastName,
				name: employeeRecord.user?.name,
				email: employeeRecord.user?.email,
			}) || fallback
		: fallback;
}

export function getViolationTypeLabel(type: string, t: Translate): string {
	switch (type) {
		case "max_daily":
			return t("settings.workPolicies.violationType.maxDaily", "Max Daily Exceeded");
		case "max_weekly":
			return t("settings.workPolicies.violationType.maxWeekly", "Max Weekly Exceeded");
		case "max_uninterrupted":
			return t("settings.workPolicies.violationType.maxUninterrupted", "Max Continuous Exceeded");
		case "break_required":
			return t("settings.workPolicies.violationType.breakRequired", "Required Break Missing");
		case "schedule_deviation":
			return t("settings.workPolicies.violationType.scheduleDeviation", "Schedule Deviation");
		case "jarbschg_daily_max":
			return t("settings.workPolicies.violationType.jarbschgDailyMax", "Youth Max Daily Exceeded");
		case "jarbschg_weekly_max":
			return t("settings.workPolicies.violationType.jarbschgWeeklyMax", "Youth Max Weekly Exceeded");
		case "jarbschg_days_per_week":
			return t(
				"settings.workPolicies.violationType.jarbschgDaysPerWeek",
				"Youth Working Days Exceeded",
			);
		case "jarbschg_rest_period":
			return t(
				"settings.workPolicies.violationType.jarbschgRestPeriod",
				"Youth Rest Period Too Short",
			);
		case "jarbschg_uninterrupted":
			return t(
				"settings.workPolicies.violationType.jarbschgUninterrupted",
				"Youth Max Continuous Exceeded",
			);
		case "jarbschg_break":
			return t("settings.workPolicies.violationType.jarbschgBreak", "Youth Required Break Missing");
		case "jarbschg_night_work":
			return t("settings.workPolicies.violationType.jarbschgNightWork", "Youth Night Work");
		case "jarbschg_saturday_work":
			return t("settings.workPolicies.violationType.jarbschgSaturdayWork", "Youth Saturday Work");
		case "jarbschg_sunday_work":
			return t("settings.workPolicies.violationType.jarbschgSundayWork", "Youth Sunday Work");
		case "jarbschg_holiday_work":
			return t("settings.workPolicies.violationType.jarbschgHolidayWork", "Youth Holiday Work");
		default:
			return type;
	}
}

export function buildCsvContent(headers: string[], rows: Array<Array<string | number>>) {
	return [headers, ...rows]
		.map((row) =>
			row
				.map((cell) => {
					const value = String(cell);
					return value.includes(",") || value.includes('"') || value.includes("\n")
						? `"${value.replace(/"/g, '""')}"`
						: value;
				})
				.join(","),
		)
		.join("\n");
}
