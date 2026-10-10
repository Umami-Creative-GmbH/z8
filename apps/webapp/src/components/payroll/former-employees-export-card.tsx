"use client";

import { IconChevronLeft, IconChevronRight, IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	getPayrollExportScopeAction,
	type PayrollExportFormatOption,
	startScopedPayrollExportAction,
} from "@/app/[locale]/(app)/payroll/actions";
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
import { queryKeys } from "@/lib/query/keys";
import { OvertimePayoutReadinessAlert } from "./overtime-payout-readiness-alert";

/** The month's payroll request: its first and last day and its display label. */
function monthRequest(month: Temporal.PlainYearMonth, locale: string) {
	const first = month.toPlainDate({ day: 1 });
	return {
		startDate: first.toString(),
		endDate: month.toPlainDate({ day: month.daysInMonth }).toString(),
		label: first.toLocaleString(locale, { month: "long", year: "numeric" }),
	};
}

/**
 * The payroll export of a grant that covers only employees who have left
 * (#1001): a month in which any of them was still employed exports their last
 * hours and final overtime payouts. Shown beside #995's Work balances link.
 */
export function FormerEmployeesExportCard({
	initialMonth,
	exportFormats,
}: {
	/** ISO year-month, e.g. "2026-07". */
	initialMonth: string;
	exportFormats: PayrollExportFormatOption[];
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [month, setMonth] = useState(() => Temporal.PlainYearMonth.from(initialMonth));
	const [formatId, setFormatId] = useState(exportFormats[0]?.id ?? "");
	const [isPending, startTransition] = useTransition();
	const request = monthRequest(month, locale);

	const { data: scope } = useQuery({
		queryKey: queryKeys.payroll.exportScope(request),
		queryFn: async () => {
			const result = await getPayrollExportScopeAction(request);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const nobodyEmployed = scope?.employeeCount === 0;

	function triggerExport() {
		startTransition(async () => {
			const result = await startScopedPayrollExportAction({ ...request, formatId });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			if (result.data.fileContent) {
				const url = window.URL.createObjectURL(
					new Blob([result.data.fileContent], { type: "text/csv;charset=utf-8" }),
				);
				const link = document.createElement("a");
				link.href = url;
				link.download = `${formatId}_${request.startDate}_${request.endDate}.csv`;
				document.body.appendChild(link);
				link.click();
				link.remove();
				window.URL.revokeObjectURL(url);
			}
			toast.success(
				result.data.isAsync
					? t("payroll.export.queued", "Payroll export queued")
					: t("payroll.export.completed", "Payroll export completed"),
			);
			if (result.data.unmappedOvertimePayoutCount) {
				toast.warning(
					t(
						"payroll.export.unmappedOvertimePayouts",
						"{count, plural, one {# overtime payout was} other {# overtime payouts were}} not exported",
						{ count: result.data.unmappedOvertimePayoutCount },
					),
				);
			}
		});
	}

	return (
		<Card className="max-w-md text-left">
			<CardHeader>
				<CardTitle>
					{t("payroll.formerEmployeesExport.title", "Export payroll for employees who have left")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.formerEmployeesExport.description",
						"Export a month in which any of them was still employed: their last hours and final overtime payouts go into the file.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between gap-2">
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label={t("payroll.formerEmployeesExport.previousMonth", "Previous month")}
						disabled={isPending}
						onClick={() => setMonth((current) => current.subtract({ months: 1 }))}
					>
						<IconChevronLeft aria-hidden="true" className="size-4" />
					</Button>
					<p className="font-medium" aria-live="polite">
						{request.label}
					</p>
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label={t("payroll.formerEmployeesExport.nextMonth", "Next month")}
						disabled={isPending}
						onClick={() => setMonth((current) => current.add({ months: 1 }))}
					>
						<IconChevronRight aria-hidden="true" className="size-4" />
					</Button>
				</div>
				{exportFormats.length > 0 ? (
					<div className="space-y-1">
						<Label htmlFor="former-employees-export-format">
							{t("payroll.export.target", "Payroll export target")}
						</Label>
						<Select value={formatId} onValueChange={setFormatId} disabled={isPending}>
							<SelectTrigger id="former-employees-export-format" className="w-full">
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
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						{t("payroll.export.noConfiguredTarget", "No configured payroll export target")}
					</p>
				)}
				{nobodyEmployed ? (
					<p className="text-muted-foreground text-sm">
						{t(
							"payroll.export.nobodyEmployedInPeriod",
							"No one in your payroll access was employed in this period.",
						)}
					</p>
				) : formatId ? (
					<OvertimePayoutReadinessAlert request={{ ...request, formatId }} />
				) : null}
				<Button
					type="button"
					className="w-full"
					disabled={isPending || !formatId || scope === undefined || nobodyEmployed}
					onClick={triggerExport}
				>
					<IconDownload aria-hidden="true" className="size-4" />
					{t("payroll.formerEmployeesExport.export", "Export")}
				</Button>
			</CardContent>
		</Card>
	);
}
