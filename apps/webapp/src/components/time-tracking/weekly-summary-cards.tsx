"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";

interface Props {
	summary: TimeSummary;
}

interface SummaryCardProps {
	label: string;
	baseWorkedLabel: string;
	surchargeLabel: string;
	baseMinutes: number;
	surchargeMinutes?: number;
}

function SummaryCard({
	label,
	baseWorkedLabel,
	surchargeLabel,
	baseMinutes,
	surchargeMinutes,
}: SummaryCardProps) {
	const hasSurcharge = surchargeMinutes && surchargeMinutes > 0;
	const totalCredited = hasSurcharge ? baseMinutes + surchargeMinutes : baseMinutes;

	return (
		<Card>
			<CardHeader className={hasSurcharge ? "pb-2" : undefined}>
				<CardDescription>{label}</CardDescription>
				<CardTitle className="tabular-nums text-2xl">{formatDuration(totalCredited)}</CardTitle>
			</CardHeader>
			{hasSurcharge && (
				<CardContent className="pt-0">
					<div className="text-xs space-y-0.5">
						<div className="flex justify-between text-muted-foreground">
							<span>{baseWorkedLabel}</span>
							<span className="tabular-nums">{formatDuration(baseMinutes)}</span>
						</div>
						<div className="flex justify-between text-emerald-600 dark:text-emerald-400">
							<span>{surchargeLabel}</span>
							<span className="tabular-nums">+{formatDuration(surchargeMinutes)}</span>
						</div>
					</div>
				</CardContent>
			)}
		</Card>
	);
}

export function WeeklySummaryCards({ summary }: Props) {
	const { t } = useTranslate();

	const baseWorkedLabel = t("timeTracking.summary.baseWorked", "Base worked");
	const surchargeLabel = t("timeTracking.summary.surcharge", "Surcharge");

	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-3">
			{/* Today */}
			<SummaryCard
				label={t("timeTracking.summary.today", "Today")}
				baseWorkedLabel={baseWorkedLabel}
				surchargeLabel={surchargeLabel}
				baseMinutes={summary.todayMinutes}
				surchargeMinutes={summary.todaySurchargeMinutes}
			/>

			{/* This Week */}
			<SummaryCard
				label={t("timeTracking.summary.thisWeek", "This Week")}
				baseWorkedLabel={baseWorkedLabel}
				surchargeLabel={surchargeLabel}
				baseMinutes={summary.weekMinutes}
				surchargeMinutes={summary.weekSurchargeMinutes}
			/>

			{/* This Month */}
			<SummaryCard
				label={t("timeTracking.summary.thisMonth", "This Month")}
				baseWorkedLabel={baseWorkedLabel}
				surchargeLabel={surchargeLabel}
				baseMinutes={summary.monthMinutes}
				surchargeMinutes={summary.monthSurchargeMinutes}
			/>
		</div>
	);
}
