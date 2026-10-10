"use client";

import { IconCash, IconFlag, IconLoader2, IconScale } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatInstant, formatPlainDate } from "@/lib/datetime/temporal-format";
import { cn } from "@/lib/utils";
import type { BalanceAdjustmentView } from "@/lib/work-balance/adjustments/types";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "@/lib/work-balance/format";
import { CancelBalanceAdjustmentDialog } from "./cancel-balance-adjustment-dialog";
import { RecordOvertimePayoutDialog } from "./record-overtime-payout-dialog";
import { SetOpeningBalanceDialog } from "./set-opening-balance-dialog";
import { useEmployeeWorkBalance } from "./use-employee-work-balance";

/**
 * The Work balance section of an employee's settings page (#993): the current
 * work balance, the history of balance adjustments, and recording and
 * cancelling overtime payouts and opening balances (#997). Render it only for organization owners and
 * admins, and on the payroll area's Work balances page for payroll grant
 * holders (#995); the actions refuse everyone else.
 */
export function EmployeeWorkBalanceSection({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const { section, recordPayout, setOpeningBalance, cancelAdjustment } =
		useEmployeeWorkBalance(employeeId);
	const [isRecording, setIsRecording] = useState(false);
	const [isSettingOpeningBalance, setIsSettingOpeningBalance] = useState(false);
	const [cancelling, setCancelling] = useState<{ id: string; summary: string } | null>(null);
	const data = section.data;
	const balance = data?.balance ?? null;
	const hasOpeningBalance =
		data?.adjustments.some(
			(adjustment) => adjustment.kind === "opening_balance" && !adjustment.cancellation,
		) ?? false;
	const status = balance ? getWorkBalanceStatus(balance.balanceMinutes) : "neutral";

	const formatDay = (day: string) =>
		formatPlainDate(parsePlainDate(day), displayContext.locale, "dateMedium");
	const formatRecordedAt = (instant: string) =>
		formatInstant(parseInstant(instant), displayContext, "dateTimeMedium");
	const kindLabel = (adjustment: BalanceAdjustmentView) =>
		adjustment.kind === "overtime_payout"
			? t("settings.employees.workBalance.kind.overtimePayout", "Overtime payout")
			: t("settings.employees.workBalance.kind.openingBalance", "Opening balance");

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
							"Completed work minus required time, together with the opening balance and overtime payouts. Adjustments are never edited: a mistaken one is cancelled.",
						)}
					</CardDescription>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => setIsSettingOpeningBalance(true)}
						disabled={!data}
					>
						<IconFlag className="size-4" aria-hidden="true" />
						{t("settings.employees.workBalance.setOpeningBalance", "Set opening balance")}
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => setIsRecording(true)}
						disabled={!data}
					>
						<IconCash className="size-4" aria-hidden="true" />
						{t("settings.employees.workBalance.recordPayout", "Record overtime payout")}
					</Button>
				</div>
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
										date: formatDay(balance.computedThroughDate),
									})}
								</p>
							) : null}
						</div>

						<section className="space-y-3" aria-labelledby={`work-balance-history-${employeeId}`}>
							<h3 id={`work-balance-history-${employeeId}`} className="font-medium text-sm">
								{t("settings.employees.workBalance.history", "Balance adjustments")}
							</h3>
							{data && data.adjustments.length > 0 ? (
								<ul className="divide-y rounded-md border">
									{data.adjustments.map((adjustment) => (
										<li
											key={adjustment.id}
											className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
										>
											<div
												className={cn("min-w-0 space-y-1", adjustment.cancellation && "opacity-70")}
											>
												<div className="flex flex-wrap items-center gap-2">
													<span className="font-medium text-sm">{kindLabel(adjustment)}</span>
													<span
														className={cn(
															"text-sm tabular-nums",
															adjustment.cancellation && "line-through",
														)}
													>
														{formatSignedWorkBalance(adjustment.minutes)}
													</span>
													<span className="text-muted-foreground text-sm">
														{formatDay(adjustment.day)}
													</span>
													{adjustment.cancellation ? (
														<Badge variant="outline">
															{t("settings.employees.workBalance.cancelled", "Cancelled")}
														</Badge>
													) : null}
												</div>
												<p className="break-words text-sm">{adjustment.reason}</p>
												<p className="text-muted-foreground text-xs">
													{t(
														"settings.employees.workBalance.recordedBy",
														"Recorded by {name} on {date}",
														{
															name:
																adjustment.recordedBy.name ||
																t("settings.employees.workBalance.unknownUser", "a deleted user"),
															date: formatRecordedAt(adjustment.recordedAt),
														},
													)}
												</p>
												{adjustment.cancellation ? (
													<p className="text-muted-foreground text-xs">
														{t(
															"settings.employees.workBalance.cancelledBy",
															"Cancelled by {name} on {date}: {reason}",
															{
																name:
																	adjustment.cancellation.cancelledBy.name ||
																	t("settings.employees.workBalance.unknownUser", "a deleted user"),
																date: formatRecordedAt(adjustment.cancellation.cancelledAt),
																reason: adjustment.cancellation.reason,
															},
														)}
													</p>
												) : null}
											</div>
											{adjustment.cancellation ? null : (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="self-start"
													onClick={() =>
														setCancelling({
															id: adjustment.id,
															summary: `${kindLabel(adjustment)} ${formatSignedWorkBalance(adjustment.minutes)}, ${formatDay(adjustment.day)}`,
														})
													}
												>
													{t("settings.employees.workBalance.cancel", "Cancel")}
												</Button>
											)}
										</li>
									))}
								</ul>
							) : (
								<p className="text-muted-foreground text-sm">
									{t("settings.employees.workBalance.empty", "No balance adjustments yet.")}
								</p>
							)}
						</section>
					</>
				)}
			</CardContent>

			{data ? (
				<SetOpeningBalanceDialog
					open={isSettingOpeningBalance}
					onOpenChange={setIsSettingOpeningBalance}
					today={data.today}
					replacesCurrent={hasOpeningBalance}
					onSet={(input) => setOpeningBalance.mutateAsync(input)}
				/>
			) : null}
			{data ? (
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
