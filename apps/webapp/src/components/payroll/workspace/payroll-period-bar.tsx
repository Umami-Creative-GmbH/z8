"use client";

import {
	IconCalendarWeek,
	IconChevronLeft,
	IconChevronRight,
	IconLoader2,
	IconRefresh,
} from "@tabler/icons-react";
import { useLocale } from "next-intl";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PayrollDateRangeMode, PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { PayrollScopeControls } from "./payroll-scope-controls";
import { formatDisplayedPeriod, type PayrollTranslate, type PayrollWorkspaceAction } from "./state";

/** The period and scope bar at the top of the payroll workspace. */
export function PayrollPeriodBar({
	dateMode,
	dispatch,
	employeeCount,
	endDate,
	filtersHaveNoMatches,
	isPending,
	onApplyCustomRange,
	onApplyDateMode,
	onApplyEmployees,
	onApplyTeams,
	onNavigatePeriod,
	onReturnToCurrentPeriod,
	scopedEmployees,
	selectedEmployeeIds,
	selectedTeamNames,
	startDate,
	summary,
	teamOptions,
	t,
}: {
	dateMode: PayrollDateRangeMode;
	dispatch: React.Dispatch<PayrollWorkspaceAction>;
	employeeCount: number;
	endDate: string;
	filtersHaveNoMatches: boolean;
	isPending: boolean;
	onApplyCustomRange: () => void;
	onApplyDateMode: (mode: PayrollDateRangeMode) => void;
	onApplyEmployees: (employeeIds: string[], onSuccess?: () => void) => void;
	onApplyTeams: (teamNames: string[], onSuccess?: () => void) => void;
	onNavigatePeriod: (direction: "previous" | "next") => void;
	onReturnToCurrentPeriod: () => void;
	scopedEmployees: PayrollWorkspaceSummary["employees"];
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	startDate: string;
	summary: PayrollWorkspaceSummary;
	teamOptions: string[];
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	return (
		<Card className="gap-4 py-4">
			<CardHeader className="gap-3 lg:flex lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0 space-y-1">
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<IconCalendarWeek aria-hidden="true" className="size-4" />
						<span>{t("payroll.period.selected", "Selected period")}</span>
					</div>
					<CardTitle aria-level={2} className="text-xl" role="heading">
						{formatDisplayedPeriod(summary.period.start, summary.period.end, dateMode, locale)}
					</CardTitle>
					<CardDescription className="flex flex-wrap gap-x-3">
						<span>
							{t("payroll.period.dateRange", "{start} to {end}", {
								start: summary.period.start,
								end: summary.period.end,
							})}
						</span>
						<span>
							{t("payroll.period.employeesInScope", "{count} employees in scope", {
								count: employeeCount,
							})}
						</span>
					</CardDescription>
					{filtersHaveNoMatches ? (
						<p className="text-destructive text-sm">
							{t(
								"payroll.filters.noMatchingEmployees",
								"No employees match the selected payroll filters.",
							)}
						</p>
					) : null}
				</div>

				<div className="grid grid-cols-3 gap-2 lg:w-auto">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={dateMode === "custom" || isPending}
						onClick={() => onNavigatePeriod("previous")}
					>
						<IconChevronLeft aria-hidden="true" className="size-4" />
						<span className="truncate">{t("payroll.period.previous", "Previous period")}</span>
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={dateMode === "custom" || isPending}
						onClick={() => onNavigatePeriod("next")}
					>
						<span className="truncate">{t("payroll.period.next", "Next period")}</span>
						<IconChevronRight aria-hidden="true" className="size-4" />
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={dateMode === "custom" || isPending}
						onClick={onReturnToCurrentPeriod}
					>
						<IconRefresh aria-hidden="true" className="size-4" />
						<span className="truncate">{t("payroll.period.current", "Current period")}</span>
					</Button>
				</div>
			</CardHeader>
			<CardContent data-payroll-period-controls="" className="grid gap-4 border-t pt-4">
				<PayrollDateControls
					dateMode={dateMode}
					dispatch={dispatch}
					endDate={endDate}
					isPending={isPending}
					onApplyCustomRange={onApplyCustomRange}
					onApplyDateMode={onApplyDateMode}
					startDate={startDate}
					t={t}
				/>
				<PayrollScopeControls
					isPending={isPending}
					onApplyEmployees={onApplyEmployees}
					onApplyTeams={onApplyTeams}
					scopedEmployees={scopedEmployees}
					selectedEmployeeIds={selectedEmployeeIds}
					selectedTeamNames={selectedTeamNames}
					teamOptions={teamOptions}
					t={t}
				/>
			</CardContent>
		</Card>
	);
}

function PayrollDateControls({
	dateMode,
	dispatch,
	endDate,
	isPending,
	onApplyCustomRange,
	onApplyDateMode,
	startDate,
	t,
}: {
	dateMode: PayrollDateRangeMode;
	dispatch: React.Dispatch<PayrollWorkspaceAction>;
	endDate: string;
	isPending: boolean;
	onApplyCustomRange: () => void;
	onApplyDateMode: (mode: PayrollDateRangeMode) => void;
	startDate: string;
	t: PayrollTranslate;
}) {
	return (
		<div
			data-payroll-date-controls=""
			className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end"
		>
			<div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 lg:w-fit">
				{(["month", "week", "custom"] as const).map((mode) => (
					<Button
						key={mode}
						type="button"
						variant={dateMode === mode ? "default" : "ghost"}
						size="sm"
						disabled={isPending}
						aria-pressed={dateMode === mode}
						onClick={() => onApplyDateMode(mode)}
					>
						{getDateModeLabel(t, mode)}
					</Button>
				))}
			</div>

			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
				<div className="space-y-1">
					<Label htmlFor="payroll-start-date">{t("payroll.period.start", "Start")}</Label>
					<Input
						id="payroll-start-date"
						name="payroll-start-date"
						autoComplete="off"
						type="date"
						value={startDate}
						disabled={dateMode !== "custom" || isPending}
						onChange={(event) => dispatch({ type: "startDateChanged", value: event.target.value })}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="payroll-end-date">{t("payroll.period.end", "End")}</Label>
					<Input
						id="payroll-end-date"
						name="payroll-end-date"
						autoComplete="off"
						type="date"
						value={endDate}
						disabled={dateMode !== "custom" || isPending}
						onChange={(event) => dispatch({ type: "endDateChanged", value: event.target.value })}
					/>
				</div>
				<Button
					type="button"
					className="sm:self-end"
					disabled={dateMode !== "custom" || isPending}
					onClick={onApplyCustomRange}
				>
					{isPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconCalendarWeek aria-hidden="true" className="size-4" />
					)}
					{t("payroll.actions.apply", "Apply")}
				</Button>
			</div>
		</div>
	);
}

function getDateModeLabel(t: PayrollTranslate, mode: PayrollDateRangeMode) {
	if (mode === "month") return t("payroll.period.mode.month", "Month");
	if (mode === "week") return t("payroll.period.mode.week", "Week");

	return t("payroll.period.mode.custom", "Custom");
}
