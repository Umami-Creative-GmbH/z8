"use client";

import { IconAlertTriangle, IconBeach, IconCalendarTime, IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { PreviouslyTakenVacationExplanation } from "@/components/absences/previously-taken-vacation-explanation";
import { VacationPolicyConfigurationMessage } from "@/components/absences/vacation-policy-configuration-message";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { DashboardWidgetData, DashboardWidgetSnapshot } from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

function getUsageColor(percentage: number) {
	if (percentage >= 90) return "text-red-500";
	if (percentage >= 75) return "text-orange-500";
	if (percentage >= 50) return "text-yellow-500";
	return "text-green-500";
}

export function VacationBalanceWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["vacation-balance"]>;
} = {}) {
	const { t } = useTranslate();
	const { data, loading, refreshing, refetch, error } = useDashboardWidget(
		"vacation-balance",
		initialSnapshot,
	);
	const balance = data?.balance;

	return (
		<DashboardWidget id="vacation-balance">
			<WidgetCard
				title={t("dashboard.vacation.title", "Vacation Balance")}
				description={
					data
						? t("dashboard.vacation.description", "{year} vacation days", {
								year: data.year,
							})
						: ""
				}
				icon={<IconBeach className="size-4 text-amber-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{error ||
				(!loading &&
					!balance &&
					(!data?.configuration || data.configuration.status === "resolved")) ? (
					<WidgetReadError
						title={t("dashboard.vacation.title", "Vacation Balance")}
						message={
							error || t("dashboard.vacation.unavailable", "Vacation balance is unavailable.")
						}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : (
					data && <VacationBalanceContent data={data} />
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}

function VacationBalanceContent({ data }: { data: DashboardWidgetData["vacation-balance"] }) {
	const { t } = useTranslate();
	const { balance } = data;
	// Calculate percentage used
	const usedPercentage = balance?.totalDays
		? ((balance.usedDays + balance.pendingDays) / balance.totalDays) * 100
		: 0;

	// Check if carryover is expiring soon (within 30 days)
	const carryoverExpiringSoon =
		balance?.carryoverExpiryDaysRemaining != null &&
		balance.carryoverExpiryDaysRemaining <= 30 &&
		(balance.carryoverDays ?? 0) > 0;

	return (
		<>
			<VacationPolicyConfigurationMessage
				configuration={data?.configuration}
				className="text-sm text-muted-foreground"
			/>
			{balance && (
				<div className="space-y-4">
					{/* Main Balance Display */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-3xl font-bold">{balance.remainingDays.toFixed(1)}</p>
							<p className="text-sm text-muted-foreground">
								{t("dashboard.vacation.days-remaining", "days remaining")}
							</p>
						</div>
						<div className="text-right">
							<p className="text-sm font-medium">
								{t("dashboard.vacation.total", "{days} total", {
									days: balance.totalDays.toFixed(1),
								})}
							</p>
							<p className="text-xs text-muted-foreground">
								{t("dashboard.vacation.used", "{days} used", {
									days: balance.usedDays.toFixed(1),
								})}
								{balance.pendingDays > 0 && (
									<>
										,{" "}
										{t("dashboard.vacation.pending", "{days} pending", {
											days: balance.pendingDays.toFixed(1),
										})}
									</>
								)}
							</p>
						</div>
					</div>

					{/* Progress Bar */}
					<PreviouslyTakenVacationExplanation days={balance.previouslyTakenDays} />
					<div className="space-y-1">
						<Progress value={Math.min(usedPercentage, 100)} className="h-2" />
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{t("dashboard.vacation.percent-used", "{percent}% used", {
									percent: usedPercentage.toFixed(0),
								})}
							</span>
							<span className={getUsageColor(usedPercentage)}>
								{t("dashboard.vacation.available", "{days} available", {
									days: balance.remainingDays.toFixed(1),
								})}
							</span>
						</div>
					</div>

					{/* Breakdown */}
					<div className="grid grid-cols-3 gap-2 pt-2 border-t">
						<div className="text-center">
							<p className="text-lg font-semibold">{balance.usedDays.toFixed(1)}</p>
							<p className="text-xs text-muted-foreground">
								{t("dashboard.vacation.label-used", "Used")}
							</p>
						</div>
						<div className="text-center">
							<p className="text-lg font-semibold">{balance.pendingDays.toFixed(1)}</p>
							<p className="text-xs text-muted-foreground">
								{t("dashboard.vacation.label-pending", "Pending")}
							</p>
						</div>
						<div className="text-center">
							<p className="text-lg font-semibold text-green-600">
								{balance.remainingDays.toFixed(1)}
							</p>
							<p className="text-xs text-muted-foreground">
								{t("dashboard.vacation.label-available", "Available")}
							</p>
						</div>
					</div>

					{/* Carryover Section */}
					{balance.hasCarryover && balance.carryoverDays > 0 && (
						<div className="pt-2 border-t">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<IconCalendarTime className="size-4 text-muted-foreground" />
									<span className="text-sm">{t("dashboard.vacation.carryover", "Carryover")}</span>
								</div>
								<Badge variant="secondary">
									{t("dashboard.vacation.carryover-days", "{days} days", {
										days: balance.carryoverDays.toFixed(1),
									})}
								</Badge>
							</div>

							{balance.carryoverExpiryDaysRemaining !== null && (
								<div className="mt-2">
									{carryoverExpiringSoon ? (
										<div className="flex items-center gap-2 p-2 text-sm bg-amber-50 dark:bg-amber-950 rounded-md border border-amber-200 dark:border-amber-800">
											<IconAlertTriangle className="size-4 text-amber-500 flex-shrink-0" />
											<span className="text-amber-700 dark:text-amber-300">
												{t("dashboard.vacation.expires-in", "Expires in {days} days", {
													days: balance.carryoverExpiryDaysRemaining,
												})}
											</span>
										</div>
									) : (
										<p className="text-xs text-muted-foreground flex items-center gap-1">
											<IconClock className="size-3" />
											{t("dashboard.vacation.expires-in", "Expires in {days} days", {
												days: balance.carryoverExpiryDaysRemaining,
											})}
										</p>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			)}{" "}
		</>
	);
}
