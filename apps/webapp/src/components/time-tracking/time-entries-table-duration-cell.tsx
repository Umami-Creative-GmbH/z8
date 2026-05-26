import { IconInfoCircle } from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import type { WorkPeriodData } from "./time-entries-table-columns";

export function DurationCell({ row, t }: { row: WorkPeriodData; t: TFnType }) {
	if (!row.durationMinutes) {
		return "-";
	}

	const hasSurcharge = !!row.surchargeMinutes && row.surchargeMinutes > 0;
	const duration = hasSurcharge
		? (row.totalCreditedMinutes ?? row.durationMinutes)
		: row.durationMinutes;
	const adjustmentReason = row.autoAdjustmentReason;

	const autoAdjustmentIndicator =
		row.wasAutoAdjusted && adjustmentReason ? (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex cursor-help">
							<IconInfoCircle
								className="size-4 text-amber-500"
								aria-label={t(
									"timeTracking.autoAdjusted.indicator",
									"Auto-adjusted for compliance",
								)}
							/>
						</span>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs">
						<div className="space-y-1">
							<p className="font-medium">
								{t("timeTracking.autoAdjusted.title", "Auto-adjusted for compliance")}
							</p>
							<p className="text-sm">
								{t(
									"timeTracking.autoAdjusted.description",
									"A {breakMinutes}-minute break was automatically added to comply with {regulationName}.",
									{
										breakMinutes: adjustmentReason.breakInsertedMinutes,
										regulationName: adjustmentReason.regulationName,
									},
								)}
							</p>
							{adjustmentReason.originalDurationMinutes ? (
								<p className="text-xs text-muted-foreground">
									{t("timeTracking.autoAdjusted.originalDuration", "Original: {duration}", {
										duration: formatDuration(adjustmentReason.originalDurationMinutes),
									})}
								</p>
							) : null}
						</div>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		) : null;

	if (hasSurcharge) {
		return (
			<div className="flex flex-col gap-0.5">
				<div className="flex items-center gap-1">
					<span className="tabular-nums">{formatDuration(duration)}</span>
					{autoAdjustmentIndicator}
				</div>
				<span className="tabular-nums text-xs text-emerald-600 dark:text-emerald-400">
					+{formatDuration(row.surchargeMinutes!)}
				</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1">
			<span className="tabular-nums">{formatDuration(duration)}</span>
			{autoAdjustmentIndicator}
		</div>
	);
}
