"use client";

import { IconCalendar, IconCheck, IconClock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type ContractType = "fixed" | "hourly";

interface ContractTypeOption {
	value: ContractType;
	label: string;
	description: string;
	icon: typeof IconCalendar;
}

// Contract types are categories, not statuses: each is told apart by its icon and
// label, and the selected one uses the primary selection treatment.
const contractTypeOptions: ContractTypeOption[] = [
	{
		value: "fixed",
		label: "Fixed",
		description: "Salary-based compensation",
		icon: IconCalendar,
	},
	{
		value: "hourly",
		label: "Hourly",
		description: "Paid by hours worked",
		icon: IconClock,
	},
];

interface ContractTypeSelectorProps {
	value?: ContractType;
	onChange: (value: ContractType) => void;
	disabled?: boolean;
	labels?: Partial<Record<ContractType, { label: string; description: string }>>;
}

export function ContractTypeSelector({
	value,
	onChange,
	disabled,
	labels,
}: ContractTypeSelectorProps) {
	return (
		<div className="grid grid-cols-2 gap-3">
			{contractTypeOptions.map((option) => {
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
