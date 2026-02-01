"use client";

import { useTranslate } from "@tolgee/react";
import { AlertTriangle, Clock, Info, Shield, XCircle } from "lucide-react";
import type { ComplianceAlert } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";

interface ComplianceAlertBannerProps {
	alerts: ComplianceAlert[];
	onRequestException?: (type: string) => void;
	className?: string;
	compact?: boolean;
}

const severityConfig = {
	info: {
		icon: Info,
		className: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
		iconClassName: "text-blue-600 dark:text-blue-400",
	},
	warning: {
		icon: AlertTriangle,
		className: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
		iconClassName: "text-amber-600 dark:text-amber-400",
	},
	critical: {
		icon: AlertTriangle,
		className: "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-100",
		iconClassName: "text-orange-600 dark:text-orange-400",
	},
	violation: {
		icon: XCircle,
		className: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
		iconClassName: "text-red-600 dark:text-red-400",
	},
} as const;

const alertTypeLabels: Record<string, string> = {
	daily_hours: "Daily Hours",
	weekly_hours: "Weekly Hours",
	monthly_hours: "Monthly Hours",
	uninterrupted_work: "Continuous Work",
	break_required: "Break Required",
	rest_period: "Rest Period",
	overtime_daily: "Daily Overtime",
	overtime_weekly: "Weekly Overtime",
	overtime_monthly: "Monthly Overtime",
};

export function ComplianceAlertBanner({
	alerts,
	onRequestException,
	className,
	compact = false,
}: ComplianceAlertBannerProps) {
	const { t } = useTranslate();

	if (alerts.length === 0) return null;

	// Group alerts by severity, showing the most severe first
	const sortedAlerts = [...alerts].sort((a, b) => {
		const severityOrder = { violation: 0, critical: 1, warning: 2, info: 3 };
		return severityOrder[a.severity] - severityOrder[b.severity];
	});

	// In compact mode, just show the most severe alert
	const displayAlerts = compact ? [sortedAlerts[0]] : sortedAlerts;

	if (compact && sortedAlerts.length > 0) {
		const alert = sortedAlerts[0];
		const config = severityConfig[alert.severity];
		const Icon = config.icon;

		return (
			<div
				className={cn(
					"flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
					config.className,
					className,
				)}
			>
				<Icon className={cn("h-4 w-4 shrink-0", config.iconClassName)} aria-hidden="true" />
				<span className="flex-1 truncate">{alert.message}</span>
				{sortedAlerts.length > 1 && (
					<span className="shrink-0 text-xs opacity-70">
						+{sortedAlerts.length - 1} {t("compliance.moreAlerts", "more")}
					</span>
				)}
			</div>
		);
	}

	return (
		<div className={cn("space-y-2", className)}>
			{displayAlerts.map((alert, index) => {
				const config = severityConfig[alert.severity];
				const Icon = config.icon;

				return (
					<Alert key={`${alert.alertType}-${index}`} className={cn("py-3", config.className)}>
						<Icon className={cn("h-4 w-4", config.iconClassName)} aria-hidden="true" />
						<AlertTitle className="flex items-center gap-2">
							{alertTypeLabels[alert.alertType] || alert.alertType}
							{alert.currentMinutes !== undefined && alert.thresholdMinutes !== undefined && (
								<span className="text-xs font-normal opacity-70">
									({Math.floor(alert.currentMinutes / 60)}h /{" "}
									{Math.floor(alert.thresholdMinutes / 60)}h)
								</span>
							)}
						</AlertTitle>
						<AlertDescription className="flex items-start justify-between gap-4">
							<span>{alert.message}</span>
							{alert.canRequestException && onRequestException && (
								<Button
									size="sm"
									variant="outline"
									className="shrink-0"
									onClick={() => onRequestException(alert.alertType)}
								>
									<Shield className="mr-1.5 h-3 w-3" aria-hidden="true" />
									{t("compliance.requestException", "Request Exception")}
								</Button>
							)}
						</AlertDescription>
					</Alert>
				);
			})}
		</div>
	);
}

interface RestPeriodBlockerProps {
	minutesUntilAllowed: number;
	nextAllowedClockIn: Date;
	onRequestException?: () => void;
	hasApprovedExceptions?: boolean;
}

export function RestPeriodBlocker({
	minutesUntilAllowed,
	nextAllowedClockIn,
	onRequestException,
	hasApprovedExceptions = false,
}: RestPeriodBlockerProps) {
	const { t } = useTranslate();

	const hoursRemaining = Math.floor(minutesUntilAllowed / 60);
	const minsRemaining = minutesUntilAllowed % 60;
	const timeStr =
		hoursRemaining > 0
			? `${hoursRemaining}h ${minsRemaining}m`
			: `${minsRemaining} minutes`;

	// Use Intl.DateTimeFormat for hydration-safe time formatting
	const formattedNextAllowed = new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(nextAllowedClockIn));

	return (
		<Alert className="border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
			<Clock className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
			<AlertTitle>
				{t("compliance.restPeriodRequired", "Rest Period Required")}
			</AlertTitle>
			<AlertDescription className="space-y-3">
				<p>
					{t(
						"compliance.restPeriodMessage",
						"You need {{time}} more rest before you can clock in. Next allowed clock-in: {{nextTime}}",
						{ time: timeStr, nextTime: formattedNextAllowed },
					)}
				</p>
				{hasApprovedExceptions ? (
					<p className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
						<Shield className="h-4 w-4" aria-hidden="true" />
						{t(
							"compliance.hasApprovedException",
							"You have an approved exception. You may proceed.",
						)}
					</p>
				) : onRequestException ? (
					<Button
						size="sm"
						variant="outline"
						className="border-red-300 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
						onClick={onRequestException}
					>
						<Shield className="mr-1.5 h-3 w-3" aria-hidden="true" />
						{t("compliance.requestException", "Request Exception")}
					</Button>
				) : null}
			</AlertDescription>
		</Alert>
	);
}
