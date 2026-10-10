"use client";

import { IconLoader2, IconReceiptOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import type { ServerActionResult } from "@/lib/effect/result";
import type { DiscardPayrollRunResult } from "@/lib/travel-expenses/payroll-run";

/**
 * Discards an unconfirmed payroll run (#852) after an explicit confirmation:
 * the expense reports it includes are freed for the next export or a bank
 * transfer. Shown wherever the run's export is listed for someone who may
 * start payroll exports.
 */
export function DiscardPayrollRunButton({
	includedReports,
	discard,
	onDiscarded,
}: {
	includedReports: number;
	discard: () => Promise<ServerActionResult<DiscardPayrollRunResult>>;
	onDiscarded?: () => void;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const label = t("payroll.run.discard.action", "Discard payroll run");

	async function confirm() {
		setPending(true);
		try {
			const result = await discard();
			if (result.success && result.data.status === "discarded") {
				toast.success(
					t(
						"payroll.run.discard.done",
						"Payroll run discarded. Its expense reports await reimbursement again.",
					),
				);
				onDiscarded?.();
				router.refresh();
			} else if (result.success && result.data.status === "out_of_scope") {
				toast.error(
					t(
						"payroll.run.discard.outOfScope",
						"This payroll run includes employees outside your payroll scope.",
					),
				);
			} else if (result.success) {
				toast.error(
					t("payroll.run.discard.notFound", "This payroll run no longer includes any reports."),
				);
				router.refresh();
			} else {
				toast.error(t("payroll.run.discard.failed", "The payroll run could not be discarded."));
			}
		} catch {
			toast.error(t("payroll.run.discard.failed", "The payroll run could not be discarded."));
		}
		setPending(false);
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={pending}
					aria-label={label}
					title={label}
				>
					{pending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconReceiptOff aria-hidden="true" className="size-4" />
					)}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("payroll.run.discard.title", "Discard this payroll run?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"payroll.run.discard.description",
							"The {count, plural, one {# expense report} other {# expense reports}} it includes will await reimbursement again: the next payroll export or a bank transfer can take them. Discard it only if this file is not paid with payroll.",
							{ count: includedReports },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						onClick={() => void confirm()}
					>
						{label}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
