"use client";
import { IconCash, IconFlag } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { useBalanceAdjustmentLabels } from "@/components/work-balance/balance-adjustment-history";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

/** Displays the owner's projection; it never calculates or edits a balance. */
export function EmployeeBalanceProjection({
	balance,
	timezone,
	actions,
}: {
	balance: EmployeeWorkBalancePayload | null;
	timezone: string;
	actions: { enabled: boolean; open: (task: "opening" | "payout") => void } | null;
}) {
	const { t } = useTranslate();
	const label = useBalanceAdjustmentLabels();
	return (
		<section
			aria-label={t("settings.employees.workBalance.current", "Current work balance")}
			className="flex flex-wrap items-center justify-between gap-5 rounded-lg border bg-card p-5 sm:p-6"
		>
			<div className="space-y-1">
				<h2 className="text-sm text-muted-foreground">
					{t("settings.employees.workBalance.current", "Current work balance")}
				</h2>
				<p className="text-3xl font-semibold tabular-nums">
					{balance
						? formatSignedWorkBalance(balance.balanceMinutes)
						: t("workBalance.notCalculated", "Not calculated yet")}
				</p>
				<p className="text-sm text-muted-foreground">
					{balance
						? t("settings.employees.workBalance.through", "Through {date}", {
								date: label.day(balance.computedThroughDate),
							})
						: t(
								"payroll.workBalances.projectionUnavailable",
								"The balance projection is unavailable. Adjustment records remain below.",
							)}
				</p>
				<p className="text-sm text-muted-foreground">{timezone}</p>
			</div>
			{actions ? (
				<div className="flex max-w-full flex-wrap gap-2">
					<Button
						type="button"
						disabled={!actions.enabled}
						onClick={() => actions.open("opening")}
						className="h-auto min-h-9 whitespace-normal"
					>
						<IconFlag className="size-4 shrink-0" aria-hidden="true" />
						{t("settings.employees.workBalance.setOpeningBalance", "Set opening balance")}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={!actions.enabled}
						onClick={() => actions.open("payout")}
						className="h-auto min-h-9 whitespace-normal"
					>
						<IconCash className="size-4 shrink-0" aria-hidden="true" />
						{t("settings.employees.workBalance.recordPayout", "Record overtime payout")}
					</Button>
				</div>
			) : null}
		</section>
	);
}
