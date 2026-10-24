"use client";

import { IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { DashboardWidgetData, DashboardWidgetSnapshot } from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

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

export function PresenceStatusWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["presence-status"]>;
} = {}) {
	const { t } = useTranslate();
	const {
		data: status,
		loading,
		refreshing,
		refetch,
		error,
	} = useDashboardWidget("presence-status", initialSnapshot);
	if (!loading && !error && status?.presenceEnabled === false) return null;

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
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{error ? (
					<WidgetReadError
						title={t("dashboard.presence.workLocation", "Work location")}
						message={error}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : status?.available ? (
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
