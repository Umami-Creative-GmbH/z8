"use client";

import { useCallback } from "react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CalendarFilters } from "@/hooks/use-calendar-data";

interface CalendarFiltersProps {
	filters: CalendarFilters;
	onFiltersChange: (filters: CalendarFilters) => void;
	currentEmployeeId?: string;
}

export function CalendarFiltersComponent({ filters, onFiltersChange }: CalendarFiltersProps) {
	const { t } = useTranslate();

	const handleToggle = useCallback(
		(key: keyof CalendarFilters) => {
			onFiltersChange({
				...filters,
				[key]: !filters[key],
			});
		},
		[filters, onFiltersChange],
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{t("calendar.filters.title", "Filters")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between">
					<Label htmlFor="show-holidays" className="text-sm">
						{t("calendar.filter.holidays", "Holidays")}
					</Label>
					<Switch
						id="show-holidays"
						checked={filters.showHolidays}
						onCheckedChange={() => handleToggle("showHolidays")}
					/>
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor="show-absences" className="text-sm">
						{t("calendar.filter.absences", "Absences")}
					</Label>
					<Switch
						id="show-absences"
						checked={filters.showAbsences}
						onCheckedChange={() => handleToggle("showAbsences")}
					/>
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor="show-time-entries" className="text-sm">
						{t("calendar.filter.timeEntries", "Time Entries")}
					</Label>
					<Switch
						id="show-time-entries"
						checked={filters.showTimeEntries}
						onCheckedChange={() => handleToggle("showTimeEntries")}
					/>
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor="show-work-periods" className="text-sm">
						{t("calendar.filter.workPeriods", "Work Periods")}
					</Label>
					<Switch
						id="show-work-periods"
						checked={filters.showWorkPeriods}
						onCheckedChange={() => handleToggle("showWorkPeriods")}
					/>
				</div>
			</CardContent>
		</Card>
	);
}
