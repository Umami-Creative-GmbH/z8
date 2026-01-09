"use client";

import { IconAlertTriangle, IconBeach, IconCalendarTime, IconClock } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getVacationBalance } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type VacationBalance = {
	totalDays: number;
	usedDays: number;
	pendingDays: number;
	remainingDays: number;
	carryoverDays: number;
	carryoverExpiryDate: Date | null;
	carryoverExpiryDaysRemaining: number | null;
	hasCarryover: boolean;
};

export function VacationBalanceWidget() {
	const {
		data: balance,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<VacationBalance>(getVacationBalance, {
		errorMessage: "Failed to load vacation balance",
	});

	if (!balance && !loading) return null;

	// Calculate percentage used
	const usedPercentage = balance?.totalDays
		? ((balance.usedDays + balance.pendingDays) / balance.totalDays) * 100
		: 0;

	const getUsageColor = (percentage: number) => {
		if (percentage >= 90) return "text-red-500";
		if (percentage >= 75) return "text-orange-500";
		if (percentage >= 50) return "text-yellow-500";
		return "text-green-500";
	};

	// Check if carryover is expiring soon (within 30 days)
	const carryoverExpiringSoon =
		balance?.carryoverExpiryDaysRemaining !== null &&
		balance?.carryoverExpiryDaysRemaining <= 30 &&
		balance?.carryoverDays > 0;

	return (
		<WidgetCard
			title="Vacation Balance"
			description={`${new Date().getFullYear()} vacation days`}
			icon={<IconBeach className="size-4 text-muted-foreground" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
		>
			{balance && (
				<div className="space-y-4">
					{/* Main Balance Display */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-3xl font-bold">{balance.remainingDays.toFixed(1)}</p>
							<p className="text-sm text-muted-foreground">days remaining</p>
						</div>
						<div className="text-right">
							<p className="text-sm font-medium">{balance.totalDays.toFixed(1)} total</p>
							<p className="text-xs text-muted-foreground">
								{balance.usedDays.toFixed(1)} used
								{balance.pendingDays > 0 && <>, {balance.pendingDays.toFixed(1)} pending</>}
							</p>
						</div>
					</div>

					{/* Progress Bar */}
					<div className="space-y-1">
						<Progress value={Math.min(usedPercentage, 100)} className="h-2" />
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">{usedPercentage.toFixed(0)}% used</span>
							<span className={getUsageColor(usedPercentage)}>
								{balance.remainingDays.toFixed(1)} available
							</span>
						</div>
					</div>

					{/* Breakdown */}
					<div className="grid grid-cols-3 gap-2 pt-2 border-t">
						<div className="text-center">
							<p className="text-lg font-semibold">{balance.usedDays.toFixed(1)}</p>
							<p className="text-xs text-muted-foreground">Used</p>
						</div>
						<div className="text-center">
							<p className="text-lg font-semibold">{balance.pendingDays.toFixed(1)}</p>
							<p className="text-xs text-muted-foreground">Pending</p>
						</div>
						<div className="text-center">
							<p className="text-lg font-semibold text-green-600">
								{balance.remainingDays.toFixed(1)}
							</p>
							<p className="text-xs text-muted-foreground">Available</p>
						</div>
					</div>

					{/* Carryover Section */}
					{balance.hasCarryover && balance.carryoverDays > 0 && (
						<div className="pt-2 border-t">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<IconCalendarTime className="size-4 text-muted-foreground" />
									<span className="text-sm">Carryover</span>
								</div>
								<Badge variant="secondary">{balance.carryoverDays.toFixed(1)} days</Badge>
							</div>

							{balance.carryoverExpiryDaysRemaining !== null && (
								<div className="mt-2">
									{carryoverExpiringSoon ? (
										<div className="flex items-center gap-2 p-2 text-sm bg-amber-50 dark:bg-amber-950 rounded-md border border-amber-200 dark:border-amber-800">
											<IconAlertTriangle className="size-4 text-amber-500 flex-shrink-0" />
											<span className="text-amber-700 dark:text-amber-300">
												Expires in {balance.carryoverExpiryDaysRemaining} days
											</span>
										</div>
									) : (
										<p className="text-xs text-muted-foreground flex items-center gap-1">
											<IconClock className="size-3" />
											Expires in {balance.carryoverExpiryDaysRemaining} days
										</p>
									)}
								</div>
							)}
						</div>
					)}

					{/* No vacation policy message */}
					{balance.totalDays === 0 && (
						<div className="p-3 text-sm text-muted-foreground bg-muted rounded-md text-center">
							No vacation policy configured for this year
						</div>
					)}
				</div>
			)}
		</WidgetCard>
	);
}
