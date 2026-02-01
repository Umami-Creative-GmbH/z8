"use client";

import {
	IconCheck,
	IconClock,
	IconDownload,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useTransition } from "react";
import { toast } from "sonner";
import { getExportDownloadUrlAction } from "@/app/[locale]/(app)/settings/payroll-export/actions";
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
import type { PayrollExportJobSummary } from "@/lib/payroll-export/types";

interface ExportHistoryProps {
	organizationId: string;
	exports: PayrollExportJobSummary[];
}

export function ExportHistory({ organizationId, exports }: ExportHistoryProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();

	const handleDownload = async (jobId: string) => {
		startTransition(async () => {
			const result = await getExportDownloadUrlAction(organizationId, jobId);

			if (result.success && result.data) {
				window.open(result.data, "_blank");
			} else {
				toast.error(t("settings.payrollExport.history.downloadError", "Failed to get download URL"));
			}
		});
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "completed":
				return (
					<Badge variant="secondary" className="gap-1 bg-green-100 text-green-700">
						<IconCheck className="h-3 w-3" aria-hidden="true" />
						{t("settings.payrollExport.history.status.completed", "Completed")}
					</Badge>
				);
			case "processing":
				return (
					<Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700">
						<IconLoader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
						{t("settings.payrollExport.history.status.processing", "Processing")}
					</Badge>
				);
			case "pending":
				return (
					<Badge variant="secondary" className="gap-1">
						<IconClock className="h-3 w-3" aria-hidden="true" />
						{t("settings.payrollExport.history.status.pending", "Pending")}
					</Badge>
				);
			case "failed":
				return (
					<Badge variant="destructive" className="gap-1">
						<IconX className="h-3 w-3" aria-hidden="true" />
						{t("settings.payrollExport.history.status.failed", "Failed")}
					</Badge>
				);
			default:
				return <Badge variant="outline">{status}</Badge>;
		}
	};

	const formatDateRange = (filters: PayrollExportJobSummary["filters"]) => {
		const start = DateTime.fromISO(filters.dateRange.start);
		const end = DateTime.fromISO(filters.dateRange.end);

		if (start.month === end.month && start.year === end.year) {
			return start.toFormat("LLLL yyyy");
		}

		return `${start.toFormat("dd.MM.yyyy")} - ${end.toFormat("dd.MM.yyyy")}`;
	};

	const formatFileSize = (bytes: number | null) => {
		if (!bytes) return "-";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.payrollExport.history.title", "Export History")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.payrollExport.history.description",
						"View and download previous DATEV exports",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{exports.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						{t("settings.payrollExport.history.noExports", "No exports yet")}
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("settings.payrollExport.history.table.dateRange", "Date Range")}
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
									{t("settings.payrollExport.history.table.createdAt", "Created")}
								</TableHead>
								<TableHead className="w-[100px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{exports.map((exp) => (
								<TableRow key={exp.id}>
									<TableCell className="font-medium">
										{formatDateRange(exp.filters)}
									</TableCell>
									<TableCell>{getStatusBadge(exp.status)}</TableCell>
									<TableCell>
										{exp.workPeriodCount !== null ? (
											<span>
												{exp.workPeriodCount}{" "}
												{t("settings.payrollExport.history.periods", "periods")}
												{exp.employeeCount !== null && (
													<span className="text-muted-foreground">
														{" "}
														({exp.employeeCount}{" "}
														{t("settings.payrollExport.history.employees", "employees")})
													</span>
												)}
											</span>
										) : (
											"-"
										)}
									</TableCell>
									<TableCell>{formatFileSize(exp.fileSizeBytes)}</TableCell>
									<TableCell className="text-muted-foreground">
										{DateTime.fromJSDate(new Date(exp.createdAt)).toFormat(
											"dd.MM.yyyy HH:mm",
										)}
									</TableCell>
									<TableCell>
										{exp.status === "completed" && exp.fileName && (
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleDownload(exp.id)}
												disabled={isPending}
												aria-label={t("settings.payrollExport.history.download", "Download export")}
											>
												{isPending ? (
													<IconLoader2 className="h-4 w-4 animate-spin" />
												) : (
													<IconDownload className="h-4 w-4" />
												)}
											</Button>
										)}
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
