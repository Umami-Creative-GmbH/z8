"use client";

import {
	IconAlertTriangle,
	IconCalendarWeek,
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconFileExport,
	IconLoader2,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import type React from "react";
import { useReducer, useTransition } from "react";
import { toast } from "sonner";
import {
	exportPayrollPdfAction,
	getPayrollWorkspaceSummaryAction,
	type PayrollExportFormatOption,
	startScopedPayrollExportAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { PayrollDateRangeMode, PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";

type PayrollTranslate = ReturnType<typeof useTranslate>["t"];

interface PayrollWorkspaceProps {
	initialSummary: PayrollWorkspaceSummary;
	exportFormats: PayrollExportFormatOption[];
}

interface PayrollPeriodRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
}

interface PayrollWorkspaceState {
	summary: PayrollWorkspaceSummary;
	dateMode: PayrollDateRangeMode;
	startDate: string;
	endDate: string;
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	formatId: string;
}

type PayrollWorkspaceAction =
	| { type: "summaryRefreshed"; summary: PayrollWorkspaceSummary }
	| { type: "dateModeChanged"; dateMode: PayrollDateRangeMode }
	| { type: "startDateChanged"; value: string }
	| { type: "endDateChanged"; value: string }
	| { type: "employeeFilterChanged"; employeeIds: string[] }
	| { type: "teamFilterChanged"; teamNames: string[] }
	| { type: "formatChanged"; formatId: string };

function payrollWorkspaceReducer(
	state: PayrollWorkspaceState,
	action: PayrollWorkspaceAction,
): PayrollWorkspaceState {
	switch (action.type) {
		case "summaryRefreshed":
			return {
				...state,
				summary: action.summary,
				startDate: action.summary.period.start,
				endDate: action.summary.period.end,
			};
		case "dateModeChanged":
			return { ...state, dateMode: action.dateMode };
		case "startDateChanged":
			return { ...state, startDate: action.value };
		case "endDateChanged":
			return { ...state, endDate: action.value };
		case "employeeFilterChanged":
			return { ...state, selectedEmployeeIds: action.employeeIds };
		case "teamFilterChanged":
			return { ...state, selectedTeamNames: action.teamNames };
		case "formatChanged":
			return { ...state, formatId: action.formatId };
	}
}

export function PayrollWorkspace({ initialSummary, exportFormats }: PayrollWorkspaceProps) {
	const { t } = useTranslate();
	const [state, dispatch] = useReducer(payrollWorkspaceReducer, {
		summary: initialSummary,
		dateMode: "month",
		startDate: initialSummary.period.start,
		endDate: initialSummary.period.end,
		selectedEmployeeIds: [],
		selectedTeamNames: [],
		formatId: exportFormats[0]?.id ?? "",
	});
	const {
		summary,
		dateMode,
		startDate,
		endDate,
		selectedEmployeeIds,
		selectedTeamNames,
		formatId,
	} = state;
	const [isPending, startTransition] = useTransition();

	const scopedEmployees = initialSummary.employees;
	const teamOptions = getTeamOptions(scopedEmployees);
	const filteredEmployeeIds = getFilteredEmployeeIds(
		scopedEmployees,
		selectedEmployeeIds,
		selectedTeamNames,
	);
	const filtersHaveNoMatches = filteredEmployeeIds?.length === 0;
	const hasExportFormats = exportFormats.length > 0;
	const displayedEmployees = filtersHaveNoMatches ? [] : summary.employees;
	const displayedBlockers = filtersHaveNoMatches ? [] : summary.blockers;
	const displayedTotals = filtersHaveNoMatches
		? { employeeCount: 0, totalWorkedHours: 0, blockerCount: 0 }
		: summary.totals;
	const readyEmployeeCount = displayedEmployees.filter((employee) => !employee.hasBlockers).length;
	const request = {
		startDate: summary.period.start,
		endDate: summary.period.end,
		label: summary.period.label,
		employeeIds: filteredEmployeeIds,
	};

	function refreshSummary(
		nextRequest: PayrollPeriodRequest,
		employeeIds = filteredEmployeeIds,
		onSuccess?: () => void,
	) {
		if (employeeIds?.length === 0) {
			toast.error(
				t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				),
			);
			return;
		}

		startTransition(async () => {
			const result = await getPayrollWorkspaceSummaryAction({ ...nextRequest, employeeIds });

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			dispatch({ type: "summaryRefreshed", summary: result.data });
			onSuccess?.();
		});
	}

	function toggleEmployeeFilter(employeeId: string, checked: boolean) {
		const nextEmployeeIds = checked
			? [...selectedEmployeeIds, employeeId]
			: selectedEmployeeIds.filter((selectedEmployeeId) => selectedEmployeeId !== employeeId);
		const nextFilteredEmployeeIds = getFilteredEmployeeIds(
			scopedEmployees,
			nextEmployeeIds,
			selectedTeamNames,
		);

		dispatch({ type: "employeeFilterChanged", employeeIds: nextEmployeeIds });
		refreshSummary(basePeriodRequest(summary), nextFilteredEmployeeIds);
	}

	function toggleTeamFilter(teamName: string, checked: boolean) {
		const nextTeamNames = checked
			? [...selectedTeamNames, teamName]
			: selectedTeamNames.filter((selectedTeamName) => selectedTeamName !== teamName);
		const nextFilteredEmployeeIds = getFilteredEmployeeIds(
			scopedEmployees,
			selectedEmployeeIds,
			nextTeamNames,
		);

		dispatch({ type: "teamFilterChanged", teamNames: nextTeamNames });
		refreshSummary(basePeriodRequest(summary), nextFilteredEmployeeIds);
	}

	function applyDateMode(nextMode: PayrollDateRangeMode) {
		if (nextMode === "custom") {
			dispatch({ type: "dateModeChanged", dateMode: nextMode });
			return;
		}

		refreshSummary(
			buildPeriodRequest(DateTime.utc().startOf(nextMode), nextMode),
			filteredEmployeeIds,
			() => dispatch({ type: "dateModeChanged", dateMode: nextMode }),
		);
	}

	function navigatePeriod(direction: "previous" | "next") {
		if (dateMode === "custom") return;

		const currentStart = DateTime.fromISO(summary.period.start, { zone: "utc" });
		const amount = direction === "previous" ? -1 : 1;
		const nextStart = currentStart.plus({ [dateMode]: amount }).startOf(dateMode);

		refreshSummary(buildPeriodRequest(nextStart, dateMode));
	}

	function returnToCurrentPeriod() {
		if (dateMode === "custom") return;

		refreshSummary(buildPeriodRequest(DateTime.utc().startOf(dateMode), dateMode));
	}

	function applyCustomRange() {
		const start = DateTime.fromISO(startDate);
		const end = DateTime.fromISO(endDate);

		refreshSummary({
			startDate,
			endDate,
			label: formatPeriodLabel(start, end, "custom"),
		});
	}

	function downloadPdf() {
		if (filtersHaveNoMatches) {
			toast.error(
				t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				),
			);
			return;
		}

		startTransition(async () => {
			const result = await exportPayrollPdfAction(request);

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			const blob = new Blob([new Uint8Array(result.data.data)], { type: "application/pdf" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = result.data.filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		});
	}

	function triggerExport() {
		if (!formatId) return;
		if (filtersHaveNoMatches) {
			toast.error(
				t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				),
			);
			return;
		}

		startTransition(async () => {
			const result = await startScopedPayrollExportAction({ ...request, formatId });

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			toast.success(
				result.data.isAsync
					? t("payroll.export.queued", "Payroll export queued")
					: t("payroll.export.completed", "Payroll export completed"),
			);
		});
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-1">
				<div className="space-y-1">
					<h1 className="text-3xl font-semibold tracking-tight">{t("payroll.title", "Payroll")}</h1>
					<p className="text-muted-foreground">
						{t(
							"payroll.description",
							"Review payroll totals, readiness, and exports for the selected period.",
						)}
					</p>
				</div>
			</header>

			<Card>
				<CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
					<div className="space-y-2">
						<div className="flex items-center gap-2 text-muted-foreground text-sm">
							<IconCalendarWeek aria-hidden="true" className="size-4" />
							<span>{t("payroll.period.selected", "Selected period")}</span>
						</div>
						<div>
							<CardTitle aria-level={2} className="text-2xl" role="heading">
								{summary.period.label}
							</CardTitle>
							<CardDescription>
								{t("payroll.period.dateRange", "{start} to {end}", {
									start: summary.period.start,
									end: summary.period.end,
								})}
							</CardDescription>
						</div>
						<p className="text-muted-foreground text-sm">
							{t("payroll.period.employeesInScope", "{count} employees in scope", {
								count: displayedTotals.employeeCount,
							})}
						</p>
						{filtersHaveNoMatches ? (
							<p className="text-destructive text-sm">
								{t(
									"payroll.filters.noMatchingEmployees",
									"No employees match the selected payroll filters.",
								)}
							</p>
						) : null}
					</div>

					<div className="flex flex-wrap gap-2 lg:justify-end">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={dateMode === "custom" || isPending}
							onClick={() => navigatePeriod("previous")}
						>
							<IconChevronLeft aria-hidden="true" className="size-4" />
							{t("payroll.period.previous", "Previous period")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={dateMode === "custom" || isPending}
							onClick={() => navigatePeriod("next")}
						>
							{t("payroll.period.next", "Next period")}
							<IconChevronRight aria-hidden="true" className="size-4" />
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={dateMode === "custom" || isPending}
							onClick={returnToCurrentPeriod}
						>
							<IconRefresh aria-hidden="true" className="size-4" />
							{t("payroll.period.current", "Current period")}
						</Button>
					</div>
				</CardHeader>
				<CardContent className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-end">
						<div className="flex gap-1 rounded-lg bg-muted p-1">
							{(["month", "week", "custom"] as const).map((mode) => (
								<Button
									key={mode}
									type="button"
									variant={dateMode === mode ? "default" : "ghost"}
									size="sm"
									disabled={isPending}
									aria-pressed={dateMode === mode}
									onClick={() => applyDateMode(mode)}
								>
									{getDateModeLabel(t, mode)}
								</Button>
							))}
						</div>

						<div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
							<div className="space-y-1">
								<Label htmlFor="payroll-start-date">{t("payroll.period.start", "Start")}</Label>
								<Input
									id="payroll-start-date"
									name="payroll-start-date"
									autoComplete="off"
									type="date"
									value={startDate}
									disabled={dateMode !== "custom" || isPending}
									onChange={(event) =>
										dispatch({ type: "startDateChanged", value: event.target.value })
									}
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
									onChange={(event) =>
										dispatch({ type: "endDateChanged", value: event.target.value })
									}
								/>
							</div>
							<Button
								type="button"
								disabled={dateMode !== "custom" || isPending}
								onClick={applyCustomRange}
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

					<div className="grid gap-3 sm:grid-cols-[auto_minmax(14rem,1fr)_auto] sm:items-end xl:justify-end">
						<Button
							type="button"
							variant="outline"
							disabled={isPending || filtersHaveNoMatches}
							onClick={downloadPdf}
						>
							{isPending ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconDownload aria-hidden="true" className="size-4" />
							)}
							{t("payroll.actions.downloadPdf", "Download PDF")}
						</Button>

						<div className="flex min-w-0 flex-col gap-2 sm:min-w-56">
							<Label htmlFor="payroll-export-target">
								{t("payroll.export.target", "Payroll export target")}
							</Label>
							<Select
								value={formatId}
								onValueChange={(formatId) => dispatch({ type: "formatChanged", formatId })}
								disabled={!hasExportFormats || isPending}
							>
								<SelectTrigger id="payroll-export-target" className="w-full">
									<SelectValue placeholder={t("payroll.export.selectFormat", "Select format")} />
								</SelectTrigger>
								<SelectContent>
									{exportFormats.map((format) => (
										<SelectItem key={format.id} value={format.id}>
											{format.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{!hasExportFormats ? (
								<p className="text-muted-foreground text-sm">
									{t("payroll.export.noConfiguredTarget", "No configured payroll export target")}
								</p>
							) : null}
						</div>

						<Button
							type="button"
							disabled={!hasExportFormats || isPending || filtersHaveNoMatches}
							onClick={triggerExport}
						>
							{isPending ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconFileExport aria-hidden="true" className="size-4" />
							)}
							{t("payroll.actions.triggerExport", "Trigger export")}
						</Button>
					</div>
				</CardContent>
			</Card>

			<section className="grid gap-4 md:grid-cols-4">
				<SummaryCard
					icon={<IconUsers aria-hidden="true" className="size-5" />}
					label={t("payroll.summary.employees", "Employees")}
					value={displayedTotals.employeeCount.toString()}
				/>
				<SummaryCard
					label={t("payroll.summary.workedHours", "Worked hours")}
					value={formatHours(displayedTotals.totalWorkedHours)}
				/>
				<SummaryCard
					label={t("payroll.summary.ready", "Ready")}
					value={readyEmployeeCount.toString()}
				/>
				<SummaryCard
					label={t("payroll.summary.blockers", "Blockers")}
					value={displayedTotals.blockerCount.toString()}
					tone={displayedTotals.blockerCount > 0 ? "warning" : "default"}
				/>
			</section>

			<Card>
				<CardHeader>
					<CardTitle>{t("payroll.scope.title", "Payroll scope")}</CardTitle>
					<CardDescription>
						{t(
							"payroll.scope.description",
							"Narrow this payroll workspace by assigned employees or teams.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-6 md:grid-cols-2">
					<div className="space-y-3">
						<div className="font-medium text-sm">
							{t("payroll.scope.assignedEmployees", "Assigned employees")}
						</div>
						<div className="grid gap-2">
							{scopedEmployees.map((employee) => (
								<label key={employee.id} className="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										className="size-4 rounded border-input accent-primary"
										checked={selectedEmployeeIds.includes(employee.id)}
										disabled={isPending}
										onChange={(event) => toggleEmployeeFilter(employee.id, event.target.checked)}
									/>
									<span>{employee.name}</span>
								</label>
							))}
						</div>
					</div>

					<div className="space-y-3">
						<div className="font-medium text-sm">
							{t("payroll.scope.assignedTeams", "Assigned teams")}
						</div>
						<div className="grid gap-2">
							{teamOptions.length > 0 ? (
								teamOptions.map((teamName) => (
									<label key={teamName} className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											className="size-4 rounded border-input accent-primary"
											checked={selectedTeamNames.includes(teamName)}
											disabled={isPending}
											onChange={(event) => toggleTeamFilter(teamName, event.target.checked)}
										/>
										<span>{teamName}</span>
									</label>
								))
							) : (
								<p className="text-muted-foreground text-sm">
									{t("payroll.scope.noAssignedTeams", "No assigned teams in this payroll scope.")}
								</p>
							)}
						</div>
					</div>
					{filtersHaveNoMatches ? (
						<p className="text-destructive text-sm md:col-span-2">
							{t(
								"payroll.filters.noMatchingEmployees",
								"No employees match the selected payroll filters.",
							)}
						</p>
					) : null}
				</CardContent>
			</Card>

			{displayedBlockers.length > 0 ? (
				<Alert className="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>
						{t("payroll.blockers.needReview", "{count} payroll blockers need review", {
							count: displayedBlockers.length,
						})}
					</AlertTitle>
					<AlertDescription>
						<ul className="mt-2 grid gap-1">
							{displayedBlockers.map((blocker) => (
								<li key={blocker.id}>{blocker.label}</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>{t("payroll.employeeTotals.title", "Employee totals")}</CardTitle>
					<CardDescription>
						{t(
							"payroll.employeeTotals.description",
							"Worked time, absence totals, contract type, and payroll status.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
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
							{displayedEmployees.length > 0 ? (
								displayedEmployees.map((employee) => (
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
											{formatTableHours(employee.workedHours)}
										</TableCell>
										<TableCell>{formatAbsences(t, employee.absenceDaysByCategory)}</TableCell>
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
				</CardContent>
			</Card>
		</div>
	);
}

function SummaryCard({
	icon,
	label,
	value,
	tone = "default",
}: {
	icon?: React.ReactNode;
	label: string;
	value: string;
	tone?: "default" | "warning";
}) {
	return (
		<Card
			className={
				tone === "warning"
					? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20"
					: undefined
			}
		>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardDescription>{label}</CardDescription>
				{icon}
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-semibold tracking-tight">{value}</div>
			</CardContent>
		</Card>
	);
}

function formatHours(hours: number) {
	return `${hours.toFixed(2)} h`;
}

function formatTableHours(hours: number) {
	return `${hours.toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
}

function formatAbsences(
	t: PayrollTranslate,
	absences: PayrollWorkspaceSummary["employees"][number]["absenceDaysByCategory"],
) {
	if (absences.length === 0) return t("payroll.employeeTotals.noAbsences", "None");

	return absences.map((absence) => `${absence.categoryName}: ${absence.days}`).join(", ");
}

function getDateModeLabel(t: PayrollTranslate, mode: PayrollDateRangeMode) {
	if (mode === "month") return t("payroll.period.mode.month", "Month");
	if (mode === "week") return t("payroll.period.mode.week", "Week");

	return t("payroll.period.mode.custom", "Custom");
}

function basePeriodRequest(summary: PayrollWorkspaceSummary): PayrollPeriodRequest {
	return {
		startDate: summary.period.start,
		endDate: summary.period.end,
		label: summary.period.label,
	};
}

function buildPeriodRequest(start: DateTime, mode: Exclude<PayrollDateRangeMode, "custom">) {
	const normalizedStart = start.startOf(mode);
	const end = normalizedStart.endOf(mode);

	return {
		startDate: normalizedStart.toISODate() ?? "",
		endDate: end.toISODate() ?? "",
		label: formatPeriodLabel(normalizedStart, end, mode),
	};
}

function getTeamOptions(employees: PayrollWorkspaceSummary["employees"]): string[] {
	return Array.from(
		new Set(employees.map((employee) => employee.teamName).filter(Boolean)),
	).toSorted() as string[];
}

function getFilteredEmployeeIds(
	employees: PayrollWorkspaceSummary["employees"],
	selectedEmployeeIds: string[],
	selectedTeamNames: string[],
): string[] | undefined {
	if (selectedEmployeeIds.length === 0 && selectedTeamNames.length === 0) return undefined;

	const selectedEmployeeIdSet = new Set(selectedEmployeeIds);
	const selectedTeamNameSet = new Set(selectedTeamNames);
	return employees
		.filter((employee) => {
			const matchesEmployee =
				selectedEmployeeIds.length === 0 || selectedEmployeeIdSet.has(employee.id);
			const matchesTeam =
				selectedTeamNames.length === 0 ||
				(employee.teamName !== null && selectedTeamNameSet.has(employee.teamName));

			return matchesEmployee && matchesTeam;
		})
		.map((employee) => employee.id);
}

function formatPeriodLabel(start: DateTime, end: DateTime, mode: PayrollDateRangeMode) {
	if (mode === "month") return start.toFormat("LLLL yyyy");
	if (mode === "week") return `${start.toFormat("LLL d")} - ${end.toFormat("LLL d, yyyy")}`;

	return `${start.toISODate()} - ${end.toISODate()}`;
}
