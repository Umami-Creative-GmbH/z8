"use client";

import { IconCheck } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserAvatar } from "@/components/user-avatar";
import { formatEmployeeIdentityName } from "@/lib/employee-identity";
import { cn } from "@/lib/utils";
import type { EmployeeSelectItemProps } from "./types";

const roleColors = {
	admin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
	manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
	employee: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
} as const;

const roleLabels = {
	admin: "Admin",
	manager: "Manager",
	employee: "Employee",
} as const;

/**
 * Single employee row in the selection list
 */
export function EmployeeSelectItem({
	employee,
	isSelected,
	mode,
	onClick,
	disabled = false,
}: EmployeeSelectItemProps) {
	const displayName = formatEmployeeIdentityName(employee);
	const isInactive = !employee.isActive;

	return (
		<div
			role="option"
			aria-selected={isSelected}
			aria-disabled={disabled}
			tabIndex={disabled ? -1 : 0}
			onClick={disabled ? undefined : onClick}
			onKeyDown={(e) => {
				if (!disabled && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					onClick();
				}
			}}
			className={cn(
				"flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer select-none",
				"transition-colors duration-100",
				"hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				isSelected && "bg-primary/10 text-primary",
				disabled && "opacity-50 cursor-not-allowed",
				isInactive && "opacity-60",
			)}
		>
			{/* Selection indicator */}
			{mode === "multiple" ? (
				<Checkbox
					checked={isSelected}
					disabled={disabled}
					className="pointer-events-none shrink-0"
					aria-hidden="true"
				/>
			) : (
				<div className="w-4 h-4 flex items-center justify-center shrink-0">
					{isSelected && <IconCheck className="h-4 w-4 text-primary" />}
				</div>
			)}

			{/* Avatar */}
			<UserAvatar seed={employee.userId} image={employee.user.image} name={displayName} size="sm" />

			{/* Employee info */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{displayName}</span>
					{isInactive && (
						<Badge variant="secondary" className="text-xs shrink-0">
							Inactive
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<span className="truncate">{employee.user.email}</span>
					{employee.position && (
						<>
							<span className="text-muted-foreground/50">·</span>
							<span className="truncate">{employee.position}</span>
						</>
					)}
				</div>
			</div>

			{/* Role badge */}
			<Badge
				variant="outline"
				className={cn("shrink-0 text-xs border-0", roleColors[employee.role])}
			>
				{roleLabels[employee.role]}
			</Badge>
		</div>
	);
}
