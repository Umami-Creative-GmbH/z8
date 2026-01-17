"use client";

import { IconCheck, IconShield, IconUser, IconUsers } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type Role = "admin" | "manager" | "employee";

interface RoleOption {
	value: Role;
	label: string;
	description: string;
	icon: typeof IconShield;
	color: {
		bg: string;
		bgSelected: string;
		border: string;
		text: string;
		icon: string;
	};
}

const roleOptions: RoleOption[] = [
	{
		value: "admin",
		label: "Admin",
		description: "Full system access",
		icon: IconShield,
		color: {
			bg: "bg-red-50 dark:bg-red-950/30",
			bgSelected: "bg-red-100 dark:bg-red-950/50",
			border: "border-red-500",
			text: "text-red-700 dark:text-red-400",
			icon: "text-red-500",
		},
	},
	{
		value: "manager",
		label: "Manager",
		description: "Team oversight",
		icon: IconUsers,
		color: {
			bg: "bg-blue-50 dark:bg-blue-950/30",
			bgSelected: "bg-blue-100 dark:bg-blue-950/50",
			border: "border-blue-500",
			text: "text-blue-700 dark:text-blue-400",
			icon: "text-blue-500",
		},
	},
	{
		value: "employee",
		label: "Employee",
		description: "Standard access",
		icon: IconUser,
		color: {
			bg: "bg-green-50 dark:bg-green-950/30",
			bgSelected: "bg-green-100 dark:bg-green-950/50",
			border: "border-green-500",
			text: "text-green-700 dark:text-green-400",
			icon: "text-green-500",
		},
	},
];

interface RoleSelectorProps {
	value?: Role;
	onChange: (value: Role) => void;
	disabled?: boolean;
}

export function RoleSelector({ value, onChange, disabled }: RoleSelectorProps) {
	return (
		<div className="grid grid-cols-3 gap-3">
			{roleOptions.map((option) => {
				const isSelected = value === option.value;
				const Icon = option.icon;

				return (
					<button
						key={option.value}
						type="button"
						onClick={() => !disabled && onChange(option.value)}
						disabled={disabled}
						className={cn(
							"relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color,transform]",
							"hover:scale-[1.02] active:scale-[0.98]",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
							disabled && "cursor-not-allowed opacity-50",
							isSelected
								? [option.color.bgSelected, option.color.border]
								: ["border-transparent bg-muted/50 hover:bg-muted"],
						)}
					>
						{/* Checkmark badge */}
						{isSelected && (
							<div
								className={cn(
									"absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full",
									option.value === "admin" && "bg-red-500",
									option.value === "manager" && "bg-blue-500",
									option.value === "employee" && "bg-green-500",
								)}
							>
								<IconCheck className="size-3 text-white" strokeWidth={3} />
							</div>
						)}

						{/* Icon */}
						<div
							className={cn(
								"flex size-10 items-center justify-center rounded-full",
								isSelected ? option.color.bg : "bg-muted",
							)}
						>
							<Icon
								className={cn("size-5", isSelected ? option.color.icon : "text-muted-foreground")}
							/>
						</div>

						{/* Label */}
						<span
							className={cn(
								"text-sm font-medium",
								isSelected ? option.color.text : "text-foreground",
							)}
						>
							{option.label}
						</span>

						{/* Description */}
						<span className="text-xs text-muted-foreground">{option.description}</span>
					</button>
				);
			})}
		</div>
	);
}
