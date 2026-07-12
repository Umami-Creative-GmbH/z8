"use client";

import { IconAlertTriangle, IconCheck, IconDownload, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import type { WorkPolicyViolationWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatEmployeeName, getViolationTypeLabel, violationTypeColors } from "./helpers";

type DateRange = "7d" | "30d" | "90d";

interface WorkPolicyComplianceContentProps {
	dateRange: DateRange;
	violations: WorkPolicyViolationWithDetails[] | undefined;
	onDateRangeChange: (range: DateRange) => void;
	onExport: () => void;
	onRefresh: () => void;
	onAcknowledge: (violation: WorkPolicyViolationWithDetails) => void;
}

export function WorkPolicyComplianceLoading() {
	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-4">
				{[1, 2, 3, 4].map((index) => (
					<Card key={index}>
						<CardHeader className="pb-2">
							<Skeleton className="h-4 w-20" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-8 w-16" />
						</CardContent>
					</Card>
				))}
			</div>
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export function WorkPolicyComplianceError({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardContent className="py-8 text-center">
				<p className="text-destructive">
					{t("settings.workPolicies.violationsLoadError", "Failed to load violations")}
				</p>
				<Button className="mt-4" variant="outline" onClick={onRetry}>
					<IconRefresh className="mr-2 size-4" />
					{t("common.retry", "Retry")}
				</Button>
			</CardContent>
		</Card>
	);
}

export function WorkPolicyComplianceContent({
	dateRange,
	violations,
	onDateRangeChange,
	onExport,
	onRefresh,
	onAcknowledge,
}: WorkPolicyComplianceContentProps) {
	const { t } = useTranslate();
	const stats = {
		total: violations?.length || 0,
		unacknowledged: violations?.filter((violation) => !violation.acknowledgedAt).length || 0,
		maxDaily:
			violations?.filter((violation) => violation.violationType === "max_daily").length || 0,
		breakRequired:
			violations?.filter((violation) => violation.violationType === "break_required").length || 0,
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<Select value={dateRange} onValueChange={(value) => onDateRangeChange(value as DateRange)}>
					<SelectTrigger className="w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="7d">
							{t("settings.workPolicies.last7Days", "Last 7 days")}
						</SelectItem>
						<SelectItem value="30d">
							{t("settings.workPolicies.last30Days", "Last 30 days")}
						</SelectItem>
						<SelectItem value="90d">
							{t("settings.workPolicies.last90Days", "Last 90 days")}
						</SelectItem>
					</SelectContent>
				</Select>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={onExport}
						disabled={!violations || violations.length === 0}
					>
						<IconDownload className="mr-2 size-4" />
						{t("settings.workPolicies.exportCsv", "Export CSV")}
					</Button>
					<Button variant="ghost" size="icon" onClick={onRefresh}>
						<IconRefresh className="size-4" />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-4">
				<ComplianceStat
					label={t("settings.workPolicies.totalViolations", "Total Violations")}
					value={stats.total}
				/>
				<ComplianceStat
					label={t("settings.workPolicies.unacknowledged", "Unacknowledged")}
					value={stats.unacknowledged}
					valueClassName="text-destructive"
				/>
				<ComplianceStat
					label={t("settings.workPolicies.dailyExceeded", "Daily Exceeded")}
					value={stats.maxDaily}
				/>
				<ComplianceStat
					label={t("settings.workPolicies.breakMissing", "Break Missing")}
					value={stats.breakRequired}
				/>
			</div>

			{!violations || violations.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<IconCheck className="mx-auto mb-4 size-12 text-green-500" />
						<p className="text-lg font-medium">
							{t("settings.workPolicies.noViolations", "No violations found")}
						</p>
						<p className="mt-1 text-sm text-muted-foreground">
							{t(
								"settings.workPolicies.noViolationsDescription",
								"All employees are within compliance for the selected period.",
							)}
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.workPolicies.employee", "Employee")}</TableHead>
								<TableHead>{t("settings.workPolicies.date", "Date")}</TableHead>
								<TableHead>{t("settings.workPolicies.policyName", "Policy")}</TableHead>
								<TableHead>{t("settings.workPolicies.type", "Type")}</TableHead>
								<TableHead>{t("settings.workPolicies.status", "Status")}</TableHead>
								<TableHead className="w-[100px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{violations.map((violation) => (
								<TableRow key={violation.id}>
									<TableCell className="font-medium">
										{formatEmployeeName(violation.employee, t("common.unknown", "Unknown"))}
									</TableCell>
									<TableCell>
										{DateTime.fromJSDate(violation.violationDate).toFormat("LLL d, yyyy")}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{violation.policy?.name || t("common.unknown", "Unknown")}
									</TableCell>
									<TableCell>
										<Badge variant={violationTypeColors[violation.violationType] || "outline"}>
											{getViolationTypeLabel(violation.violationType, t)}
										</Badge>
									</TableCell>
									<TableCell>
										{violation.acknowledgedAt ? (
											<Badge variant="secondary">
												<IconCheck className="mr-1 size-3" />
												{t("settings.workPolicies.acknowledged", "Acknowledged")}
											</Badge>
										) : (
											<Badge variant="outline">
												<IconAlertTriangle className="mr-1 size-3" />
												{t("settings.workPolicies.pending", "Pending")}
											</Badge>
										)}
									</TableCell>
									<TableCell>
										{!violation.acknowledgedAt ? (
											<Button variant="ghost" size="sm" onClick={() => onAcknowledge(violation)}>
												{t("settings.workPolicies.acknowledge", "Acknowledge")}
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}

function ComplianceStat({
	label,
	value,
	valueClassName,
}: {
	label: string;
	value: number;
	valueClassName?: string;
}) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<CardDescription>{label}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className={`text-2xl font-bold ${valueClassName || ""}`}>{value}</div>
			</CardContent>
		</Card>
	);
}
