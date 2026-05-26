"use client";

import { IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/time-tracking/actions";
import { usePresenceStatus } from "@/hooks/use-presence-status";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

const WEEKDAY_LABELS: Record<string, string> = {
	monday: "Mon",
	tuesday: "Tue",
	wednesday: "Wed",
	thursday: "Thu",
	friday: "Fri",
	saturday: "Sat",
	sunday: "Sun",
};

const WEEKDAY_TRANSLATION_KEYS: Record<string, string> = {
	monday: "common.weekdays.mon",
	tuesday: "common.weekdays.tue",
	wednesday: "common.weekdays.wed",
	thursday: "common.weekdays.thu",
	friday: "common.weekdays.fri",
	saturday: "common.weekdays.sat",
	sunday: "common.weekdays.sun",
};

export function PresenceStatusWidget() {
	const { t } = useTranslate();
	const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
	const [employeeResolved, setEmployeeResolved] = useState(false);

	useEffect(() => {
		let mounted = true;

		async function loadEmployee() {
			try {
				const emp = await getCurrentEmployee();
				if (mounted && emp) setEmployeeId(emp.id);
			} catch {
				// Treat lookup failures like unavailable presence and resolve the loading state.
			}

			if (mounted) setEmployeeResolved(true);
		}

		void loadEmployee();

		return () => {
			mounted = false;
		};
	}, []);

	const { data: status, isLoading } = usePresenceStatus(employeeId);

	// Don't render if presence is not enabled or no data
	if (employeeResolved && !isLoading && !status?.presenceEnabled) {
		return null;
	}

	const fixedOfficeDays = status?.fixedOfficeDays
		?.map((day) =>
			t(WEEKDAY_TRANSLATION_KEYS[day] ?? `common.weekdays.${day}`, WEEKDAY_LABELS[day] ?? day),
		)
		.join(", ");
	const showOfficeWarning =
		status?.available && status.officeDaysRequiredLeft > status.workingDaysRemaining;

	return (
		<DashboardWidget id="presence-status">
			<WidgetCard
				title={t("dashboard.presence.workLocation", "Work location")}
				description={t("dashboard.presence.periodDescription", "This period")}
				icon={<IconMapPin aria-hidden="true" className="size-4 text-teal-500" />}
				loading={isLoading || !employeeResolved}
			>
				{status?.available ? (
					<div className="space-y-3">
						<div className="grid grid-cols-2 gap-3">
							<div className="rounded-lg border bg-muted/30 p-3">
								<p className="text-2xl font-semibold tabular-nums">{status.homeOfficeDaysLeft}</p>
								<p className="text-xs text-muted-foreground">
									{t("dashboard.presence.homeOfficeLeft", "Home office left")}
								</p>
							</div>
							<div className="rounded-lg border bg-muted/30 p-3">
								<p className="text-2xl font-semibold tabular-nums">
									{status.officeDaysRequiredLeft}
								</p>
								<p className="text-xs text-muted-foreground">
									{t("dashboard.presence.officeStillRequired", "Office still required")}
								</p>
							</div>
						</div>
						{status.mode === "fixed_days" ? (
							<p className="text-xs text-muted-foreground">
								{t("dashboard.presence.fixedOfficeDays", "Fixed office days: {days}", {
									days: fixedOfficeDays,
								})}
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								{t(
									"dashboard.presence.flexibleOfficePolicy",
									"Flexible office policy for this period",
								)}
							</p>
						)}
						{showOfficeWarning && (
							<p className="text-xs text-amber-600 dark:text-amber-400">
								{t(
									"dashboard.presence.officeDaysWarning",
									"Office requirement exceeds remaining work days",
									{
										required: status.officeDaysRequiredLeft,
										remaining: status.workingDaysRemaining,
									},
								)}
							</p>
						)}
					</div>
				) : status?.presenceEnabled ? (
					<p className="text-sm text-muted-foreground">
						{status.message ??
							t("dashboard.presence.unavailable", "Presence policy is unavailable.")}
					</p>
				) : null}
			</WidgetCard>
		</DashboardWidget>
	);
}
