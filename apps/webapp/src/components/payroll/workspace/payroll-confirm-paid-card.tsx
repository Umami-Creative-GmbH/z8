"use client";

import { IconCircleCheck, IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	confirmPayrollExportPaidAction,
	getPayrollExportsToConfirmAction,
	type PayrollSettlementCounts,
	previewConfirmPayrollExportPaidAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { PayrollExportToConfirm } from "@/lib/payroll-period/export-confirmation";
import { queryKeys } from "@/lib/query/keys";
import { formatPlainDateRange } from "@/lib/travel-expenses/format";
import { SettlePreview } from "./payroll-settlement-card";
import type { PayrollTranslate } from "./state";

/**
 * Confirming a completed payroll export as paid (#1899): settles exactly the
 * employee-days the file carried, after a preview with the counts and a warning for
 * months that are not closed. Confirming an export again settles nothing new.
 */
export function PayrollConfirmPaidCard({ t }: { t: PayrollTranslate }) {
	const locale = useLocale();
	const queryClient = useQueryClient();
	const { data: exports } = useQuery({
		queryKey: queryKeys.payroll.exportsToConfirm(),
		queryFn: async () => {
			const result = await getPayrollExportsToConfirmAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const [selected, setSelected] = useState<PayrollExportToConfirm | null>(null);
	const [preview, setPreview] = useState<PayrollSettlementCounts | null>(null);
	const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
	const [isConfirming, setIsConfirming] = useState(false);

	function close() {
		setSelected(null);
		setPreview(null);
	}

	async function openPreview(exportToConfirm: PayrollExportToConfirm) {
		setLoadingJobId(exportToConfirm.jobId);
		try {
			const result = await previewConfirmPayrollExportPaidAction(exportToConfirm.jobId);
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			setSelected(exportToConfirm);
			setPreview(result.data);
		} finally {
			setLoadingJobId(null);
		}
	}

	async function confirm() {
		if (!selected) return;
		setIsConfirming(true);
		try {
			const result = await confirmPayrollExportPaidAction(selected.jobId);
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t("payroll.confirmPaid.confirmed", "{count} days settled", {
					count: result.data.newDays,
				}),
			);
			close();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.payroll.exportsToConfirm() }),
				queryClient.invalidateQueries({ queryKey: ["payroll", "period"] }),
			]);
		} finally {
			setIsConfirming(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t("payroll.confirmPaid.title", "Confirm exports as paid")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.confirmPaid.description",
						"Once payroll has paid a file, confirm it here. Every employee-day the file carried becomes settled, with the values it carried, and later files leave those days out.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{exports && exports.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("payroll.confirmPaid.empty", "No completed payroll files to confirm yet.")}
					</p>
				) : (
					<ul className="divide-y">
						{(exports ?? []).map((exportToConfirm) => {
							const paid = exportToConfirm.settledDays >= exportToConfirm.carriedDays;
							return (
								<li
									key={exportToConfirm.jobId}
									className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<p className="font-medium tabular-nums">
											{formatPlainDateRange(
												locale,
												exportToConfirm.startDate,
												exportToConfirm.endDate,
											)}
										</p>
										<p className="truncate text-muted-foreground text-sm">
											{exportToConfirm.fileName ? `${exportToConfirm.fileName} · ` : null}
											{t("payroll.confirmPaid.progress", "{settled} of {carried} days settled", {
												settled: exportToConfirm.settledDays,
												carried: exportToConfirm.carriedDays,
											})}
										</p>
									</div>
									{paid ? (
										<Badge variant="secondary" className="self-start sm:self-center">
											<IconCircleCheck aria-hidden="true" className="size-3.5" />
											{t("payroll.confirmPaid.paid", "Settled")}
										</Badge>
									) : (
										<Button
											type="button"
											variant="outline"
											disabled={loadingJobId !== null || isConfirming}
											onClick={() => void openPreview(exportToConfirm)}
										>
											{loadingJobId === exportToConfirm.jobId ? (
												<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
											) : (
												<IconCircleCheck aria-hidden="true" className="size-4" />
											)}
											{t("payroll.confirmPaid.action", "Confirm as paid…")}
										</Button>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>

			<Dialog open={preview !== null} onOpenChange={(open) => !open && close()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t("payroll.confirmPaid.confirmTitle", "Confirm this export as paid?")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"payroll.confirmPaid.confirmDescription",
								"This records that the employee-days the file of {period} carried have been paid, with the hours and absences it carried.",
								{
									period: selected
										? formatPlainDateRange(locale, selected.startDate, selected.endDate)
										: "",
								},
							)}
						</DialogDescription>
					</DialogHeader>
					{preview ? <SettlePreview preview={preview} t={t} /> : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={close}>
							{t("payroll.settle.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							disabled={isConfirming || !preview || preview.newDays === 0}
							onClick={() => void confirm()}
						>
							{isConfirming ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : null}
							{t("payroll.confirmPaid.confirm", "Settle {count} days", {
								count: preview?.newDays ?? 0,
							})}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
