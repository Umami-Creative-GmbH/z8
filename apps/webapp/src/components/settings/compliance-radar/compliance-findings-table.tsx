"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useCallback } from "react";
import { IconAlertTriangle, IconCheck, IconExclamationCircle, IconFilter, IconInfoCircle } from "@tabler/icons-react";
import {
	getComplianceFindings,
	type GetFindingsFilters,
} from "@/app/[locale]/(app)/settings/compliance-radar/actions";
import type { ComplianceFindingWithDetails } from "@/lib/effect/services/compliance-findings.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import type { ComplianceFindingSeverity, ComplianceFindingStatus, ComplianceFindingType } from "@/db/schema";

interface ComplianceFindingsTableProps {
	organizationId: string;
	isAdmin: boolean;
	filters: GetFindingsFilters;
	onFiltersChange: (filters: GetFindingsFilters) => void;
	pagination: { limit: number; offset: number };
	onPaginationChange: (pagination: { limit: number; offset: number }) => void;
	onFindingClick: (finding: ComplianceFindingWithDetails) => void;
}

const SEVERITY_ICONS: Record<ComplianceFindingSeverity, typeof IconInfoCircle> = {
	info: IconInfoCircle,
	warning: IconExclamationCircle,
	critical: IconAlertTriangle,
};

const SEVERITY_VARIANTS: Record<ComplianceFindingSeverity, "default" | "secondary" | "destructive" | "outline"> = {
	info: "secondary",
	warning: "default",
	critical: "destructive",
};

const STATUS_VARIANTS: Record<ComplianceFindingStatus, "default" | "secondary" | "destructive" | "outline"> = {
	open: "destructive",
	acknowledged: "secondary",
	waived: "outline",
	resolved: "default",
};

export function ComplianceFindingsTable({
	organizationId,
	isAdmin,
	filters,
	onFiltersChange,
	pagination,
	onPaginationChange,
	onFindingClick,
}: ComplianceFindingsTableProps) {
	const { t } = useTranslate();

	const findingTypeLabels: Record<ComplianceFindingType, string> = {
		rest_period_insufficient: t("complianceRadar.findingType.restPeriodInsufficient", "Insufficient Rest Period"),
		max_hours_daily_exceeded: t("complianceRadar.findingType.maxHoursDailyExceeded", "Daily Hours Exceeded"),
		max_hours_weekly_exceeded: t("complianceRadar.findingType.maxHoursWeeklyExceeded", "Weekly Hours Exceeded"),
		consecutive_days_exceeded: t("complianceRadar.findingType.consecutiveDaysExceeded", "Consecutive Days Exceeded"),
	};

	const severityLabels: Record<ComplianceFindingSeverity, string> = {
		info: t("complianceRadar.severity.info", "Info"),
		warning: t("complianceRadar.severity.warning", "Warning"),
		critical: t("complianceRadar.severity.critical", "Critical"),
	};

	const statusLabels: Record<ComplianceFindingStatus, string> = {
		open: t("complianceRadar.status.open", "Open"),
		acknowledged: t("complianceRadar.status.acknowledged", "Acknowledged"),
		waived: t("complianceRadar.status.waived", "Waived"),
		resolved: t("complianceRadar.status.resolved", "Resolved"),
	};

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.complianceRadar.findings(organizationId, { filters, pagination }),
		queryFn: () => getComplianceFindings(filters, pagination),
	});

	const findings = data?.success ? data.data.findings : [];
	const total = data?.success ? data.data.total : 0;

	const toggleStatus = useCallback((status: ComplianceFindingStatus) => {
		const current = filters.statuses ?? [];
		const updated = current.includes(status)
			? current.filter((s) => s !== status)
			: [...current, status];
		onFiltersChange({ ...filters, statuses: updated.length > 0 ? updated : undefined });
	}, [filters, onFiltersChange]);

	const toggleSeverity = useCallback((severity: ComplianceFindingSeverity) => {
		const current = filters.severities ?? [];
		const updated = current.includes(severity)
			? current.filter((s) => s !== severity)
			: [...current, severity];
		onFiltersChange({ ...filters, severities: updated.length > 0 ? updated : undefined });
	}, [filters, onFiltersChange]);

	const handleNextPage = useCallback(() => {
		if (pagination.offset + pagination.limit < total) {
			onPaginationChange({ ...pagination, offset: pagination.offset + pagination.limit });
		}
	}, [pagination, total, onPaginationChange]);

	const handlePrevPage = useCallback(() => {
		if (pagination.offset > 0) {
			onPaginationChange({ ...pagination, offset: Math.max(0, pagination.offset - pagination.limit) });
		}
	}, [pagination, onPaginationChange]);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Filters */}
			<div className="flex items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							<IconFilter className="mr-2 size-4" />
							{t("complianceRadar.filters.status", "Status")}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuLabel>{t("complianceRadar.filters.selectStatus", "Filter by Status")}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{(Object.keys(statusLabels) as ComplianceFindingStatus[]).map((status) => (
							<DropdownMenuCheckboxItem
								key={status}
								checked={filters.statuses?.includes(status) ?? false}
								onCheckedChange={() => toggleStatus(status)}
							>
								{statusLabels[status]}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							<IconFilter className="mr-2 size-4" />
							{t("complianceRadar.filters.severity", "Severity")}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuLabel>{t("complianceRadar.filters.selectSeverity", "Filter by Severity")}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{(Object.keys(severityLabels) as ComplianceFindingSeverity[]).map((severity) => (
							<DropdownMenuCheckboxItem
								key={severity}
								checked={filters.severities?.includes(severity) ?? false}
								onCheckedChange={() => toggleSeverity(severity)}
							>
								{severityLabels[severity]}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>

				<div className="ml-auto text-sm text-muted-foreground">
					{t("complianceRadar.showing", "Showing {{from}}-{{to}} of {{total}}", {
						from: pagination.offset + 1,
						to: Math.min(pagination.offset + pagination.limit, total),
						total,
					})}
				</div>
			</div>

			{/* Table */}
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("complianceRadar.table.employee", "Employee")}</TableHead>
							<TableHead>{t("complianceRadar.table.type", "Type")}</TableHead>
							<TableHead>{t("complianceRadar.table.severity", "Severity")}</TableHead>
							<TableHead>{t("complianceRadar.table.date", "Date")}</TableHead>
							<TableHead>{t("complianceRadar.table.status", "Status")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{findings.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="h-24 text-center">
									<div className="flex flex-col items-center gap-2">
										<IconCheck className="size-8 text-green-600" aria-hidden="true" />
										<span className="text-muted-foreground">
											{t("complianceRadar.noFindings", "No compliance findings")}
										</span>
									</div>
								</TableCell>
							</TableRow>
						) : (
							findings.map((finding) => {
								const SeverityIcon = SEVERITY_ICONS[finding.severity];
								return (
									<TableRow
										key={finding.id}
										className="cursor-pointer hover:bg-muted/50"
										tabIndex={0}
										onClick={() => onFindingClick(finding)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												onFindingClick(finding);
											}
										}}
									>
										<TableCell className="font-medium">
											{finding.employee.firstName} {finding.employee.lastName}
										</TableCell>
										<TableCell>{findingTypeLabels[finding.type]}</TableCell>
										<TableCell>
											<Badge variant={SEVERITY_VARIANTS[finding.severity]} className="gap-1">
												<SeverityIcon className="size-3" aria-hidden="true" />
												{severityLabels[finding.severity]}
											</Badge>
										</TableCell>
										<TableCell>
											{DateTime.fromJSDate(finding.occurrenceDate).toLocaleString(DateTime.DATE_MED)}
										</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANTS[finding.status]}>
												{statusLabels[finding.status]}
											</Badge>
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			{total > pagination.limit && (
				<div className="flex items-center justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={handlePrevPage}
						disabled={pagination.offset === 0}
					>
						{t("common.previous", "Previous")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={handleNextPage}
						disabled={pagination.offset + pagination.limit >= total}
					>
						{t("common.next", "Next")}
					</Button>
				</div>
			)}
		</div>
	);
}
