"use client";

import { IconEdit, IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VacationPolicyForm } from "./vacation-policy-form";

interface VacationPolicyButtonProps {
	organizationId: string;
	existingPolicy?: {
		id: string;
		name: string;
		startDate: string; // YYYY-MM-DD
		validUntil: string | null; // YYYY-MM-DD or null
		isCompanyDefault: boolean;
		defaultAnnualDays: string;
		accrualType: string;
		accrualStartMonth: number | null;
		allowCarryover: boolean;
		maxCarryoverDays: string | null;
		carryoverExpiryMonths: number | null;
	};
	variant?: "default" | "outline";
	size?: "default" | "sm" | "lg";
	children?: ReactNode;
}

export function VacationPolicyButton({
	organizationId,
	existingPolicy,
	variant = "default",
	size = "default",
	children,
}: VacationPolicyButtonProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button variant={variant} size={size} onClick={() => setOpen(true)}>
				{children ||
					(existingPolicy ? (
						<>
							<IconEdit className="mr-2 size-4" />
							Edit Policy
						</>
					) : (
						<>
							<IconPlus className="mr-2 size-4" />
							Create Policy
						</>
					))}
			</Button>
			<VacationPolicyForm
				open={open}
				onOpenChange={setOpen}
				organizationId={organizationId}
				existingPolicy={existingPolicy}
			/>
		</>
	);
}
