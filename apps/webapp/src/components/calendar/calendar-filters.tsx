"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CalendarFilters } from "@/hooks/use-calendar-data";

interface CalendarFiltersProps {
	filters: CalendarFilters;
	onFiltersChange: (filters: CalendarFilters) => void;
	currentEmployeeId?: string;
	idPrefix?: string;
}

export function CalendarFiltersComponent({
	filters,
	onFiltersChange,
	idPrefix,
}: CalendarFiltersProps) {
	const { t } = useTranslate();
	const getSwitchId = (id: string) => (idPrefix ? `${idPrefix}-${id}` : id);
	const holidaysId = getSwitchId("show-holidays");
	const absencesId = getSwitchId("show-absences");
	const timeEntriesId = getSwitchId("show-time-entries");
	const workPeriodsId = getSwitchId("show-work-periods");

	const handleToggle = (key: keyof CalendarFilters) => {
		onFiltersChange({
			...filters,
			[key]: !filters[key],
		});
	};

	return (
		<Card className="gap-0 overflow-hidden py-0">
			<CardHeader className="bg-muted/45 px-4 py-3 dark:bg-muted/25">
				<CardTitle className="text-sm">{t("calendar.filters.title", "Filters")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 px-4 py-3">
				<div className="flex items-center justify-between">
					<Label htmlFor={holidaysId} className="text-sm">
						{t("calendar.filter.holidays", "Holidays")}
					</Label>
					<Switch
						id={holidaysId}
						checked={filters.showHolidays}
						onCheckedChange={() => handleToggle("showHolidays")}
					/>
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor={absencesId} className="text-sm">
						{t("calendar.filter.absences", "Absences")}
					</Label>
					<Switch
						id={absencesId}
						checked={filters.showAbsences}
						onCheckedChange={() => handleToggle("showAbsences")}
					/>
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor={timeEntriesId} className="text-sm">
						{t("calendar.filter.timeEntries", "Time Entries")}
					</Label>
					<Switch
						id={timeEntriesId}
						checked={filters.showTimeEntries}
						onCheckedChange={() => handleToggle("showTimeEntries")}
					/>
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor={workPeriodsId} className="text-sm">
						{t("calendar.filter.workPeriods", "Work Periods")}
					</Label>
					<Switch
						id={workPeriodsId}
						checked={filters.showWorkPeriods}
						onCheckedChange={() => handleToggle("showWorkPeriods")}
					/>
				</div>
			</CardContent>
		</Card>
	);
}
