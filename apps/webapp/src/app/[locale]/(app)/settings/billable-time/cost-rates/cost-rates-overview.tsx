"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { CostRateActionPanel } from "@/components/billable-time/cost-rate-series";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { EmployeeCostRates } from "@/lib/billable-time/cost-rates";
import { formatBillableAmount, formatRateDate, periodContains } from "@/lib/billable-time/format";
import { useRouter } from "@/navigation";

export function CostRatesOverview({
	currency,
	employees,
}: {
	currency: string;
	employees: EmployeeCostRates[];
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const { locale, timezone } = useDisplayContext();
	const today = Temporal.Now.plainDateISO(timezone).toString();
	const [selected, setSelected] = useState<{ employeeId: string; name: string } | null>(null);

	return (
		<div className="space-y-6">
			<p className="max-w-xl text-sm text-muted-foreground">
				{t(
					"settings.billableTime.costRates.intro",
					"A cost rate is an employee's fully loaded internal cost per hour in {currency}, used for margin. It is separate from the wage: changing one never changes the other.",
					{ currency },
				)}
			</p>

			<Card>
				<CardContent>
					{employees.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("settings.billableTime.costRates.noEmployees", "No employees yet")}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.billableTime.costRates.employee", "Employee")}</TableHead>
									<TableHead>{t("settings.billableTime.costRates.today", "Today")}</TableHead>
									<TableHead className="sr-only">
										{t("settings.billableTime.costRates.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{employees.map((entry) => {
									const current = entry.periods.find((period) => periodContains(period, today));
									const next = entry.periods
										.filter((period) => period.effectiveFrom > today)
										.at(-1);
									return (
										<TableRow key={entry.employeeId}>
											<TableCell className="font-medium">
												<div className="flex flex-wrap items-center gap-2">
													{entry.name}
													{entry.contractType === "hourly" && (
														<Badge variant="outline">
															{t("settings.billableTime.costRates.hourly", "Hourly")}
														</Badge>
													)}
													{!entry.isActive && (
														<Badge variant="secondary">
															{t("settings.billableTime.costRates.inactive", "Inactive")}
														</Badge>
													)}
												</div>
											</TableCell>
											<TableCell className="tabular-nums">
												{current
													? t("settings.billableTime.costRates.ratePerHour", "{rate}/h", {
															rate: formatBillableAmount(locale, current.hourlyRate, currency),
														})
													: next
														? t("settings.billableTime.costRates.startsOn", "Starts {date}", {
																date: formatRateDate(locale, next.effectiveFrom),
															})
														: t("settings.billableTime.costRates.unknown", "Cost unknown")}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														setSelected({ employeeId: entry.employeeId, name: entry.name })
													}
												>
													{entry.periods.length > 0
														? t("settings.billableTime.costRates.history", "History")
														: t("settings.billableTime.costRates.set", "Set cost rate")}
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<CostRateActionPanel
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
				employeeId={selected?.employeeId ?? null}
				title={selected?.name ?? ""}
				description={t("settings.billableTime.costRates.panelDescription", "Cost rate")}
				onChanged={() => router.refresh()}
			/>
		</div>
	);
}
