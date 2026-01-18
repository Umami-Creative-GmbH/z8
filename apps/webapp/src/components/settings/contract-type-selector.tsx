"use client";

import { IconBriefcase, IconCheck, IconClock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type ContractType = "fixed" | "hourly";

interface ContractTypeOption {
	value: ContractType;
	label: string;
	description: string;
	icon: typeof IconBriefcase;
	color: {
		bg: string;
		bgSelected: string;
		border: string;
		text: string;
		icon: string;
	};
}

const contractTypeOptions: ContractTypeOption[] = [
	{
		value: "fixed",
		label: "Fixed",
		description: "Salary-based compensation",
		icon: IconBriefcase,
		color: {
			bg: "bg-purple-50 dark:bg-purple-950/30",
			bgSelected: "bg-purple-100 dark:bg-purple-950/50",
			border: "border-purple-500",
			text: "text-purple-700 dark:text-purple-400",
			icon: "text-purple-500",
		},
	},
	{
		value: "hourly",
		label: "Hourly",
		description: "Paid by hours worked",
		icon: IconClock,
		color: {
			bg: "bg-orange-50 dark:bg-orange-950/30",
			bgSelected: "bg-orange-100 dark:bg-orange-950/50",
			border: "border-orange-500",
			text: "text-orange-700 dark:text-orange-400",
			icon: "text-orange-500",
		},
	},
];

interface ContractTypeSelectorProps {
	value?: ContractType;
	onChange: (value: ContractType) => void;
	disabled?: boolean;
}

export function ContractTypeSelector({ value, onChange, disabled }: ContractTypeSelectorProps) {
	return (
		<div className="grid grid-cols-2 gap-3">
			{contractTypeOptions.map((option) => {
				const isSelected = value === option.value;
				const Icon = option.icon;

				return (
					<button
						key={option.value}
						type="button"
						onClick={() => !disabled && onChange(option.value)}
						disabled={disabled}
						className={cn(
							"relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all",
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
									option.value === "fixed" && "bg-purple-500",
									option.value === "hourly" && "bg-orange-500",
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
