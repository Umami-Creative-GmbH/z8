"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconClock,
	IconDownload,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo, useTransition } from "react";
import { Temporal } from "temporal-polyfill";
import { toast } from "sonner";
import {
	discardPayrollRunAction,
	getExportDownloadUrlAction,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { DiscardPayrollRunButton } from "@/components/payroll/discard-payroll-run-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type { PayrollExportJobSummary } from "@/lib/payroll-export/types";

interface ExportHistoryProps {
	exports: PayrollExportJobSummary[];
	/** The organization's resolved IANA time zone: export times are shown in it. */
	organizationTimezone: string;
}

/**
 * An export's range is logical payroll dates (the first ten characters of each
 * stored bound), not instants: a whole calendar month shows as that month, any
 * other range as its dates, both in the reader's locale.
 */
export function formatPayrollExportRange(
	filters: PayrollExportJobSummary["filters"],
	locale: string,
): string {
	const startValue = String(filters.dateRange.start).slice(0, 10);
	const endValue = String(filters.dateRange.end).slice(0, 10);
	let start: Temporal.PlainDate;
	let end: Temporal.PlainDate;
	try {
		start = Temporal.PlainDate.from(startValue);
		end = Temporal.PlainDate.from(endValue);
	} catch {
		return `${startValue} – ${endValue}`;
	}

	const month = start.toPlainYearMonth();
	if (start.day === 1 && end.equals(month.toPlainDate({ day: month.daysInMonth }))) {
		return formatPlainDate(start, locale, "monthYear");
	}
	if (Temporal.PlainDate.compare(start, end) > 0) {
		return `${formatPlainDate(start, locale, "dateMedium")} – ${formatPlainDate(end, locale, "dateMedium")}`;
	}
	return formatPlainDateRange(start, end, locale, "dateMedium");
}

/** When an export was requested: an audit instant, in the organization's zone, zone named. */
export function createPayrollExportTimeFormatter(locale: string, timeZone: string) {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
		timeZoneName: "short",
	};
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat(locale, options);
	} catch {
		formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
	}
	return (createdAt: Date | string) =>
		formatter.format(instantFromDate(new Date(createdAt)).epochMilliseconds);
}

function formatFileSize(bytes: number | null) {
	if (!bytes) return "-";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportHistory({ exports, organizationTimezone }: ExportHistoryProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const formatCreatedAt = useMemo(
		() => createPayrollExportTimeFormatter(locale, organizationTimezone),
		[locale, organizationTimezone],
	);
	const [isPending, startTransition] = useTransition();

	const handleDownload = async (jobId: string) => {
		startTransition(async () => {
			const result = await getExportDownloadUrlAction({ jobId });

			if (result.success && result.data) {
				window.open(result.data, "_blank", "noopener,noreferrer");
			} else {
				toast.error(
					t(
						"settings.payrollExport.history.downloadError",
						"Failed to get download URL",
					),
				);
			}
		});
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "completed":
				return (
					<Badge className="gap-1">
						<IconCheck className="size-3" aria-hidden="true" />
						{t("settings.payrollExport.history.status.completed", "Completed")}
					</Badge>
				);
			case "processing":
				return (
					<Badge variant="secondary" className="gap-1">
						<IconLoader2 className="size-3 animate-spin" aria-hidden="true" />
						{t(
							"settings.payrollExport.history.status.processing",
							"Processing",
						)}
					</Badge>
				);
			case "pending":
				return (
					<Badge variant="outline" className="gap-1">
						<IconClock className="size-3" aria-hidden="true" />
						{t("settings.payrollExport.history.status.pending", "Pending")}
					</Badge>
				);
			case "failed":
				return (
					<Badge variant="destructive" className="gap-1">
						<IconX className="size-3" aria-hidden="true" />
						{t("settings.payrollExport.history.status.failed", "Failed")}
					</Badge>
				);
			default:
				return <Badge variant="outline">{status}</Badge>;
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.payrollExport.history.title", "Export History")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.payrollExport.history.descriptionAllFormats",
						"View and download previous payroll exports",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{exports.length === 0 ? (
					<div className="space-y-1 py-8 text-center text-sm">
						<p className="font-medium">
							{t("settings.payrollExport.history.noExports", "No exports yet")}
						</p>
						<p className="text-muted-foreground">
							{t(
								"settings.payrollExport.history.noExportsHint",
								"Start a payroll export on the Export tab. Finished exports appear here for download.",
							)}
						</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t(
										"settings.payrollExport.history.table.dateRange",
										"Date Range",
									)}
								</TableHead>
								<TableHead>
									{t("settings.payrollExport.history.table.status", "Status")}
								</TableHead>
								<TableHead>
									{t("settings.payrollExport.history.table.records", "Records")}
								</TableHead>
								<TableHead>
									{t("settings.payrollExport.history.table.size", "Size")}
								</TableHead>
								<TableHead>
									{t(
										"settings.payrollExport.history.table.createdAt",
										"Created",
									)}
								</TableHead>
								<TableHead className="w-[100px]">
									<span className="sr-only">
										{t("settings.payrollExport.history.table.actions", "Actions")}
									</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{exports.map((exp) => (
								<TableRow key={exp.id}>
									<TableCell className="font-medium">
										{formatPayrollExportRange(exp.filters, locale)}
									</TableCell>
									<TableCell>{getStatusBadge(exp.status)}</TableCell>
									<TableCell className="tabular-nums">
										{exp.workPeriodCount !== null ? (
											<span>
												{exp.workPeriodCount}{" "}
												{t("settings.payrollExport.history.periods", "periods")}
												{exp.employeeCount !== null && (
													<span className="text-muted-foreground">
														{" "}
														({exp.employeeCount}{" "}
														{t(
															"settings.payrollExport.history.employees",
															"employees",
														)}
														)
													</span>
												)}
											</span>
										) : (
											"-"
										)}
										{exp.payrollRunIncludedReports > 0 && (
											<Badge variant="outline" className="ml-2">
												{t(
													"settings.payrollExport.history.payrollRun",
													"Payroll run: {count, plural, one {# expense report} other {# expense reports}}",
													{ count: exp.payrollRunIncludedReports },
												)}
											</Badge>
										)}
										{exp.unmappedOvertimePayoutCount > 0 && (
											<Badge
												variant="outline"
												className="ml-2 gap-1 border-warning/50 text-warning"
											>
												<IconAlertTriangle className="size-3" aria-hidden="true" />
												{t(
													"settings.payrollExport.history.unmappedOvertimePayouts",
													"{count, plural, one {# overtime payout} other {# overtime payouts}} not exported: no wage type for Overtime",
													{ count: exp.unmappedOvertimePayoutCount },
												)}
											</Badge>
										)}
									</TableCell>
									<TableCell className="tabular-nums">
										{formatFileSize(exp.fileSizeBytes)}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										<time dateTime={new Date(exp.createdAt).toISOString()}>
											{formatCreatedAt(exp.createdAt)}
										</time>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-1">
											{exp.payrollRunIncludedReports > 0 && (
												<DiscardPayrollRunButton
													includedReports={exp.payrollRunIncludedReports}
													discard={() => discardPayrollRunAction({ jobId: exp.id })}
												/>
											)}
											{exp.status === "completed" && exp.fileName && (
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDownload(exp.id)}
													disabled={isPending}
													aria-label={t(
														"settings.payrollExport.history.download",
														"Download export",
													)}
												>
													{isPending ? (
														<IconLoader2 className="size-4 animate-spin" />
													) : (
														<IconDownload className="size-4" />
													)}
												</Button>
											)}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
