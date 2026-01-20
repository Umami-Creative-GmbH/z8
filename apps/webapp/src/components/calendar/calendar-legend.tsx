"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CalendarLegend() {
	const { t } = useTranslate();

	const legendItems = [
		{
			color: "#f59e0b",
			label: t("calendar.legend.holiday", "Holiday"),
		},
		{
			color: "#3b82f6",
			label: t("calendar.legend.absence", "Absence"),
		},
		{
			color: "#10b981",
			label: t("calendar.legend.workPeriod", "Work Period"),
		},
		{
			color: "#10b981",
			label: t("calendar.legend.workPeriodPending", "Pending Approval"),
			isPending: true,
		},
		{
			color: "#8b5cf6",
			label: t("calendar.legend.timeEntry", "Time Entry"),
		},
	];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{t("calendar.legend.title", "Legend")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				{legendItems.map((item) => (
					<div key={item.label} className="flex items-center gap-2">
						<div
							className={`h-3 w-3 rounded-full ${item.isPending ? "opacity-60 border border-dashed" : ""}`}
							style={{
								backgroundColor: item.color,
								borderColor: item.isPending ? item.color : undefined,
							}}
						/>
						<span className="text-sm text-muted-foreground">{item.label}</span>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
