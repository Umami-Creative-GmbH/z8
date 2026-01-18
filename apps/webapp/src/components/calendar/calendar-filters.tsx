"use client";

import { useCallback } from "react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CalendarFilters } from "@/hooks/use-calendar-data";

interface CalendarFiltersProps {
	filters: CalendarFilters;
	onFiltersChange: (filters: CalendarFilters) => void;
	currentEmployeeId?: string; // Optional: current user's employee ID
}

export function CalendarFiltersComponent({
	filters,
	onFiltersChange,
	currentEmployeeId,
}: CalendarFiltersProps) {
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

	const handleEmployeeFilterChange = useCallback(
		(value: string) => {
			onFiltersChange({
				...filters,
				employeeId: value === "all" ? undefined : value,
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

				{/* Employee filter - show when absences, time entries, or work periods are enabled */}
				{(filters.showAbsences || filters.showTimeEntries || filters.showWorkPeriods) &&
					currentEmployeeId && (
						<div className="space-y-2 pl-4 border-l-2 border-muted">
							<Label htmlFor="employee-filter" className="text-xs text-muted-foreground">
								{t("calendar.filter.employee", "Filter by employee")}
							</Label>
							<Select
								value={filters.employeeId || "all"}
								onValueChange={handleEmployeeFilterChange}
							>
								<SelectTrigger id="employee-filter" className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">
										{t("calendar.filter.allEmployees", "All Employees")}
									</SelectItem>
									<SelectItem value={currentEmployeeId}>
										{t("calendar.filter.myDataOnly", "My Data Only")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

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
