"use client";

import { DateTime } from "luxon";
import { useTransition } from "react";
import { useTranslate } from "@tolgee/react";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { runScheduledExportNowAction } from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RunNowDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	scheduleId: string;
	scheduleName: string;
	dateRangeStrategy: string;
	hasExecutionInProgress?: boolean;
	onSuccess?: () => void;
}

function getEstimatedDateRange(strategy: string): { start: string; end: string } {
	const now = DateTime.utc();

	switch (strategy) {
		case "previous_day":
			return {
				start: now.minus({ days: 1 }).startOf("day").toISODate() ?? "N/A",
				end: now.minus({ days: 1 }).endOf("day").toISODate() ?? "N/A",
			};
		case "previous_week":
			return {
				start: now.minus({ weeks: 1 }).startOf("week").toISODate() ?? "N/A",
				end: now.minus({ weeks: 1 }).endOf("week").toISODate() ?? "N/A",
			};
		case "previous_month":
			return {
				start: now.minus({ months: 1 }).startOf("month").toISODate() ?? "N/A",
				end: now.minus({ months: 1 }).endOf("month").toISODate() ?? "N/A",
			};
		case "previous_quarter":
			return {
				start: now.minus({ quarters: 1 }).startOf("quarter").toISODate() ?? "N/A",
				end: now.minus({ quarters: 1 }).endOf("quarter").toISODate() ?? "N/A",
			};
		default:
			return { start: "TBD", end: "TBD" };
	}
}

export function RunNowDialog({
	open,
	onOpenChange,
	organizationId,
	scheduleId,
	scheduleName,
	dateRangeStrategy,
	hasExecutionInProgress = false,
	onSuccess,
}: RunNowDialogProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();

	const DATE_RANGE_LABELS: Record<string, string> = {
		previous_day: t("settings.scheduledExports.dateRange.previousDay", "Previous Day"),
		previous_week: t("settings.scheduledExports.dateRange.previousWeek", "Previous Week"),
		previous_month: t("settings.scheduledExports.dateRange.previousMonth", "Previous Month"),
		previous_quarter: t("settings.scheduledExports.dateRange.previousQuarter", "Previous Quarter"),
		custom_offset: t("settings.scheduledExports.dateRange.customOffset", "Custom Offset"),
	};

	const estimatedRange = getEstimatedDateRange(dateRangeStrategy);

	const handleRunNow = () => {
		startTransition(async () => {
			try {
				const result = await runScheduledExportNowAction(
					organizationId,
					scheduleId,
				);

				if (result.success) {
					toast.success(t("settings.scheduledExports.runNow.success", "Export started"), {
						description: t("settings.scheduledExports.runNow.successDesc", "The export has been queued and will run shortly. Check the execution history for progress."),
					});
					onOpenChange(false);
					onSuccess?.();
				} else {
					toast.error(t("settings.scheduledExports.runNow.error", "Failed to start export"), {
						description: result.error,
					});
				}
			} catch {
				toast.error(t("settings.scheduledExports.toast.unexpectedError", "An unexpected error occurred"));
			}
		});
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("settings.scheduledExports.runNow.title", "Run Export Now")}</AlertDialogTitle>
					<AlertDialogDescription>
						{t("settings.scheduledExports.runNow.description", "This will immediately run the scheduled export \"{scheduleName}\".", { scheduleName })}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="space-y-4 py-4">
					<div className="rounded-lg border p-4 space-y-2" role="region" aria-label={t("settings.scheduledExports.runNow.detailsRegion", "Export details")}>
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">{t("settings.scheduledExports.runNow.dateRangeStrategy", "Date Range Strategy")}</span>
							<span className="font-medium">
								{DATE_RANGE_LABELS[dateRangeStrategy] || dateRangeStrategy}
							</span>
						</div>
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">{t("settings.scheduledExports.runNow.estimatedRange", "Estimated Range")}</span>
							<span>
								{estimatedRange.start} {t("common.to", "to")} {estimatedRange.end}
							</span>
						</div>
					</div>

					{hasExecutionInProgress && (
						<Alert variant="destructive" role="alert">
							<AlertTriangle className="h-4 w-4" aria-hidden="true" />
							<AlertDescription>
								{t("settings.scheduledExports.runNow.inProgressWarning", "There is already an execution in progress for this schedule. Running now may result in duplicate exports.")}
							</AlertDescription>
						</Alert>
					)}
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{t("settings.scheduledExports.dialog.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={(e) => {
							e.preventDefault();
							handleRunNow();
						}}
						disabled={isPending || hasExecutionInProgress}
					>
						{isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								{t("settings.scheduledExports.runNow.starting", "Starting...")}
							</>
						) : (
							<>
								<Play className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("settings.scheduledExports.runNow.runNow", "Run Now")}
							</>
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
