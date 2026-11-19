"use client";

import { IconAlertTriangle, IconCheck, IconDownload, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { WorkPolicyViolationWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import {
	formatEmployeeName,
	formatViolationDate,
	getViolationTypeLabel,
	type ViolationDisplayContext,
	violationTypeColors,
} from "./helpers";

type DateRange = "7d" | "30d" | "90d";

interface WorkPolicyComplianceContentProps {
	display: ViolationDisplayContext;
	dateRange: DateRange;
	violations: WorkPolicyViolationWithDetails[] | undefined;
	onDateRangeChange: (range: DateRange) => void;
	onExport: () => void;
	onRefresh: () => void;
	onAcknowledge: (violation: WorkPolicyViolationWithDetails) => void;
}

export function WorkPolicyComplianceLoading() {
	return (
		<div className="space-y-4" aria-busy="true">
			<Skeleton className="h-9 w-40" aria-hidden="true" />
			<div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
				{[1, 2, 3, 4].map((index) => (
					<div key={index} className="space-y-2 bg-card p-4">
						<Skeleton className="h-4 w-20" aria-hidden="true" />
						<Skeleton className="h-8 w-16" aria-hidden="true" />
					</div>
				))}
			</div>
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</div>
	);
}

export function WorkPolicyComplianceError({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardContent className="py-8 text-center">
				<p role="alert" className="text-destructive">
					{t("settings.workPolicies.violationsLoadError", "Failed to load violations")}
				</p>
				<Button className="mt-4" variant="outline" onClick={onRetry}>
					<IconRefresh className="mr-2 size-4" aria-hidden="true" />
					{t("common.retry", "Retry")}
				</Button>
			</CardContent>
		</Card>
	);
}

export function WorkPolicyComplianceContent({
	display,
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
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Select value={dateRange} onValueChange={(value) => onDateRangeChange(value as DateRange)}>
					<SelectTrigger
						className="w-40"
						aria-label={t("settings.workPolicies.violationPeriod", "Violation period")}
					>
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
						<IconDownload className="mr-2 size-4" aria-hidden="true" />
						{t("settings.workPolicies.exportCsv", "Export CSV")}
					</Button>
					<Button variant="ghost" size="icon" onClick={onRefresh}>
						<IconRefresh className="size-4" aria-hidden="true" />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>
			</div>

			<dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
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
			</dl>

			{!violations || violations.length === 0 ? (
				<Card>
					<CardContent className="py-10 text-center">
						<IconCheck className="mx-auto mb-3 size-6 text-primary" aria-hidden="true" />
						<p className="font-medium">
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
								<TableHead>
									{t("settings.workPolicies.dateInTimezone", "Date ({timezone})", {
										timezone: display.timezone,
									})}
								</TableHead>
								<TableHead>{t("settings.workPolicies.policyName", "Policy")}</TableHead>
								<TableHead>{t("settings.workPolicies.type", "Type")}</TableHead>
								<TableHead>{t("settings.workPolicies.status", "Status")}</TableHead>
								<TableHead className="w-[100px]">
									<span className="sr-only">{t("common.actions", "Actions")}</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{violations.map((violation) => (
								<TableRow key={violation.id}>
									<TableCell className="font-medium">
										{formatEmployeeName(violation.employee, t("common.unknown", "Unknown"))}
									</TableCell>
									<TableCell className="whitespace-nowrap tabular-nums">
										{formatViolationDate(violation.violationDate, display)}
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
												<IconCheck className="mr-1 size-3" aria-hidden="true" />
												{t("settings.workPolicies.acknowledged", "Acknowledged")}
											</Badge>
										) : (
											<Badge variant="outline">
												<IconAlertTriangle className="mr-1 size-3" aria-hidden="true" />
												{t("settings.workPolicies.pending", "Pending")}
											</Badge>
										)}
									</TableCell>
									<TableCell>
										{!violation.acknowledgedAt ? (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onAcknowledge(violation)}
												aria-label={t(
													"settings.workPolicies.acknowledgeFor",
													"Acknowledge {type} violation for {name}",
													{
														type: getViolationTypeLabel(violation.violationType, t),
														name: formatEmployeeName(
															violation.employee,
															t("common.unknown", "Unknown"),
														),
													},
												)}
											>
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
	// One cell of the shared summary strip.
	return (
		<div className="min-w-0 space-y-1 bg-card p-4 text-card-foreground">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className={cn("text-2xl font-semibold tabular-nums", valueClassName)}>{value}</dd>
		</div>
	);
}
