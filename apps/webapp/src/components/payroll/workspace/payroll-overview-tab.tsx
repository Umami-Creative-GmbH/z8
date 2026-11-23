"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import type React from "react";
import { MonthClosureStrip } from "@/components/closed-months/month-closure-strip";
import { UnclosedMonthsNotice } from "@/components/closed-months/unclosed-months-notice";
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
import type { PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";
import type { DismissiblePayrollBlocker } from "@/lib/payroll-workspace/blocker-dismissals";
import type { PayrollBlockerIdentity } from "@/lib/payroll-workspace/blocker-identity";
import { payrollHoursFormat } from "@/lib/payroll-workspace/hours-format";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { OvertimePayoutReadinessAlert } from "../overtime-payout-readiness-alert";
import { PayrollRunReadinessCard } from "../payroll-run-readiness-card";
import { PayrollBlockersAlert } from "./payroll-blockers-alert";
import { PayrollOverviewReadinessSection } from "./payroll-overview-readiness-section";
import type { BlockerFocusRequest, PayrollPeriodRequest, PayrollTranslate } from "./state";

/**
 * The Overview tab: closed-month status, blockers, overtime payout and travel-expense
 * run readiness, organization-level readiness checks (for org admins), and the totals
 * per employee.
 */
export function PayrollOverviewTab({
	blockers,
	blockersSummaryRef,
	clearingBlockerKeys,
	closureEmployeeIds,
	employees,
	filtersHaveNoMatches,
	focusRequest,
	formatId,
	initialPeriod,
	initialReadiness,
	isOrgAdmin = false,
	onClearBlocker,
	periodMonths,
	request,
	t,
}: {
	blockers: PayrollWorkspaceSummary["blockers"];
	blockersSummaryRef: React.RefObject<HTMLDivElement | null>;
	clearingBlockerKeys: ReadonlySet<PayrollBlockerIdentity>;
	closureEmployeeIds: string[];
	employees: PayrollWorkspaceSummary["employees"];
	filtersHaveNoMatches: boolean;
	focusRequest: BlockerFocusRequest | null;
	formatId: string;
	initialPeriod?: { startDate: string; endDate: string };
	initialReadiness?: PayrollReadinessResult | null;
	isOrgAdmin?: boolean;
	onClearBlocker: (blocker: DismissiblePayrollBlocker, activatedControl: HTMLButtonElement) => void;
	periodMonths: string[];
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	return (
		<div className="flex flex-col gap-6">
			{filtersHaveNoMatches ? null : (
				// Whether the period's months are closed for this selection (#762).
				<>
					<MonthClosureStrip months={periodMonths} employeeIds={closureEmployeeIds} />
					<UnclosedMonthsNotice months={periodMonths} employeeIds={closureEmployeeIds} />
				</>
			)}
			<PayrollBlockersAlert
				blockers={blockers}
				clearingBlockerKeys={clearingBlockerKeys}
				employees={employees}
				fallbackFocusRef={blockersSummaryRef}
				focusRequest={focusRequest}
				onClearBlocker={onClearBlocker}
				t={t}
			/>
			{filtersHaveNoMatches ? null : (
				<OvertimePayoutReadinessAlert request={{ ...request, formatId }} />
			)}
			{filtersHaveNoMatches ? null : <PayrollRunReadinessCard request={{ ...request, formatId }} />}
			{isOrgAdmin ? (
				<PayrollOverviewReadinessSection
					initialPeriod={
						initialPeriod ?? { startDate: request.startDate, endDate: request.endDate }
					}
					initialReadiness={initialReadiness}
					period={{
						startDate: request.startDate,
						endDate: request.endDate,
						label: request.label,
					}}
					t={t}
				/>
			) : null}
			<EmployeeTotalsCard employees={employees} t={t} />
		</div>
	);
}

function EmployeeTotalsCard({
	employees,
	t,
}: {
	employees: PayrollWorkspaceSummary["employees"];
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	const hours = payrollHoursFormat(locale);
	const days = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t("payroll.employeeTotals.title", "Employee totals")}
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.employeeTotals.description",
						"Worked time, absence totals, contract type, and payroll status.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div
					role="region"
					aria-label={t("payroll.employeeTotals.title", "Employee totals")}
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The named totals region needs keyboard scrolling.
					tabIndex={0}
					className="max-w-full overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>div]:overflow-visible"
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("payroll.employeeTotals.employee", "Employee")}</TableHead>
								<TableHead>{t("payroll.employeeTotals.team", "Team")}</TableHead>
								<TableHead>{t("payroll.employeeTotals.contract", "Contract")}</TableHead>
								<TableHead className="text-right">
									{t("payroll.employeeTotals.hours", "Hours")}
								</TableHead>
								<TableHead>{t("payroll.employeeTotals.absences", "Absences")}</TableHead>
								<TableHead>{t("payroll.employeeTotals.status", "Status")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{employees.length > 0 ? (
								employees.map((employee) => (
									<TableRow key={employee.id}>
										<TableCell>
											<div className="font-medium">{employee.name}</div>
											<div className="text-muted-foreground text-xs">
												{employee.employeeNumber ??
													t("payroll.employeeTotals.noEmployeeNumber", "No employee number")}
											</div>
										</TableCell>
										<TableCell>
											{employee.teamName ?? t("payroll.employeeTotals.noTeam", "No team")}
										</TableCell>
										<TableCell>
											<Badge variant={employee.contractType === "hourly" ? "default" : "secondary"}>
												{employee.contractType === "hourly"
													? t("payroll.employeeTotals.contractHourly", "Hourly")
													: t("payroll.employeeTotals.contractFixed", "Fixed")}
											</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{`${hours.hours(employee.workedHours)} h`}
										</TableCell>
										<TableCell>{formatAbsences(t, employee.absenceDaysByCategory, days)}</TableCell>
										<TableCell>
											<Badge variant={employee.hasBlockers ? "destructive" : "secondary"}>
												{employee.hasBlockers
													? t("payroll.employeeTotals.blocked", "Blocked")
													: t("payroll.employeeTotals.readyForPayroll", "Ready for payroll")}
											</Badge>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
										{t(
											"payroll.filters.noMatchingEmployees",
											"No employees match the selected payroll filters.",
										)}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}

function formatAbsences(
	t: PayrollTranslate,
	absences: PayrollWorkspaceSummary["employees"][number]["absenceDaysByCategory"],
	days: Intl.NumberFormat,
) {
	if (absences.length === 0) return t("payroll.employeeTotals.noAbsences", "None");

	return absences
		.map((absence) => `${absence.categoryName}: ${days.format(absence.days)}`)
		.join(", ");
}
