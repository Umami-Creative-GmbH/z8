"use client";

import { useTranslate } from "@tolgee/react";
import { EmployeeSingleSelect } from "@/components/employee-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarEmployees } from "@/hooks/use-calendar-employees";

interface CalendarEmployeeSelectorProps {
	/** Current user's employee ID */
	currentEmployeeId?: string;
	/** Currently selected employee ID */
	selectedEmployeeId: string | null;
	/** Callback when employee selection changes */
	onEmployeeChange: (employeeId: string | null) => void;
	/** Whether current user is manager or above (controls visibility) */
	isManagerOrAbove: boolean;
}

/**
 * Employee selector for the calendar view.
 *
 * Allows managers to view calendars of their team members.
 * Regular employees only see their own calendar (selector not shown).
 *
 * Features:
 * - Shows current user first in the list
 * - Lists all managed employees (via employeeManagers junction)
 * - Client-side search within pre-filtered list
 * - Cached via React Query (5-min stale time)
 */
export function CalendarEmployeeSelector({
	currentEmployeeId,
	selectedEmployeeId,
	onEmployeeChange,
	isManagerOrAbove,
}: CalendarEmployeeSelectorProps) {
	const { t } = useTranslate();
	const { employees, isLoading, error } = useCalendarEmployees(currentEmployeeId);

	// Don't render for regular employees
	if (!isManagerOrAbove) {
		return null;
	}

	// Loading state
	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	// Error state - show message but don't block the calendar
	if (error) {
		return (
			<div className="text-sm text-muted-foreground">
				{t("calendar.employeeSelector.error", "Unable to load team members")}
			</div>
		);
	}

	// If no managed employees (just current user), show read-only indicator
	if (employees.length <= 1) {
		return (
			<div className="text-sm text-muted-foreground">
				{t("calendar.employeeSelector.myCalendar", "My Calendar")}
			</div>
		);
	}

	return (
		<EmployeeSingleSelect
			value={selectedEmployeeId}
			onChange={onEmployeeChange}
			employees={employees}
			showFilters={false}
			label={t("calendar.employeeSelector.label", "View Calendar")}
			placeholder={t("calendar.employeeSelector.placeholder", "Select team member...")}
			className="w-full"
		/>
	);
}
