import type { useTranslate } from "@tolgee/react";
import type { StatutoryFindingSummary } from "@/lib/statutory/finding";
import type { OnCallReferenceExclusionReason } from "@/lib/statutory/on-call/reference-period";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Minutes as hours and minutes, e.g. `3:30 h`. */
export function formatOnCallMinutes(minutes: number): string {
	const sign = minutes < 0 ? "-" : "";
	const absolute = Math.abs(Math.round(minutes));
	return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")} h`;
}

function value(summary: StatutoryFindingSummary, part: "used" | "limit"): number {
	return summary[part]?.value ?? 0;
}

/** Wage-free text of an on-call finding (§ 12 TzBfG) for Employee Detail, Reviews and profiles. */
export function onCallFindingText(
	finding: { readonly kind: string; readonly summary: StatutoryFindingSummary },
	t: Translate,
): string {
	const { summary } = finding;
	switch (finding.kind) {
		case "on_call_short_notice":
			return t(
				"common.onCall.finding.shortNotice",
				"Called in with {days, plural, one {# full day} other {# full days}} notice; {required} are required",
				{ days: value(summary, "used"), required: value(summary, "limit") },
			);
		case "on_call_short_call":
			return t(
				"common.onCall.finding.shortCall",
				"Shift of {duration} is shorter than the minimum call of {minimum}",
				{
					duration: formatOnCallMinutes(value(summary, "used")),
					minimum: formatOnCallMinutes(value(summary, "limit")),
				},
			);
		case "on_call_short_work_call":
			return t(
				"common.onCall.finding.shortWorkCall",
				"Worked {duration} on the day, less than the minimum call of {minimum}",
				{
					duration: formatOnCallMinutes(value(summary, "used")),
					minimum: formatOnCallMinutes(value(summary, "limit")),
				},
			);
		case "on_call_weekly_over_band":
			return t(
				"common.onCall.finding.overBand",
				"Week called for {used}, above the call-off band of {limit}",
				{
					used: formatOnCallMinutes(value(summary, "used")),
					limit: formatOnCallMinutes(value(summary, "limit")),
				},
			);
		case "on_call_weekly_under_band":
			return t(
				"common.onCall.finding.underBand",
				"Week called for {used}, below the call-off band of {limit}",
				{
					used: formatOnCallMinutes(value(summary, "used")),
					limit: formatOnCallMinutes(value(summary, "limit")),
				},
			);
		default:
			return t("common.onCall.finding.other", "On-call rule at risk");
	}
}

export function onCallExclusionText(reason: OnCallReferenceExclusionReason, t: Translate): string {
	switch (reason) {
		case "not_employed":
			return t("common.onCall.reference.excluded.notEmployed", "Not employed");
		case "unpaid_absence":
			return t("common.onCall.reference.excluded.unpaidAbsence", "Unpaid absence");
		case "paid_absence":
			return t("common.onCall.reference.excluded.paidAbsence", "Leave or sickness");
		case "public_holiday":
			return t("common.onCall.reference.excluded.publicHoliday", "Public holiday");
	}
}

export function onCallHoursKindText(
	kind: "exact" | "minimum" | "maximum" | "unspecified",
	t: Translate,
): string {
	switch (kind) {
		case "exact":
			return t("common.onCall.hoursKind.exact", "Exactly agreed weekly hours");
		case "minimum":
			return t("common.onCall.hoursKind.minimum", "Minimum weekly hours (up to +25 %)");
		case "maximum":
			return t("common.onCall.hoursKind.maximum", "Maximum weekly hours (down to −20 %)");
		case "unspecified":
			return t("common.onCall.hoursKind.unspecified", "No weekly hours agreed (20 h apply)");
	}
}
