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

type FilterKey = Exclude<keyof CalendarFilters, "employeeId">;

/** The calendar's event colours; each switch shows the colour of what it toggles. */
const WORK_PERIOD_COLOR = "#10b981";
const FILTER_COLORS: Record<FilterKey, string> = {
	showHolidays: "#f59e0b",
	showAbsences: "#3b82f6",
	showTimeEntries: "#8b5cf6",
	showWorkPeriods: WORK_PERIOD_COLOR,
};

function ColorDot({ color, pending }: { color: string; pending?: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`size-3 shrink-0 rounded-full ${pending ? "border border-dashed opacity-60" : ""}`}
			style={{
				backgroundColor: color,
				borderColor: pending ? color : undefined,
			}}
		/>
	);
}

/** Filters and legend in one: a switch per entry kind, marked with that kind's colour. */
export function CalendarFiltersComponent({
	filters,
	onFiltersChange,
	idPrefix,
}: CalendarFiltersProps) {
	const { t } = useTranslate();
	const getSwitchId = (id: string) => (idPrefix ? `${idPrefix}-${id}` : id);

	const rows: { key: FilterKey; id: string; label: string }[] = [
		{
			key: "showHolidays",
			id: getSwitchId("show-holidays"),
			label: t("calendar.filter.holidays", "Holidays"),
		},
		{
			key: "showAbsences",
			id: getSwitchId("show-absences"),
			label: t("calendar.filter.absences", "Absences"),
		},
		{
			key: "showTimeEntries",
			id: getSwitchId("show-time-entries"),
			label: t("calendar.filter.timeEntries", "Time Entries"),
		},
		{
			key: "showWorkPeriods",
			id: getSwitchId("show-work-periods"),
			label: t("calendar.filter.workPeriods", "Work Periods"),
		},
	];

	const handleToggle = (key: FilterKey) => {
		onFiltersChange({
			...filters,
			[key]: !filters[key],
		});
	};

	return (
		<Card className="gap-0 overflow-hidden py-0" data-testid="calendar-filters">
			<CardHeader className="px-4 pt-4 pb-0">
				<CardTitle className="text-sm">
					{t("calendar.filters.title", "Filters")}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 px-4 py-4">
				{rows.map((row) => (
					<div key={row.key} className="flex items-center justify-between gap-3">
						<Label htmlFor={row.id} className="flex items-center gap-2 text-sm">
							<ColorDot color={FILTER_COLORS[row.key]} />
							{row.label}
						</Label>
						<Switch
							id={row.id}
							checked={Boolean(filters[row.key])}
							onCheckedChange={() => handleToggle(row.key)}
						/>
					</div>
				))}
				<p className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
					<ColorDot color={WORK_PERIOD_COLOR} pending />
					{t("calendar.legend.workPeriodPending", "Pending Approval")}
				</p>
			</CardContent>
		</Card>
	);
}
