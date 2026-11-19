"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import type { PresenceStatusSummary } from "@/app/[locale]/(app)/time-tracking/actions/presence-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DAY_NUMBER: Record<string, number> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7,
};

export function WorkplacePolicyContext({
	status,
}: {
	status: PresenceStatusSummary;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	if (!status.presenceEnabled) return null;
	const days = status.fixedOfficeDays
		.map((day) =>
			Temporal.PlainDate.from("2026-11-09")
				.add({ days: DAY_NUMBER[day] - 1 })
				.toLocaleString(locale, { weekday: "short" }),
		)
		.join(", ");
	return (
		<Card className="rounded-xl shadow-none">
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle className="text-base">
					{t("timeTracking.workLocation", "Work location")}
				</CardTitle>
				<IconBuilding
					aria-hidden="true"
					className="size-4 text-muted-foreground"
				/>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				{status.available ? (
					<>
						<p className="text-muted-foreground">
							{status.mode === "fixed_days"
								? t(
										"timeTracking.policy.fixedDays",
										"Fixed office days: {days}",
										{ days },
									)
								: t(
										"timeTracking.policy.flexible",
										"Flexible office policy for this period",
									)}
						</p>
						<dl className="space-y-3">
							<div className="flex justify-between gap-4">
								<dt>
									{t(
										"timeTracking.policy.homeOfficeLeft",
										"Home office days left",
									)}
								</dt>
								<dd className="font-semibold tabular-nums">
									{status.homeOfficeDaysLeft}
								</dd>
							</div>
							<div className="flex justify-between gap-4">
								<dt>
									{t(
										"timeTracking.policy.officeRequired",
										"Office days still required",
									)}
								</dt>
								<dd className="font-semibold tabular-nums">
									{status.officeDaysRequiredLeft}
								</dd>
							</div>
						</dl>
						{status.officeDaysRequiredLeft > status.workingDaysRemaining ? (
							<p className="text-amber-700 dark:text-amber-300">
								{t(
									"timeTracking.policy.requirementWarning",
									"Office requirement exceeds remaining working days",
								)}
							</p>
						) : null}
					</>
				) : (
					<p className="text-muted-foreground">
						{status.message ??
							t(
								"timeTracking.policy.unavailable",
								"Workplace policy is unavailable.",
							)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
