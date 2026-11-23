"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { OnCallReferenceBreakdown } from "@/lib/statutory/on-call/reference-period";
import { formatOnCallMinutes, onCallExclusionText } from "./on-call-text";

/**
 * The auditable § 12 Abs. 4–5 TzBfG reference-period breakdown: numerator, denominator days,
 * averages and every excluded period. Read-only figures in minutes; no wages.
 */
export function OnCallReferenceBreakdownView({
	breakdown,
}: {
	readonly breakdown: OnCallReferenceBreakdown;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const day = (value: string) => formatPlainDate(parsePlainDate(value), locale, "dateMedium");
	const lastDay = parsePlainDate(breakdown.referenceEndExclusive).subtract({ days: 1 }).toString();
	const average = (minutes: number | null) =>
		minutes === null ? t("common.onCall.reference.none", "—") : formatOnCallMinutes(minutes);

	return (
		<div className="space-y-3 text-sm">
			<p className="text-muted-foreground">
				{breakdown.method === "three_months"
					? t(
							"common.onCall.reference.periodThreeMonths",
							"Reference period (3 months): {from} – {until}",
							{ from: day(breakdown.referenceStart), until: day(lastDay) },
						)
					: t(
							"common.onCall.reference.periodThirteenWeeks",
							"Reference period (13 weeks): {from} – {until}",
							{ from: day(breakdown.referenceStart), until: day(lastDay) },
						)}
			</p>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
				<div>
					<dt className="text-muted-foreground">
						{t("common.onCall.reference.numerator", "Worked time")}
					</dt>
					<dd className="font-medium tabular-nums">
						{formatOnCallMinutes(breakdown.numeratorMinutes)}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("common.onCall.reference.denominator", "Counted days")}
					</dt>
					<dd className="font-medium tabular-nums">
						{t("common.onCall.reference.denominatorValue", "{counted} of {total} days", {
							counted: breakdown.denominatorDays,
							total: breakdown.calendarDays,
						})}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("common.onCall.reference.workedDays", "Days worked")}
					</dt>
					<dd className="font-medium tabular-nums">{breakdown.workedDays}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("common.onCall.reference.perDay", "Average per day")}
					</dt>
					<dd className="font-medium tabular-nums">{average(breakdown.averageMinutesPerDay)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("common.onCall.reference.perWeek", "Average per week")}
					</dt>
					<dd className="font-medium tabular-nums">{average(breakdown.averageMinutesPerWeek)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("common.onCall.reference.perWorkedDay", "Average per day worked")}
					</dt>
					<dd className="font-medium tabular-nums">
						{average(breakdown.averageMinutesPerWorkedDay)}
					</dd>
				</div>
			</dl>
			{breakdown.excludedPeriods.length > 0 ? (
				<div>
					<p className="text-muted-foreground">
						{t("common.onCall.reference.excludedTitle", "Left out of the average")}
					</p>
					<ul className="mt-1 space-y-0.5">
						{breakdown.excludedPeriods.map((period) => (
							<li key={`${period.from}-${period.reason}`} className="tabular-nums">
								{t(
									"common.onCall.reference.excludedPeriod",
									"{from} – {until}: {reason} ({days, plural, one {# day} other {# days}})",
									{
										from: day(period.from),
										until: day(
											parsePlainDate(period.untilExclusive).subtract({ days: 1 }).toString(),
										),
										reason: onCallExclusionText(period.reason, t),
										days: period.days,
									},
								)}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{breakdown.employmentShortened ? (
				<p className="text-muted-foreground">
					{t(
						"common.onCall.reference.shortened",
						"Employment began during the reference period, so the shorter period counts.",
					)}
				</p>
			) : null}
		</div>
	);
}
