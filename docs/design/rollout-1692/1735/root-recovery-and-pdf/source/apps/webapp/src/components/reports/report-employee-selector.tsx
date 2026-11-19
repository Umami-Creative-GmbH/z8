"use client";

import { useTranslate } from "@tolgee/react";
import { EmployeeSingleSelect } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReportEmployees } from "@/hooks/use-report-employees";

interface ReportEmployeeSelectorProps {
	/** Current user's employee ID */
	currentEmployeeId?: string;
	/** Currently selected employee ID */
	selectedEmployeeId: string | null;
	/** Callback when employee selection changes */
	onEmployeeChange: (employeeId: string | null) => void;
	/** Whether the selector is disabled */
	disabled?: boolean;
}

/**
 * Employee selector for the reports feature.
 *
 * Allows managers/admins to generate reports for their team members.
 * Regular employees only see their own reports (selector not shown).
 *
 * Features:
 * - Shows current user first in the list
 * - Managers see their managed employees (via employeeManagers junction)
 * - Admins see all employees in the organization
 * - Client-side search within pre-filtered list
 * - Cached via React Query (5-min stale time)
 */
export function ReportEmployeeSelector({
	currentEmployeeId,
	selectedEmployeeId,
	onEmployeeChange,
	disabled = false,
}: ReportEmployeeSelectorProps) {
	const { t } = useTranslate();
	const { employees, isLoading, isRefetching, error, canViewMultiple, refetch } =
		useReportEmployees(currentEmployeeId);

	// Loading state
	if (isLoading) {
		return (
			<div
				role="status"
				aria-label={t("reports.employeeSelector.loading", "Loading team members")}
				aria-busy="true"
				className="space-y-2"
			>
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	// Error state - show message but don't block the report generation
	if (error) {
		return (
			<div role="alert" className="space-y-2 text-sm text-muted-foreground">
				<p>{t("reports.employeeSelector.error", "Unable to load team members")}</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled || isRefetching}
					onClick={() => void refetch()}
				>
					{isRefetching ? t("common.retrying", "Retrying…") : t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}
	// A failed read is not the employee's one-person scope.
	if (!canViewMultiple) return null;

	return (
		<EmployeeSingleSelect
			value={selectedEmployeeId}
			onChange={onEmployeeChange}
			employees={employees}
			showFilters={false}
			placeholder={t("reports.employeeSelector.placeholder", "Select employee...")}
			disabled={disabled}
			className="space-y-0"
			label={t("reports.employeeSelector.label", "Employee")}
		/>
	);
}
