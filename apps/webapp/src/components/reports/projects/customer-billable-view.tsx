"use client";

import {
	IconAlertTriangle,
	IconBuilding,
	IconChevronDown,
	IconChevronRight,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Fragment, useState } from "react";
import { ReportDocumentExportButtons } from "@/components/reports/report-document-export-buttons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { buildCustomerReportDocument } from "@/lib/reports/project-report-export";
import type { BillableFigures, CustomerBillableReport } from "@/lib/reports/project-types";
import { BillableFiguresCard, MarginValue, useBillableFigureFormat } from "./billable-figures";

interface CustomerBillableViewProps {
	report: CustomerBillableReport;
	onProjectSelect: (projectId: string) => void;
}

function FigureCells({ figures, showMargin }: { figures: BillableFigures; showMargin: boolean }) {
	const { t } = useTranslate();
	const format = useBillableFigureFormat();
	return (
		<>
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
		</>
	);
}

/**
 * The customer view (#902): Billable Time figures per customer; expanding a
 * customer lists its projects, and a project opens its detailed report.
 */
export function CustomerBillableView({ report, onProjectSelect }: CustomerBillableViewProps) {
	const { t } = useTranslate();
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const showMargin = report.access === "full";

	const toggle = (customerId: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(customerId)) next.delete(customerId);
			else next.add(customerId);
			return next;
		});

	return (
		<div className="space-y-6">
			<div className="flex justify-end">
				<ReportDocumentExportButtons
					buildDocument={(context) => buildCustomerReportDocument(report, context)}
				/>
			</div>

			<BillableFiguresCard figures={report.totals.billable} context={report.billableTime} />

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconBuilding className="size-5" aria-hidden="true" />
						{t("reports.projects.customers.title", "Customers")}
					</CardTitle>
					<CardDescription>
						{t(
							"reports.projects.customers.description",
							"Billable time per customer. A customer's figures are the sum of its projects.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					{report.customers.length === 0 ? (
						<p className="py-6 text-center text-sm text-muted-foreground">
							{t("reports.projects.customers.empty", "No work on customer projects in this period")}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("reports.projects.customers.customer", "Customer")}</TableHead>
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
								{report.customers.map((row) => {
									const isOpen = expanded.has(row.customer.id);
									return (
										<Fragment key={row.customer.id}>
											<TableRow>
												<TableCell className="font-medium">
													<Button
														variant="ghost"
														size="sm"
														className="-ml-2 gap-1"
														aria-expanded={isOpen}
														onClick={() => toggle(row.customer.id)}
													>
														{isOpen ? (
															<IconChevronDown className="size-4" aria-hidden="true" />
														) : (
															<IconChevronRight className="size-4" aria-hidden="true" />
														)}
														{row.customer.name}
													</Button>
												</TableCell>
												<FigureCells figures={row.billable} showMargin={showMargin} />
											</TableRow>
											{isOpen &&
												row.projects.map((projectRow) => (
													<TableRow key={projectRow.project.id} className="bg-muted/30">
														<TableCell className="pl-10">
															<Button
																variant="link"
																size="sm"
																className="h-auto p-0"
																onClick={() => onProjectSelect(projectRow.project.id)}
															>
																{projectRow.project.name}
															</Button>
														</TableCell>
														<FigureCells figures={projectRow.billable} showMargin={showMargin} />
													</TableRow>
												))}
										</Fragment>
									);
								})}
							</TableBody>
							<TableFooter>
								<TableRow>
									<TableCell>{t("reports.projects.customers.total", "Total")}</TableCell>
									<FigureCells figures={report.totals.billable} showMargin={showMargin} />
								</TableRow>
							</TableFooter>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
