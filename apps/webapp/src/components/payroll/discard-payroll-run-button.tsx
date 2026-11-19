"use client";

import { IconLoader2, IconReceiptOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
	ConfirmActionDialog,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
import { describeFailure } from "@/components/settings/confirm-action-utils";
import { Button } from "@/components/ui/button";
import type { ServerActionResult } from "@/lib/effect/result";
import type { DiscardPayrollRunResult } from "@/lib/travel-expenses/payroll-run";

/**
 * Discards an unconfirmed payroll run (#852) after an explicit confirmation:
 * the expense reports it includes are freed for the next export or a bank
 * transfer. Shown wherever the run's export is listed for someone who may
 * start payroll exports. The confirmation stays open while the discard runs
 * and shows why it was refused inline.
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
	const discarding = useConfirmedAction<"run">();
	const label = t("payroll.run.discard.action", "Discard payroll run");
	const failed = t("payroll.run.discard.failed", "The payroll run could not be discarded.");

	/** Resolves once the run is discarded and throws the worded refusal otherwise. */
	async function confirm() {
		const result = await discard().catch(() => null);
		if (!result?.success) throw new Error(failed);
		switch (result.data.status) {
			case "discarded":
				toast.success(
					t(
						"payroll.run.discard.done",
						"Payroll run discarded. Its expense reports await reimbursement again.",
					),
				);
				onDiscarded?.();
				router.refresh();
				return;
			case "out_of_scope":
				throw new Error(
					t(
						"payroll.run.discard.outOfScope",
						"This payroll run includes employees outside your payroll scope.",
					),
				);
			case "confirmed":
				router.refresh();
				throw new Error(
					t(
						"payroll.run.discard.confirmed",
						"This payroll run is already confirmed as paid for some reports, so it can no longer be discarded. Remove single reports from it instead.",
					),
				);
			default:
				router.refresh();
				throw new Error(
					t("payroll.run.discard.notFound", "This payroll run no longer includes any reports."),
				);
		}
	}

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				disabled={discarding.isPending}
				aria-label={label}
				title={label}
				onClick={() => discarding.request("run")}
			>
				{discarding.isPending ? (
					<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
				) : (
					<IconReceiptOff aria-hidden="true" className="size-4" />
				)}
			</Button>
			<ConfirmActionDialog
				open={discarding.open}
				onOpenChange={discarding.onOpenChange}
				title={t("payroll.run.discard.title", "Discard this payroll run?")}
				description={t(
					"payroll.run.discard.description",
					"The {count, plural, one {# expense report} other {# expense reports}} it includes will await reimbursement again: the next payroll export or a bank transfer can take them. Discard it only if this file is not paid with payroll.",
					{ count: includedReports },
				)}
				confirmLabel={label}
				isPending={discarding.isPending}
				error={discarding.error}
				onConfirm={() =>
					void discarding.confirm(confirm, (failure) => describeFailure(failure, failed))
				}
			/>
		</>
	);
}
