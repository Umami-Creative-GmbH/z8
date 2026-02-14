"use client";

import { IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/time-tracking/actions";
import { Progress } from "@/components/ui/progress";
import { usePresenceStatus } from "@/hooks/use-presence-status";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

export function PresenceStatusWidget() {
	const { t } = useTranslate();
	const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);

	useEffect(() => {
		getCurrentEmployee().then((emp) => {
			if (emp) setEmployeeId(emp.id);
		});
	}, []);

	const { data: status, isLoading } = usePresenceStatus(employeeId);

	// Don't render if presence is not enabled or no data
	if (!isLoading && (!status || !status.presenceEnabled)) {
		return null;
	}

	const percentage =
		status && status.required > 0
			? Math.min((status.actual / status.required) * 100, 100)
			: 100;
	const isBehind = status ? status.actual < status.required : false;

	const periodLabel = status
		? status.period === "weekly"
			? t("settings.workPolicies.presenceEvaluationWeekly", "week")
			: status.period === "biweekly"
				? t("settings.workPolicies.presenceEvaluationBiweekly", "2 weeks")
				: t("settings.workPolicies.presenceEvaluationMonthly", "month")
		: "";

	return (
		<DashboardWidget id="presence-status">
			<WidgetCard
				title={t("dashboard.presenceStatus", "Presence")}
				description={t(
					"dashboard.presenceDescription",
					"On-site attendance tracking",
				)}
				icon={<IconMapPin className="size-4 text-teal-500" />}
				loading={isLoading || !employeeId}
			>
				{status && (
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-2xl font-bold">
									{status.actual}/{status.required}
								</p>
								<p className="text-xs text-muted-foreground">
									{t("dashboard.presenceProgress", "days on-site this {period}", {
										period: periodLabel,
									})}
								</p>
							</div>
						</div>
						<Progress
							value={percentage}
							className={
								isBehind
									? "[&_[data-slot=progress-indicator]]:bg-amber-500"
									: "[&_[data-slot=progress-indicator]]:bg-green-500"
							}
						/>
						{isBehind && (
							<p className="text-xs text-amber-600 dark:text-amber-400">
								{t("dashboard.presenceBehind", "{remaining} more days needed", {
									remaining: status.required - status.actual,
								})}
							</p>
						)}
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
