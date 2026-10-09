"use client";

import { IconAlertTriangle, IconClockDollar, IconReceipt } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatBillableAmount } from "@/lib/billable-time/format";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type {
	BillableFigures,
	BillableTimeReportContext,
	ProjectTeamMember,
} from "@/lib/reports/project-types";

/** Formats Billable Time amounts and hours for the viewer's locale. */
export function useBillableFigureFormat() {
	const { locale } = useDisplayContext();
	return {
		money: (amount: string, currency: string) => formatBillableAmount(locale, amount, currency),
		hours: (value: number) => `${value.toFixed(1)}h`,
	};
}

/** A margin, or "Cost unknown" while some of the work has no cost rate (never 100%). */
export function MarginValue({
	figures,
}: {
	figures: Extract<BillableFigures, { access: "full" }>;
}) {
	const { t } = useTranslate();
	const format = useBillableFigureFormat();
	if (figures.margin === null) {
		return (
			<span className="text-muted-foreground">
				{t("reports.projects.billable.costUnknown", "Cost unknown")}
			</span>
		);
	}
	return (
		<span>
			{format.money(figures.margin, figures.currency)}
			{figures.marginPercent !== null && (
				<span className="text-muted-foreground"> ({figures.marginPercent}%)</span>
			)}
		</span>
	);
}

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
	return (
		<div className="space-y-1 rounded-lg border p-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-lg font-semibold tabular-nums">{value}</div>
			{hint && <div className="text-xs text-muted-foreground">{hint}</div>}
		</div>
	);
}

interface BillableFiguresCardProps {
	figures: BillableFigures;
	context: BillableTimeReportContext;
	description?: string;
}

/**
 * Billable hours, revenue and (for owners and admins) cost and margin of a
 * report, with unpriced work and pending corrections flagged.
 */
export function BillableFiguresCard({ figures, context, description }: BillableFiguresCardProps) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const format = useBillableFigureFormat();
	const ratesAsOf = formatInstant(
		parseInstant(context.ratesResolvedAt),
		displayContext,
		"dateTimeMedium",
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconClockDollar className="size-5" aria-hidden="true" />
					{t("reports.projects.billable.title", "Billable time")}
				</CardTitle>
				<CardDescription>
					{description ??
						t(
							"reports.projects.billable.description",
							"Completed work only. Revenue uses the rates in effect on {date}.",
							{ date: ratesAsOf },
						)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
					<Figure
						label={t("reports.projects.billable.billableHours", "Billable hours")}
						value={format.hours(figures.billableHours)}
					/>
					<Figure
						label={t("reports.projects.billable.nonBillableHours", "Non-billable hours")}
						value={format.hours(figures.nonBillableHours)}
					/>
					<Figure
						label={t("reports.projects.billable.revenue", "Revenue")}
						value={format.money(figures.revenue, figures.currency)}
					/>
					{figures.access === "full" && (
						<>
							<Figure
								label={t("reports.projects.billable.cost", "Cost")}
								value={
									figures.cost === null ? (
										<span className="text-muted-foreground">
											{t("reports.projects.billable.costUnknown", "Cost unknown")}
										</span>
									) : (
										format.money(figures.cost, figures.currency)
									)
								}
							/>
							<Figure
								label={t("reports.projects.billable.margin", "Margin")}
								value={<MarginValue figures={figures} />}
							/>
						</>
					)}
				</div>
				{figures.invoicing && (
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						<Figure
							label={t("reports.projects.billable.invoicedHours", "Invoiced hours")}
							value={format.hours(figures.invoicing.invoicedHours)}
						/>
						<Figure
							label={t("reports.projects.billable.invoicedRevenue", "Invoiced revenue")}
							value={format.money(figures.invoicing.invoicedRevenue, figures.currency)}
							hint={t(
								"reports.projects.billable.invoicedRevenueHint",
								"At the rates of its invoice drafts",
							)}
						/>
						<Figure
							label={t("reports.projects.billable.uninvoicedHours", "Un-invoiced hours")}
							value={format.hours(figures.invoicing.uninvoicedHours)}
						/>
						<Figure
							label={t("reports.projects.billable.uninvoicedRevenue", "Un-invoiced revenue")}
							value={format.money(figures.invoicing.uninvoicedRevenue, figures.currency)}
						/>
					</div>
				)}
				<div className="flex flex-wrap gap-2">
					{(figures.invoicing?.changedAfterInvoicingCount ?? 0) > 0 && (
						<Badge
							variant="outline"
							className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
						>
							<IconAlertTriangle className="size-3" aria-hidden="true" />
							{t(
								"reports.projects.billable.changedAfterInvoicing",
								"{count, plural, one {# invoiced work period was} other {# invoiced work periods were}} changed after invoicing",
								{ count: figures.invoicing?.changedAfterInvoicingCount ?? 0 },
							)}
						</Badge>
					)}
					{figures.unpricedWorkCount > 0 && (
						<Badge
							variant="outline"
							className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
						>
							<IconAlertTriangle className="size-3" aria-hidden="true" />
							{t(
								"reports.projects.billable.unpriced",
								"{count, plural, one {# work period} other {# work periods}} unpriced ({hours}), no rate in effect",
								{ count: figures.unpricedWorkCount, hours: format.hours(figures.unpricedHours) },
							)}
						</Badge>
					)}
					{figures.access === "full" && figures.costUnknownWorkCount > 0 && (
						<Badge variant="outline" className="gap-1">
							{t(
								"reports.projects.billable.costUnknownCount",
								"{count, plural, one {# work period has} other {# work periods have}} no cost rate",
								{ count: figures.costUnknownWorkCount },
							)}
						</Badge>
					)}
					{figures.pendingReviewCount > 0 && (
						<Badge variant="outline" className="gap-1">
							<IconReceipt className="size-3" aria-hidden="true" />
							{t(
								"reports.projects.billable.pending",
								"{count, plural, one {# work period has} other {# work periods have}} a pending correction or submission",
								{ count: figures.pendingReviewCount },
							)}
						</Badge>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

/** Per-employee Billable Time figures of one project. */
export function BillableEmployeeTable({ employees }: { employees: ProjectTeamMember[] }) {
	const { t } = useTranslate();
	const format = useBillableFigureFormat();
	const rows = employees.filter((employee) => employee.billable);
	if (rows.length === 0) return null;
	const showMargin = rows.some((employee) => employee.billable?.access === "full");

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("reports.projects.billable.byEmployee", "Billable time by employee")}
				</CardTitle>
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("reports.projects.billable.employee", "Employee")}</TableHead>
							<TableHead className="text-right">
								{t("reports.projects.billable.billableHours", "Billable hours")}
							</TableHead>
							<TableHead className="text-right">
								{t("reports.projects.billable.nonBillableHours", "Non-billable hours")}
							</TableHead>
							<TableHead className="text-right">
								{t("reports.projects.billable.revenue", "Revenue")}
							</TableHead>
							{showMargin && (
								<TableHead className="text-right">
									{t("reports.projects.billable.margin", "Margin")}
								</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((employee) => {
							const figures = employee.billable as BillableFigures;
							return (
								<TableRow key={employee.employeeId}>
									<TableCell className="font-medium">{employee.employeeName}</TableCell>
									<TableCell className="text-right tabular-nums">
										{format.hours(figures.billableHours)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{format.hours(figures.nonBillableHours)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{format.money(figures.revenue, figures.currency)}
										{figures.unpricedWorkCount > 0 && (
											<IconAlertTriangle
												className="ml-1 inline size-3 text-amber-600"
												aria-label={t("reports.projects.billable.hasUnpriced", "Has unpriced work")}
											/>
										)}
									</TableCell>
									{showMargin && (
										<TableCell className="text-right tabular-nums">
											{figures.access === "full" ? <MarginValue figures={figures} /> : null}
										</TableCell>
									)}
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
