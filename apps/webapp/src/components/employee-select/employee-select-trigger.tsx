"use client";

import { IconChevronDown, IconUsers, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { EmployeeSelectTriggerProps, SelectableEmployee } from "./types";

/**
 * Get display name for an employee
 */
function getEmployeeName(employee: SelectableEmployee): string {
	if (employee.firstName || employee.lastName) {
		return `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
	}
	return employee.user.name || employee.user.email.split("@")[0];
}

/**
 * Trigger button that displays current selection and opens the modal
 */
export function EmployeeSelectTrigger({
	mode,
	selectedEmployees,
	placeholder,
	disabled = false,
	error,
	className,
	onClick,
}: EmployeeSelectTriggerProps) {
	const { t } = useTranslate();

	const defaultPlaceholder =
		mode === "single"
			? t("employeeSelect.selectEmployee", "Select employee")
			: t("employeeSelect.selectEmployees", "Select employees");

	const displayPlaceholder = placeholder || defaultPlaceholder;

	// Single selection display
	if (mode === "single") {
		const employee = selectedEmployees[0];

		return (
			<Button
				type="button"
				variant="outline"
				role="combobox"
				disabled={disabled}
				onClick={onClick}
				className={cn(
					"w-full justify-between font-normal",
					!employee && "text-muted-foreground",
					error && "border-destructive focus-visible:ring-destructive",
					className,
				)}
			>
				{employee ? (
					<div className="flex items-center gap-2 truncate">
						<UserAvatar
							seed={employee.userId}
							image={employee.user.image}
							name={getEmployeeName(employee)}
							size="xs"
						/>
						<span className="truncate">{getEmployeeName(employee)}</span>
					</div>
				) : (
					<span>{displayPlaceholder}</span>
				)}
				<IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
			</Button>
		);
	}

	// Multiple selection display
	const count = selectedEmployees.length;

	if (count === 0) {
		return (
			<Button
				type="button"
				variant="outline"
				role="combobox"
				disabled={disabled}
				onClick={onClick}
				className={cn(
					"w-full justify-between font-normal text-muted-foreground",
					error && "border-destructive focus-visible:ring-destructive",
					className,
				)}
			>
				<div className="flex items-center gap-2">
					<IconUsers className="h-4 w-4" />
					<span>{displayPlaceholder}</span>
				</div>
				<IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
			</Button>
		);
	}

	// Show up to 3 avatars + count
	const displayedEmployees = selectedEmployees.slice(0, 3);
	const remaining = count - 3;

	return (
		<Button
			type="button"
			variant="outline"
			role="combobox"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"w-full justify-between font-normal min-h-[40px] h-auto py-1.5",
				error && "border-destructive focus-visible:ring-destructive",
				className,
			)}
		>
			<div className="flex items-center gap-2 flex-wrap">
				{/* Stacked avatars */}
				<div className="flex -space-x-2">
					{displayedEmployees.map((employee) => (
						<UserAvatar
							key={employee.id}
							seed={employee.userId}
							image={employee.user.image}
							name={getEmployeeName(employee)}
							size="xs"
							bordered
						/>
					))}
				</div>

				{/* Count text */}
				<span className="text-sm">
					{count === 1
						? getEmployeeName(selectedEmployees[0])
						: remaining > 0
							? t("employeeSelect.countWithMore", "{count} employees (+{more} more)", {
									count: displayedEmployees.length,
									more: remaining,
								})
							: t("employeeSelect.countSelected", "{count} employees selected", { count })}
				</span>
			</div>
			<IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
		</Button>
	);
}

/**
 * Compact display of selected employees for forms
 * Shows as chips/badges that can be removed
 */
interface EmployeeChipsProps {
	employees: SelectableEmployee[];
	onRemove: (employeeId: string) => void;
	disabled?: boolean;
	maxDisplay?: number;
}

export function EmployeeChips({
	employees,
	onRemove,
	disabled = false,
	maxDisplay = 5,
}: EmployeeChipsProps) {
	const { t } = useTranslate();

	if (employees.length === 0) return null;

	const displayed = employees.slice(0, maxDisplay);
	const remaining = employees.length - maxDisplay;

	return (
		<div className="flex flex-wrap gap-1.5 mt-2">
			{displayed.map((employee) => (
				<div
					key={employee.id}
					className={cn(
						"inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-sm",
						disabled && "opacity-50",
					)}
				>
					<UserAvatar
						seed={employee.userId}
						image={employee.user.image}
						name={getEmployeeName(employee)}
						size="xs"
					/>
					<span className="truncate max-w-[120px]">{getEmployeeName(employee)}</span>
					{!disabled && (
						<button
							type="button"
							onClick={() => onRemove(employee.id)}
							className="ml-1 rounded-full p-0.5 hover:bg-muted transition-colors"
							aria-label={t("common.remove", "Remove")}
						>
							<IconX className="h-3 w-3" />
						</button>
					)}
				</div>
			))}
			{remaining > 0 && (
				<div className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-sm text-muted-foreground">
					+{remaining} {t("common.more", "more")}
				</div>
			)}
		</div>
	);
}
