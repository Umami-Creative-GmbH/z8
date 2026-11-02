"use client";

import {
	IconCalendarMonth,
	IconCalendarWeek,
	IconClockHour4,
	IconScale,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { KpiCard, type KpiTone, type KpiTrend } from "@/components/ui/kpi-card";
import { BalanceAdjustmentHistoryButton } from "@/components/work-balance/balance-adjustment-history-button";
import { useLiveWorkNow } from "@/hooks/use-live-work-now";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type PeriodKpi,
	summarizeTimeKpis,
	type TimeKpiDay,
	type TimeKpiRead,
	type TimeKpiTone,
} from "@/lib/time-tracking/time-kpis";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { KpiDayBars } from "./kpi-day-bars";

interface Props {
	kpis: TimeKpiRead;
	workBalance: EmployeeWorkBalancePayload | null;
}

const CARD_TONE: Record<TimeKpiTone, KpiTone> = {
	progress: "info",
	met: "success",
	near_limit: "warning",
	over_limit: "critical",
};

type Translate = ReturnType<typeof useTranslate>["t"];

/** The change from the previous period up to the same point; the arrow carries no judgement. */
function periodTrend(period: PeriodKpi, comparedWith: string, t: Translate): KpiTrend {
	const difference = period.workedMinutes - period.previous.workedMinutes;
	const duration = formatDuration(Math.abs(difference));
	const previous = period.previous.workedMinutes;
	const percent = previous > 0 ? Math.round((difference / previous) * 100) : null;
	const label =
		percent === null
			? t("timeTracking.summary.trend", "{difference} {comparedWith}", {
					difference: duration,
					comparedWith,
				})
			: t("timeTracking.summary.trendWithPercent", "{difference} ({percent}) {comparedWith}", {
					difference: duration,
					percent: `${percent > 0 ? "+" : percent < 0 ? "−" : "±"}${Math.abs(percent)}%`,
					comparedWith,
				});
	return {
		direction: difference > 0 ? "up" : difference < 0 ? "down" : "flat",
		label,
		detail: t(
			"timeTracking.summary.trendDetail",
			"Now: {worked} worked of {required} required so far. Then: {previousWorked} worked of {previousRequired} required.",
			{
				worked: formatDuration(period.workedMinutes),
				required: formatDuration(period.requiredSoFarMinutes ?? 0),
				previousWorked: formatDuration(period.previous.workedMinutes),
				previousRequired: formatDuration(period.previous.requiredMinutes),
			},
		),
	};
}

/** "26h of 40h · 2h ahead": the bar's figures and how far ahead or behind required time so far. */
function periodCaption(period: PeriodKpi, t: Translate) {
	if (period.requiredMinutes === null || period.requiredSoFarMinutes === null) return null;
	const worked = formatDuration(period.workedMinutes);
	const required = formatDuration(period.requiredMinutes);
	const difference = period.workedMinutes - period.requiredSoFarMinutes;
	if (difference === 0) {
		return t("timeTracking.summary.progressOnTrack", "{worked} of {required} · on track", {
			worked,
			required,
		});
	}
	return difference > 0
		? t("timeTracking.summary.progressAhead", "{worked} of {required} · {difference} ahead", {
				worked,
				required,
				difference: formatDuration(difference),
			})
		: t("timeTracking.summary.progressBehind", "{worked} of {required} · {difference} behind", {
				worked,
				required,
				difference: formatDuration(-difference),
			});
}

function surchargeFootnote(surchargeMinutes: number, t: Translate) {
	return surchargeMinutes > 0
		? t("timeTracking.summary.surchargeFootnote", "+{surcharge} surcharge", {
				surcharge: formatDuration(surchargeMinutes),
			})
		: null;
}

export function WeeklySummaryCards({ kpis: { kpis: serverKpis, basis }, workBalance }: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	const liveWorkNow = useLiveWorkNow(basis.liveWork);
	// The KPIs count live work as it runs, advancing on each elapsed minute.
	const kpis = liveWorkNow ? summarizeTimeKpis(basis, liveWorkNow) : serverKpis;
	const { today, week, month } = kpis;

	const describeDay = (day: TimeKpiDay) => {
		const date = parsePlainDate(day.date).toLocaleString(locale, {
			weekday: "short",
			day: "numeric",
			month: "short",
		});
		return day.requiredMinutes > 0
			? t("timeTracking.summary.dayOfRequired", "{date}: {worked} of {required}", {
					date,
					worked: formatDuration(day.workedMinutes),
					required: formatDuration(day.requiredMinutes),
				})
			: t("timeTracking.summary.dayWorked", "{date}: {worked}", {
					date,
					worked: formatDuration(day.workedMinutes),
				});
	};
	const periodCard = (period: PeriodKpi, comparedWith: string) => ({
		value: formatDuration(period.workedMinutes),
		tone: CARD_TONE[period.tone],
		trend: periodTrend(period, comparedWith, t),
		progress:
			period.requiredMinutes === null
				? undefined
				: {
						value: period.workedMinutes,
						max: period.requiredMinutes,
						marker: period.requiredSoFarMinutes ?? undefined,
						label: t("timeTracking.summary.progressLabel", "Worked time of required time"),
					},
		caption: periodCaption(period, t),
		footnote: surchargeFootnote(period.surchargeMinutes, t),
		chart: <KpiDayBars days={period.days} today={today.date} describeDay={describeDay} />,
	});

	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
			<KpiCard
				label={t("timeTracking.summary.today", "Today")}
				icon={<IconClockHour4 />}
				value={formatDuration(today.workedMinutes)}
				tone={CARD_TONE[today.tone]}
				progress={
					today.requiredMinutes === null
						? undefined
						: {
								value: today.workedMinutes,
								max: today.requiredMinutes,
								label: t("timeTracking.summary.progressLabel", "Worked time of required time"),
							}
				}
				caption={
					today.requiredMinutes === null
						? t("timeTracking.summary.noRequiredToday", "No required time today")
						: t("timeTracking.summary.todayOfRequired", "{worked} of {required}", {
								worked: formatDuration(today.workedMinutes),
								required: formatDuration(today.requiredMinutes),
							})
				}
				footnote={surchargeFootnote(today.surchargeMinutes, t)}
			/>
			<KpiCard
				label={t("timeTracking.summary.thisWeek", "This Week")}
				icon={<IconCalendarWeek />}
				{...periodCard(week, t("timeTracking.summary.vsLastWeek", "vs last week"))}
			/>
			<KpiCard
				label={t("timeTracking.summary.thisMonth", "This Month")}
				icon={<IconCalendarMonth />}
				{...periodCard(month, t("timeTracking.summary.vsLastMonth", "vs last month"))}
			/>
			<KpiCard
				label={t("workBalance.label", "All-time balance")}
				icon={<IconScale />}
				value={
					workBalance
						? formatSignedWorkBalance(workBalance.balanceMinutes)
						: t("workBalance.notCalculated", "Not calculated yet")
				}
				footnote={
					workBalance?.computedAt
						? t("workBalance.updatedEveryThreeHours", "Updated every 3 hours")
						: t("workBalance.pendingDescription", "The worker will calculate this balance soon.")
				}
				action={
					workBalance ? (
						<BalanceAdjustmentHistoryButton employeeId={workBalance.employeeId} />
					) : null
				}
			/>
		</div>
	);
}
