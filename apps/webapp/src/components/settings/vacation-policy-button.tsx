"use client";

import { IconEdit, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VacationPolicyForm } from "./vacation-policy-form";

interface VacationPolicyButtonProps {
	organizationId: string;
	year: number;
	existingPolicy?: {
		id: string;
		defaultAnnualDays: string;
		accrualType: string;
		accrualStartMonth: number | null;
		allowCarryover: boolean;
		maxCarryoverDays: string | null;
		carryoverExpiryMonths: number | null;
	};
	variant?: "default" | "outline";
	size?: "default" | "sm" | "lg";
}

export function VacationPolicyButton({
	organizationId,
	year,
	existingPolicy,
	variant = "default",
	size = "default",
}: VacationPolicyButtonProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button variant={variant} size={size} onClick={() => setOpen(true)}>
				{existingPolicy ? (
					<>
						<IconEdit className="mr-2 size-4" />
						Edit Policy
					</>
				) : (
					<>
						<IconPlus className="mr-2 size-4" />
						Create Policy
					</>
				)}
			</Button>
			<VacationPolicyForm
				open={open}
				onOpenChange={setOpen}
				organizationId={organizationId}
				year={year}
				existingPolicy={existingPolicy}
			/>
		</>
	);
}
