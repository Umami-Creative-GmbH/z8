"use client";

import { IconCalendar, IconClock } from "@tabler/icons-react";
import { SettingsOptionSelector } from "./settings-option-selector";

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
		<SettingsOptionSelector
			options={contractTypeOptions}
			value={value}
			onChange={onChange}
			disabled={disabled}
			labels={labels}
			className="grid-cols-2"
		/>
	);
}
