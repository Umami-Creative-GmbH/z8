"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";

interface Props {
	summary: TimeSummary;
}

interface SummaryCardProps {
	label: string;
	baseMinutes: number;
	surchargeMinutes?: number;
}

function SummaryCard({ label, baseMinutes, surchargeMinutes }: SummaryCardProps) {
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
							<span>Base worked</span>
							<span className="tabular-nums">{formatDuration(baseMinutes)}</span>
						</div>
						<div className="flex justify-between text-emerald-600 dark:text-emerald-400">
							<span>Surcharge</span>
							<span className="tabular-nums">+{formatDuration(surchargeMinutes)}</span>
						</div>
					</div>
				</CardContent>
			)}
		</Card>
	);
}

export function WeeklySummaryCards({ summary }: Props) {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-3">
			{/* Today */}
			<SummaryCard
				label="Today"
				baseMinutes={summary.todayMinutes}
				surchargeMinutes={summary.todaySurchargeMinutes}
			/>

			{/* This Week */}
			<SummaryCard
				label="This Week"
				baseMinutes={summary.weekMinutes}
				surchargeMinutes={summary.weekSurchargeMinutes}
			/>

			{/* This Month */}
			<SummaryCard
				label="This Month"
				baseMinutes={summary.monthMinutes}
				surchargeMinutes={summary.monthSurchargeMinutes}
			/>
		</div>
	);
}
