"use client";

import { useTranslate } from "@tolgee/react";
import {
	hasZeroWorkingDaysSchedule,
	type VacationBalanceConfiguration,
} from "@/lib/absences/types";

/** Explain why a reliable balance is unavailable without displaying invented days. */
export function VacationPolicyConfigurationMessage({
	configuration,
	className,
	label,
}: {
	configuration: VacationBalanceConfiguration | null | undefined;
	className?: string;
	label?: string;
}) {
	const { t } = useTranslate();
	if (
		configuration?.status !== "missing" &&
		configuration?.status !== "conflict"
	)
		return null;
	return (
		<p className={className}>
			{label ? `${label}: ` : null}
			{hasZeroWorkingDaysSchedule(configuration)
				? t(
						"common:vacationBalance.zeroWorkingDays",
						"Work schedule without working days",
					)
				: configuration.status === "conflict"
					? t(
							"common:vacationBalance.conflictingPolicies",
							"Conflicting vacation policies",
						)
					: t("common:vacationBalance.missingPolicy", "Missing vacation policy")}
		</p>
	);
}
