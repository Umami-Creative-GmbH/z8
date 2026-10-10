"use client";

import { IconCash, IconLoader2, IconScale } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	BalanceAdjustmentHistory,
	useBalanceAdjustmentLabels,
} from "@/components/work-balance/balance-adjustment-history";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "@/lib/work-balance/format";
import { CancelBalanceAdjustmentDialog } from "./cancel-balance-adjustment-dialog";
import { RecordOvertimePayoutDialog } from "./record-overtime-payout-dialog";
import { isRefusal, useEmployeeWorkBalance } from "./use-employee-work-balance";

/**
 * The Work balance section of an employee's settings page (#993): the current
 * work balance, the history of balance adjustments, and recording and
 * cancelling overtime payouts. Owners and admins, and payroll grant holders
 * on the payroll area's Work balances page (#995), record and cancel; managers
 * see it read-only for the employees they manage (#996). The server decides:
 * a viewer it refuses sees nothing.
 */
export function EmployeeWorkBalanceSection({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const label = useBalanceAdjustmentLabels();
	const { section, recordPayout, cancelAdjustment } = useEmployeeWorkBalance(employeeId);
	const [isRecording, setIsRecording] = useState(false);
	const [cancelling, setCancelling] = useState<{ id: string; summary: string } | null>(null);
	const data = section.data;
	const balance = data?.balance ?? null;
	const status = balance ? getWorkBalanceStatus(balance.balanceMinutes) : "neutral";
	const canManage = data?.canManage ?? false;

	// A manager without the manager relation to this employee is refused by the server.
	if (section.isError && isRefusal(section.error) && section.error.code === "not_permitted") {
		return null;
	}

	return (
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
				<div className="space-y-1.5">
					<CardTitle className="flex items-center gap-2">
						<IconScale className="size-5" aria-hidden="true" />
						{t("settings.employees.workBalance.title", "Work balance")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.employees.workBalance.description",
							"Completed work minus required time, together with overtime payouts. Payouts are never edited: a mistaken one is cancelled.",
						)}
					</CardDescription>
				</div>
				{canManage ? (
					<Button type="button" variant="outline" onClick={() => setIsRecording(true)}>
						<IconCash className="size-4" aria-hidden="true" />
						{t("settings.employees.workBalance.recordPayout", "Record overtime payout")}
					</Button>
				) : null}
			</CardHeader>
			<CardContent className="space-y-6">
				{section.isLoading ? (
					<output
						className="flex items-center justify-center p-6"
						aria-label={t("settings.employees.workBalance.loading", "Loading work balance")}
					>
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
					</output>
				) : section.isError ? (
					<p role="alert" className="text-destructive text-sm">
						{t(
							"settings.employees.workBalance.loadFailed",
							"The work balance could not be loaded.",
						)}
					</p>
				) : (
					<>
						<div className="space-y-1">
							<p className="text-muted-foreground text-sm">
								{t("settings.employees.workBalance.current", "Current work balance")}
							</p>
							<p
								className={cn(
									"font-semibold text-2xl tabular-nums",
									status === "positive" && "text-emerald-600 dark:text-emerald-400",
									status === "negative" && "text-destructive",
								)}
							>
								{balance
									? formatSignedWorkBalance(balance.balanceMinutes)
									: t("workBalance.notCalculated", "Not calculated yet")}
							</p>
							{balance ? (
								<p className="text-muted-foreground text-xs">
									{t("settings.employees.workBalance.through", "Through {date}", {
										date: label.day(balance.computedThroughDate),
									})}
								</p>
							) : null}
						</div>

						<section className="space-y-3" aria-labelledby={`work-balance-history-${employeeId}`}>
							<h3 id={`work-balance-history-${employeeId}`} className="font-medium text-sm">
								{t("settings.employees.workBalance.history", "Balance adjustments")}
							</h3>
							<BalanceAdjustmentHistory
								adjustments={data?.adjustments ?? []}
								onCancel={
									canManage
										? (adjustment) =>
												setCancelling({
													id: adjustment.id,
													summary: `${label.kind(adjustment)} ${formatSignedWorkBalance(adjustment.minutes)}, ${label.day(adjustment.day)}`,
												})
										: undefined
								}
							/>
						</section>
					</>
				)}
			</CardContent>

			{data?.canManage ? (
				<RecordOvertimePayoutDialog
					open={isRecording}
					onOpenChange={setIsRecording}
					today={data.today}
					onRecord={(input) => recordPayout.mutateAsync(input)}
				/>
			) : null}
			<CancelBalanceAdjustmentDialog
				adjustment={cancelling}
				onOpenChange={(open) => {
					if (!open) setCancelling(null);
				}}
				onCancelAdjustment={(input) => cancelAdjustment.mutateAsync(input)}
			/>
		</Card>
	);
}
