"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";
import { formatMinutes, formatPercentage, formatTimestamp } from "./helpers";

type CalculationDetailsRowProps = {
	calculation: SurchargeCalculationWithDetails;
	detailsId: string;
};

export function CalculationDetailsRow({
	calculation,
	detailsId,
}: CalculationDetailsRowProps) {
	const { t } = useTranslate();
	const details = calculation.calculationDetails;

	return (
		<TableRow id={detailsId} className="bg-muted/30 hover:bg-muted/30">
			<TableCell />
			<TableCell colSpan={7} className="whitespace-normal">
				<div className="grid gap-4 py-2 text-sm">
					<div className="grid gap-2 md:grid-cols-3">
						<div>
							<div className="font-medium">
								{t(
									"settings.surcharges.reports.details.workPeriod",
									"Work period",
								)}
							</div>
							<div className="text-muted-foreground">
								{details
									? `${formatTimestamp(details.workPeriodStartTime)} - ${formatTimestamp(details.workPeriodEndTime)}`
									: "-"}
							</div>
						</div>
						<div>
							<div className="font-medium">
								{t(
									"settings.surcharges.reports.details.calculatedAt",
									"Calculated at",
								)}
							</div>
							<div className="text-muted-foreground">
								{details ? formatTimestamp(details.calculatedAt) : "-"}
							</div>
						</div>
						<div>
							<div className="font-medium">
								{t(
									"settings.surcharges.reports.details.overlapPolicy",
									"Overlap policy",
								)}
								: {details?.overlapPolicy ?? "-"}
							</div>
						</div>
					</div>

					<div className="space-y-2">
						<div className="font-medium">
							{t(
								"settings.surcharges.reports.details.appliedRules",
								"Applied rules",
							)}
						</div>
						{details?.rulesApplied.length ? (
							<div className="grid gap-2">
								{details.rulesApplied.map((rule) => (
									<div key={rule.ruleId} className="rounded-md border p-3">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{rule.ruleName}</span>
											<Badge variant="secondary">{rule.ruleType}</Badge>
										</div>
										<div className="mt-2 grid gap-2 text-muted-foreground text-sm md:grid-cols-3">
											<div>
												{t(
													"settings.surcharges.reports.details.qualifying",
													"Qualifying",
												)}
												: {formatMinutes(rule.qualifyingMinutes)}
											</div>
											<div>
												{t(
													"settings.surcharges.reports.details.surcharge",
													"Surcharge",
												)}
												: {formatMinutes(rule.surchargeMinutes)}
											</div>
											<div>
												{t(
													"settings.surcharges.reports.details.percentage",
													"Percentage",
												)}
												: {formatPercentage(rule.percentage)}
											</div>
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="text-muted-foreground">
								{t(
									"settings.surcharges.reports.details.noAppliedRules",
									"No applied rules recorded.",
								)}
							</div>
						)}
					</div>
				</div>
			</TableCell>
		</TableRow>
	);
}
