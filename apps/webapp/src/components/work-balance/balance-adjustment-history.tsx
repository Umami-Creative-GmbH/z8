"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatInstant, formatPlainDate } from "@/lib/datetime/temporal-format";
import { cn } from "@/lib/utils";
import type { BalanceAdjustmentView } from "@/lib/work-balance/adjustments/types";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";

/**
 * Labels for balance adjustments, in the `common` namespace so the employee's
 * own views (time tracking, calendar) and the employee page share them (#996).
 */
export function useBalanceAdjustmentLabels() {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	return {
		kind: (adjustment: Pick<BalanceAdjustmentView, "kind">) =>
			adjustment.kind === "overtime_payout"
				? t("workBalance.adjustments.kind.overtimePayout", "Overtime payout")
				: t("workBalance.adjustments.kind.openingBalance", "Opening balance"),
		day: (day: string) => formatPlainDate(parsePlainDate(day), displayContext.locale, "dateMedium"),
		instant: (instant: string) =>
			formatInstant(parseInstant(instant), displayContext, "dateTimeMedium"),
	};
}

/**
 * The history of an employee's balance adjustments (#993, #996): kind, signed
 * time, day, reason, who recorded it and when, and for a cancelled one who
 * cancelled it, when and why. `onCancel` adds a cancel action to each
 * adjustment still in effect; without it the list is read-only.
 */
export function BalanceAdjustmentHistory({
	adjustments,
	onCancel,
}: {
	adjustments: readonly BalanceAdjustmentView[];
	onCancel?: (adjustment: BalanceAdjustmentView) => void;
}) {
	const { t } = useTranslate();
	const label = useBalanceAdjustmentLabels();
	const unknownUser = () => t("workBalance.adjustments.unknownUser", "a deleted user");

	if (adjustments.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				{t("workBalance.adjustments.empty", "No balance adjustments yet.")}
			</p>
		);
	}

	return (
		<ul className="divide-y rounded-md border">
			{adjustments.map((adjustment) => (
				<li
					key={adjustment.id}
					className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
				>
					<div className={cn("min-w-0 space-y-1", adjustment.cancellation && "opacity-70")}>
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-sm">{label.kind(adjustment)}</span>
							<span
								className={cn("text-sm tabular-nums", adjustment.cancellation && "line-through")}
							>
								{formatSignedWorkBalance(adjustment.minutes)}
							</span>
							<span className="text-muted-foreground text-sm">{label.day(adjustment.day)}</span>
							{adjustment.cancellation ? (
								<Badge variant="outline">
									{t("workBalance.adjustments.cancelled", "Cancelled")}
								</Badge>
							) : null}
						</div>
						<p className="break-words text-sm">{adjustment.reason}</p>
						<p className="text-muted-foreground text-xs">
							{t("workBalance.adjustments.recordedBy", "Recorded by {name} on {date}", {
								name: adjustment.recordedBy.name || unknownUser(),
								date: label.instant(adjustment.recordedAt),
							})}
						</p>
						{adjustment.cancellation ? (
							<p className="break-words text-muted-foreground text-xs">
								{t(
									"workBalance.adjustments.cancelledBy",
									"Cancelled by {name} on {date}: {reason}",
									{
										name: adjustment.cancellation.cancelledBy.name || unknownUser(),
										date: label.instant(adjustment.cancellation.cancelledAt),
										reason: adjustment.cancellation.reason,
									},
								)}
							</p>
						) : null}
					</div>
					{onCancel && !adjustment.cancellation ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="self-start"
							onClick={() => onCancel(adjustment)}
						>
							{t("workBalance.adjustments.cancel", "Cancel")}
						</Button>
					) : null}
				</li>
			))}
		</ul>
	);
}
