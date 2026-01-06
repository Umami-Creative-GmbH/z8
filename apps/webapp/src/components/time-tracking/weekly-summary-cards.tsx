"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";

interface Props {
	summary: TimeSummary;
}

export function WeeklySummaryCards({ summary }: Props) {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-3">
			{/* Today */}
			<Card>
				<CardHeader>
					<CardDescription>Today</CardDescription>
					<CardTitle className="tabular-nums text-2xl">
						{formatDuration(summary.todayMinutes)}
					</CardTitle>
				</CardHeader>
			</Card>

			{/* This Week */}
			<Card>
				<CardHeader>
					<CardDescription>This Week</CardDescription>
					<CardTitle className="tabular-nums text-2xl">
						{formatDuration(summary.weekMinutes)}
					</CardTitle>
				</CardHeader>
			</Card>

			{/* This Month */}
			<Card>
				<CardHeader>
					<CardDescription>This Month</CardDescription>
					<CardTitle className="tabular-nums text-2xl">
						{formatDuration(summary.monthMinutes)}
					</CardTitle>
				</CardHeader>
			</Card>
		</div>
	);
}
