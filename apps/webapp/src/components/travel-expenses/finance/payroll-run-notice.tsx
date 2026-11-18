"use client";

import { IconLoader2, IconReceipt2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { removeTravelExpenseFromPayrollRunAction } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { IncludedPayrollRun } from "@/lib/travel-expenses/payroll-run-inclusion-read";
import { formatPlainDateRange } from "../report/format";
import { useFinanceCommand } from "./use-finance-command";

/** The payroll run of a report as officers read it: its period and file format. */
export function payrollRunLabel(
	t: ReturnType<typeof useTranslate>["t"],
	locale: string,
	run: IncludedPayrollRun,
): string {
	return t("travelExpenses.finance.payrollRun.label", "Payroll run {period} ({format})", {
		period: formatPlainDateRange(locale, run.periodStart, run.periodEnd),
		format: run.formatName,
	});
}

/**
 * Tells an officer that a payroll run includes the report (#852): it is paid
 * with that run, so nothing else can be recorded for it. An officer who
 * records reimbursements for it can remove it from the run first.
 */
export function PayrollRunNotice({
	reportId,
	run,
	canRemove,
	onRemoved,
}: {
	reportId: string;
	run: IncludedPayrollRun;
	canRemove: boolean;
	onRemoved: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const command = useFinanceCommand(`${reportId}:${run.jobId}`, open && canRemove);
	const pending = command.busy;
	const removeLabel = t("travelExpenses.finance.payrollRun.remove", "Remove from payroll run");

	async function remove() {
		const submission = command.reserve();
		if (!submission) return;
		setProblem(null);
		await removeTravelExpenseFromPayrollRunAction({ reportId })
			.then((result) => {
				if (!command.isCurrent(submission)) return;
				if (result.success && result.data.status === "removed") {
					toast.success(
						t(
							"travelExpenses.finance.payrollRun.removed",
							"Removed from the payroll run. The expense awaits reimbursement again.",
						),
					);
				} else if (result.success) {
					toast.info(
						t(
							"travelExpenses.finance.payrollRun.notIncluded",
							"No payroll run includes this expense any more.",
						),
					);
				} else {
					setProblem(
						t(
							"travelExpenses.finance.payrollRun.removeFailed",
							"The expense could not be removed from the payroll run.",
						),
					);
					return;
				}
				setOpen(false);
				onRemoved();
			})
			.catch(() => {
				if (command.isCurrent(submission))
					setProblem(
						t(
							"travelExpenses.finance.payrollRun.removeFailed",
							"The expense could not be removed from the payroll run.",
						),
					);
			})
			.finally(() => {
				command.release(submission);
			});
	}

	return (
		<div className="space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
			<p className="flex items-start gap-2">
				<IconReceipt2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				<span>
					{t(
						"travelExpenses.finance.payrollRun.included",
						"Included in {run}. It is paid with that payroll and recorded as reimbursed when the run is confirmed.",
						{ run: payrollRunLabel(t, locale, run) },
					)}
				</span>
			</p>
			{canRemove && (
				<AlertDialog
					open={open}
					onOpenChange={(next, details) => {
						if (command.isPending()) details.cancel();
						else setOpen(next);
					}}
				>
					<AlertDialogTrigger asChild>
						<Button type="button" variant="outline" size="sm" disabled={pending}>
							{pending && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
							{removeLabel}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{t(
									"travelExpenses.finance.payrollRun.removeTitle",
									"Remove this expense from the payroll run?",
								)}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{t(
									"travelExpenses.finance.payrollRun.removeDescription",
									"Remove it only if payroll will not pay it with this run, for example after correcting the payroll file. The removal is recorded in the audit log.",
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						{problem && (
							<p role="alert" className="text-sm text-destructive">
								{problem}
							</p>
						)}
						<AlertDialogFooter>
							<AlertDialogCancel disabled={pending}>
								{t("common.cancel", "Cancel")}
							</AlertDialogCancel>
							<Button disabled={pending} onClick={() => void remove()}>
								{removeLabel}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</div>
	);
}
