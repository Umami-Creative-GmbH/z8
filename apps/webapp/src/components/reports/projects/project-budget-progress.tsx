"use client";

import { IconAlertTriangle, IconCheck, IconTrendingDown } from "@tabler/icons-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ProjectBudgetProgressProps {
	budgetHours: number;
	usedHours: number;
}

export function ProjectBudgetProgress({ budgetHours, usedHours }: ProjectBudgetProgressProps) {
	const percentUsed = (usedHours / budgetHours) * 100;
	const remainingHours = budgetHours - usedHours;
	const isOverBudget = percentUsed > 100;
	const isNearBudget = percentUsed >= 90 && percentUsed <= 100;

	const getStatusIcon = () => {
		if (isOverBudget) {
			return <IconAlertTriangle className="h-5 w-5 text-red-500" />;
		}
		if (isNearBudget) {
			return <IconTrendingDown className="h-5 w-5 text-amber-500" />;
		}
		return <IconCheck className="h-5 w-5 text-green-500" />;
	};

	const getStatusText = () => {
		if (isOverBudget) {
			return "Over Budget";
		}
		if (isNearBudget) {
			return "Near Budget Limit";
		}
		return "On Track";
	};

	const getStatusDescription = () => {
		if (isOverBudget) {
			const overBy = usedHours - budgetHours;
			return `Exceeded budget by ${overBy.toFixed(1)} hours`;
		}
		if (isNearBudget) {
			return `Only ${remainingHours.toFixed(1)} hours remaining`;
		}
		return `${remainingHours.toFixed(1)} hours remaining in budget`;
	};

	const getProgressColor = () => {
		if (isOverBudget) return "bg-red-500";
		if (isNearBudget) return "bg-amber-500";
		if (percentUsed >= 70) return "bg-yellow-500";
		return "bg-green-500";
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					Budget Progress
					{getStatusIcon()}
				</CardTitle>
				<CardDescription>{getStatusDescription()}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Main Progress Bar */}
				<div className="space-y-2">
					<div className="flex justify-between text-sm">
						<span className="text-muted-foreground">{usedHours.toFixed(1)}h used</span>
						<span className="font-medium">{budgetHours.toFixed(1)}h budget</span>
					</div>
					<div className="relative">
						<Progress
							value={Math.min(percentUsed, 100)}
							className={cn("h-4", getProgressColor())}
						/>
						{isOverBudget && (
							<div
								className="absolute top-0 h-4 bg-red-600 rounded-r-full"
								style={{
									left: "100%",
									width: `${Math.min(percentUsed - 100, 50)}%`,
								}}
							/>
						)}
					</div>
					<div className="flex justify-between text-xs text-muted-foreground">
						<span>0%</span>
						<span
							className={cn(
								percentUsed >= 50 && percentUsed < 100 && "font-medium text-foreground",
							)}
						>
							50%
						</span>
						<span className={cn(percentUsed >= 100 && "font-medium text-red-500")}>100%</span>
					</div>
				</div>

				{/* Stats Grid */}
				<div className="grid grid-cols-3 gap-4 pt-4 border-t">
					<div className="text-center">
						<div className="text-2xl font-bold tabular-nums">{percentUsed.toFixed(0)}%</div>
						<div className="text-xs text-muted-foreground">Used</div>
					</div>
					<div className="text-center">
						<div className="text-2xl font-bold tabular-nums">{usedHours.toFixed(1)}h</div>
						<div className="text-xs text-muted-foreground">Hours Logged</div>
					</div>
					<div className="text-center">
						<div
							className={cn(
								"text-2xl font-bold tabular-nums",
								remainingHours < 0 ? "text-red-500" : "text-green-500",
							)}
						>
							{remainingHours >= 0
								? remainingHours.toFixed(1)
								: Math.abs(remainingHours).toFixed(1)}
							h
						</div>
						<div className="text-xs text-muted-foreground">
							{remainingHours >= 0 ? "Remaining" : "Over"}
						</div>
					</div>
				</div>

				{/* Status Badge */}
				<div
					className={cn(
						"flex items-center justify-center gap-2 p-3 rounded-lg",
						isOverBudget && "bg-red-50 dark:bg-red-950",
						isNearBudget && "bg-amber-50 dark:bg-amber-950",
						!isOverBudget && !isNearBudget && "bg-green-50 dark:bg-green-950",
					)}
				>
					{getStatusIcon()}
					<span
						className={cn(
							"font-medium",
							isOverBudget && "text-red-700 dark:text-red-300",
							isNearBudget && "text-amber-700 dark:text-amber-300",
							!isOverBudget && !isNearBudget && "text-green-700 dark:text-green-300",
						)}
					>
						{getStatusText()}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
