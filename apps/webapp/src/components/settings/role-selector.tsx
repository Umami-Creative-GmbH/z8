"use client";

import { IconCheck, IconShield, IconUser, IconUsers } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type Role = "admin" | "manager" | "employee";

interface RoleOption {
	value: Role;
	label: string;
	description: string;
	icon: typeof IconShield;
}

// Roles are categories, not statuses: each is told apart by its icon and label,
// and the selected one uses the primary selection treatment.
const roleOptions: RoleOption[] = [
	{
		value: "admin",
		label: "Admin",
		description: "Full system access",
		icon: IconShield,
	},
	{
		value: "manager",
		label: "Manager",
		description: "Team oversight",
		icon: IconUsers,
	},
	{
		value: "employee",
		label: "Employee",
		description: "Standard access",
		icon: IconUser,
	},
];

interface RoleSelectorProps {
	value?: Role;
	onChange: (value: Role) => void;
	disabled?: boolean;
	labels?: Partial<Record<Role, { label: string; description: string }>>;
}

export function RoleSelector({ value, onChange, disabled, labels }: RoleSelectorProps) {
	return (
		<div className="grid grid-cols-3 gap-3">
			{roleOptions.map((option) => {
				const isSelected = value === option.value;
				const Icon = option.icon;
				const copy = labels?.[option.value] ?? option;

				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={isSelected}
						onClick={() => !disabled && onChange(option.value)}
						disabled={disabled}
						className={cn(
							"relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color,transform]",
							"motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.98]",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
							disabled && "cursor-not-allowed opacity-50",
							isSelected
								? "border-primary bg-primary/5"
								: "border-transparent bg-muted/50 hover:bg-muted",
						)}
					>
						{/* Checkmark badge */}
						{isSelected && (
							<div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary">
								<IconCheck
									className="size-3 text-primary-foreground"
									strokeWidth={3}
									aria-hidden="true"
								/>
							</div>
						)}

						{/* Icon */}
						<div
							className={cn(
								"flex size-10 items-center justify-center rounded-full",
								isSelected ? "bg-primary/10" : "bg-muted",
							)}
						>
							<Icon
								className={cn("size-5", isSelected ? "text-primary" : "text-muted-foreground")}
								aria-hidden="true"
							/>
						</div>

						{/* Label */}
						<span className="text-sm font-medium text-foreground">{copy.label}</span>

						{/* Description */}
						<span className="text-xs text-muted-foreground">{copy.description}</span>
					</button>
				);
			})}
		</div>
	);
}
