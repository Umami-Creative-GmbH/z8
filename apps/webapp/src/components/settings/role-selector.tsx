"use client";

import { IconShield, IconUser, IconUsers } from "@tabler/icons-react";
import { SettingsOptionSelector } from "./settings-option-selector";

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
		<SettingsOptionSelector
			options={roleOptions}
			value={value}
			onChange={onChange}
			disabled={disabled}
			labels={labels}
			className="grid-cols-3"
		/>
	);
}
