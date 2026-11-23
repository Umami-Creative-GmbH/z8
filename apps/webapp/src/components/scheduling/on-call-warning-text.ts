import type { useTranslate } from "@tolgee/react";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

type Translate = ReturnType<typeof useTranslate>["t"];

function hours(minutes: number | undefined): string {
	const absolute = Math.max(0, Math.round(minutes ?? 0));
	return `${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")} h`;
}

/**
 * Planner text for § 12 TzBfG on-call findings (#1992) in Scheduling and Staffing; null for any
 * other finding. Minutes and days only.
 */
export function onCallWarningText(
	finding: StatutoryComplianceFinding,
	t: Translate,
): string | null {
	const used = finding.summary.used?.value;
	const limit = finding.summary.limit?.value;
	switch (finding.statutoryKind) {
		case "on_call_short_notice":
			return t(
				"scheduling:scheduling.statutory.onCall.shortNotice",
				"On-call: {days, plural, one {# full day} other {# full days}} notice, {required} required (§ 12 Abs. 3 TzBfG)",
				{ days: used ?? 0, required: limit ?? 0 },
			);
		case "on_call_short_call":
			return t(
				"scheduling:scheduling.statutory.onCall.shortCall",
				"On-call: call of {duration} is below the minimum of {minimum}",
				{ duration: hours(used), minimum: hours(limit) },
			);
		case "on_call_short_work_call":
			return t(
				"scheduling:scheduling.statutory.onCall.shortWorkCall",
				"On-call: worked {duration}, below the minimum call of {minimum}",
				{ duration: hours(used), minimum: hours(limit) },
			);
		case "on_call_weekly_over_band":
			return t(
				"scheduling:scheduling.statutory.onCall.overBand",
				"On-call: week at {used}, above the call-off band of {limit}",
				{ used: hours(used), limit: hours(limit) },
			);
		case "on_call_weekly_under_band":
			return t(
				"scheduling:scheduling.statutory.onCall.underBand",
				"On-call: week at {used}, below the call-off band of {limit}",
				{ used: hours(used), limit: hours(limit) },
			);
		default:
			return null;
	}
}
