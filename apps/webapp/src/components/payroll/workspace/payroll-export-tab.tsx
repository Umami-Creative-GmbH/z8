"use client";

import { IconDownload, IconFileExport, IconLoader2 } from "@tabler/icons-react";
import type React from "react";
import type { PayrollExportFormatOption } from "@/app/[locale]/(app)/payroll/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { isSupportedPayrollFormat } from "@/lib/payroll-export/supported-format";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { PayrollBaselinesCard } from "../payroll-baselines-card";
import { PayrollComparisonCard } from "../payroll-comparison-card";
import { PayrollRunsCard } from "../payroll-runs-card";
import { PayrollConfirmPaidCard } from "./payroll-confirm-paid-card";
import { PayrollSettlementCard } from "./payroll-settlement-card";
import type { PayrollPeriodRequest, PayrollTranslate, PayrollWorkspaceAction } from "./state";

/**
 * The Export tab: everything that leaves Z8. The export format, the PDF download,
 * starting an export, confirming an export as paid, settling days, unconfirmed payroll
 * runs, baselines and comparison.
 */
export function PayrollExportTab({
	dispatch,
	exportFormats,
	filteredEmployeeIds,
	filtersHaveNoMatches,
	formatId,
	isPending,
	onDownloadPdf,
	onTriggerExport,
	period,
	refreshedAt,
	request,
	t,
}: {
	dispatch: React.Dispatch<PayrollWorkspaceAction>;
	exportFormats: PayrollExportFormatOption[];
	filteredEmployeeIds: string[] | undefined;
	filtersHaveNoMatches: boolean;
	formatId: string;
	isPending: boolean;
	onDownloadPdf: () => void;
	onTriggerExport: () => void;
	period: PayrollWorkspaceSummary["period"];
	refreshedAt: string;
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	const hasExportFormats = exportFormats.length > 0;
	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle role="heading" aria-level={2}>
						{t("payroll.export.title", "Export payroll")}
					</CardTitle>
					<CardDescription>
						{t(
							"payroll.export.notPayment",
							"Export prepares payroll data. It does not make a payment.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent
					data-payroll-export-controls=""
					className="grid gap-4 md:grid-cols-[minmax(0,22rem)_auto] md:items-end"
				>
					<div className="flex min-w-0 flex-col gap-2">
						<Label htmlFor="payroll-export-target">
							{t("payroll.export.target", "Payroll export target")}
						</Label>
						<Select
							value={formatId}
							onValueChange={(formatId) => dispatch({ type: "formatChanged", formatId })}
							disabled={!hasExportFormats || isPending}
						>
							<SelectTrigger id="payroll-export-target" className="w-full">
								<SelectValue placeholder={t("payroll.export.selectFormat", "Select format")} />
							</SelectTrigger>
							<SelectContent>
								{exportFormats.map((format) => (
									<SelectItem key={format.id} value={format.id}>
										{format.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{!hasExportFormats ? (
							<p className="text-muted-foreground text-sm">
								{t("payroll.export.noConfiguredTarget", "No configured payroll export target")}
							</p>
						) : null}
					</div>

					<div className="grid gap-2 sm:grid-cols-2 md:flex">
						<Button
							type="button"
							variant="outline"
							className="justify-center"
							disabled={isPending || filtersHaveNoMatches}
							onClick={onDownloadPdf}
						>
							{isPending ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconDownload aria-hidden="true" className="size-4" />
							)}
							{t("payroll.actions.downloadPdf", "Download PDF")}
						</Button>

						<Button
							type="button"
							className="justify-center"
							disabled={!hasExportFormats || isPending || filtersHaveNoMatches}
							onClick={onTriggerExport}
						>
							{isPending ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconFileExport aria-hidden="true" className="size-4" />
							)}
							{t("payroll.actions.triggerExport", "Trigger export")}
						</Button>
					</div>
				</CardContent>
			</Card>
			<PayrollConfirmPaidCard t={t} />
			<PayrollSettlementCard
				filtersHaveNoMatches={filtersHaveNoMatches}
				refreshedAt={refreshedAt}
				request={request}
				t={t}
			/>
			<PayrollRunsCard />
			<PayrollBaselinesCard
				key={formatId}
				formatId={formatId}
				startDate={period.start}
				endDate={period.end}
			/>
			{isSupportedPayrollFormat(formatId) ? (
				<PayrollComparisonCard
					formatId={formatId}
					startDate={period.start}
					endDate={period.end}
					employeeIds={filteredEmployeeIds}
				/>
			) : null}
		</div>
	);
}
