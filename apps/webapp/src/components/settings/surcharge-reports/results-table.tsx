"use client";

import {
	IconChevronDown,
	IconChevronRight,
	IconFileAnalytics,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";
import { CalculationDetailsRow } from "./calculation-details-row";
import {
	formatDate,
	formatMinutesCell,
	formatPercentage,
	formatTimestamp,
	getEmployeeName,
} from "./helpers";

type SurchargeResultsTableProps = {
	isLoading: boolean;
	rows: SurchargeCalculationWithDetails[];
	expandedId: string | null;
	onExpandedChange: (next: string | null) => void;
};

export function SurchargeResultsTable({
	isLoading,
	rows,
	expandedId,
	onExpandedChange,
}: SurchargeResultsTableProps) {
	const { t } = useTranslate();

	if (isLoading && rows.length === 0) {
		return (
			<output
				aria-live="polite"
				className="block py-8 text-center text-muted-foreground text-sm"
			>
				{t("settings.surcharges.reports.loading", "Loading calculations…")}
			</output>
		);
	}

	if (rows.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<IconFileAnalytics aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>
						{t(
							"settings.surcharges.reports.empty.title",
							"No surcharge calculations found",
						)}
					</EmptyTitle>
					<EmptyDescription>
						{t(
							"settings.surcharges.reports.empty.description",
							"No surcharge calculations matched the selected filters.",
						)}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-10">
						<span className="sr-only">
							{t("settings.surcharges.reports.table.details", "Details")}
						</span>
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.date", "Date")}
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.employee", "Employee")}
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.base", "Base")}
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.qualifying", "Qualifying")}
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.credit", "Credit")}
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.percentage", "Percentage")}
					</TableHead>
					<TableHead>
						{t("settings.surcharges.reports.table.created", "Created")}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((calculation) => {
					const employeeName = getEmployeeName(calculation);
					const isExpanded = expandedId === calculation.id;
					const detailsId = `surcharge-calculation-${calculation.id}-details`;

					return (
						<Fragment key={calculation.id}>
							<TableRow className="tabular-nums">
								<TableCell>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-controls={detailsId}
										aria-expanded={isExpanded}
										aria-label={t(
											isExpanded
												? "settings.surcharges.reports.details.hideForEmployee"
												: "settings.surcharges.reports.details.showForEmployee",
											`${isExpanded ? "Hide" : "Show"} details for ${employeeName}`,
										)}
										onClick={() =>
											onExpandedChange(isExpanded ? null : calculation.id)
										}
									>
										{isExpanded ? (
											<IconChevronDown aria-hidden="true" />
										) : (
											<IconChevronRight aria-hidden="true" />
										)}
									</Button>
								</TableCell>
								<TableCell>{formatDate(calculation.calculationDate)}</TableCell>
								<TableCell>{employeeName}</TableCell>
								<TableCell>
									{formatMinutesCell(calculation.baseMinutes)}
								</TableCell>
								<TableCell>
									{formatMinutesCell(calculation.qualifyingMinutes)}
								</TableCell>
								<TableCell>
									{formatMinutesCell(calculation.surchargeMinutes)}
								</TableCell>
								<TableCell>
									{formatPercentage(calculation.appliedPercentage)}
								</TableCell>
								<TableCell>{formatTimestamp(calculation.createdAt)}</TableCell>
							</TableRow>
							{isExpanded ? (
								<CalculationDetailsRow
									calculation={calculation}
									detailsId={detailsId}
								/>
							) : null}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
}
