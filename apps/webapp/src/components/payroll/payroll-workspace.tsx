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
import { DateTime } from "luxon";
import type React from "react";
import { useState, useTransition } from "react";
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

export function PayrollWorkspace({ initialSummary, exportFormats }: PayrollWorkspaceProps) {
	const [summary, setSummary] = useState(initialSummary);
	const [dateMode, setDateMode] = useState<PayrollDateRangeMode>("month");
	const [startDate, setStartDate] = useState(initialSummary.period.start);
	const [endDate, setEndDate] = useState(initialSummary.period.end);
	const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
	const [selectedTeamNames, setSelectedTeamNames] = useState<string[]>([]);
	const [formatId, setFormatId] = useState(exportFormats[0]?.id ?? "");
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
			toast.error("No employees match the selected payroll filters");
			return;
		}

		startTransition(async () => {
			const result = await getPayrollWorkspaceSummaryAction({ ...nextRequest, employeeIds });

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			setSummary(result.data);
			setStartDate(result.data.period.start);
			setEndDate(result.data.period.end);
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

		setSelectedEmployeeIds(nextEmployeeIds);
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

		setSelectedTeamNames(nextTeamNames);
		refreshSummary(basePeriodRequest(summary), nextFilteredEmployeeIds);
	}

	function applyDateMode(nextMode: PayrollDateRangeMode) {
		if (nextMode === "custom") {
			setDateMode(nextMode);
			return;
		}

		refreshSummary(
			buildPeriodRequest(DateTime.utc().startOf(nextMode), nextMode),
			filteredEmployeeIds,
			() => setDateMode(nextMode),
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
			toast.error("No employees match the selected payroll filters");
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
			toast.error("No employees match the selected payroll filters");
			return;
		}

		startTransition(async () => {
			const result = await startScopedPayrollExportAction({ ...request, formatId });

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			toast.success(result.data.isAsync ? "Payroll export queued" : "Payroll export completed");
		});
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-1">
				<div className="space-y-1">
					<h1 className="text-3xl font-semibold tracking-tight">Payroll</h1>
					<p className="text-muted-foreground">
						Review payroll totals, readiness, and exports for the selected period.
					</p>
				</div>
			</header>

			<Card>
				<CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
					<div className="space-y-2">
						<div className="flex items-center gap-2 text-muted-foreground text-sm">
							<IconCalendarWeek aria-hidden="true" className="size-4" />
							<span>Selected period</span>
						</div>
						<div>
							<CardTitle aria-level={2} className="text-2xl" role="heading">
								{summary.period.label}
							</CardTitle>
							<CardDescription>
								{summary.period.start} to {summary.period.end}
							</CardDescription>
						</div>
						<p className="text-muted-foreground text-sm">
							{displayedTotals.employeeCount} employees in scope
						</p>
						{filtersHaveNoMatches ? (
							<p className="text-destructive text-sm">
								No employees match the selected payroll filters.
							</p>
						) : null}
					</div>

					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={dateMode === "custom" || isPending}
							onClick={() => navigatePeriod("previous")}
						>
							<IconChevronLeft aria-hidden="true" className="size-4" />
							Previous period
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={dateMode === "custom" || isPending}
							onClick={() => navigatePeriod("next")}
						>
							Next period
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
							Current period
						</Button>
					</div>
				</CardHeader>
				<CardContent className="grid gap-5 xl:grid-cols-[1fr_auto]">
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
									{toTitleCase(mode)}
								</Button>
							))}
						</div>

						<div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
							<div className="space-y-1">
								<Label htmlFor="payroll-start-date">Start</Label>
								<Input
									id="payroll-start-date"
									name="payroll-start-date"
									autoComplete="off"
									type="date"
									value={startDate}
									disabled={dateMode !== "custom" || isPending}
									onChange={(event) => setStartDate(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="payroll-end-date">End</Label>
								<Input
									id="payroll-end-date"
									name="payroll-end-date"
									autoComplete="off"
									type="date"
									value={endDate}
									disabled={dateMode !== "custom" || isPending}
									onChange={(event) => setEndDate(event.target.value)}
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
								Apply
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-3 lg:flex-row lg:items-end xl:justify-end">
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
							Download PDF
						</Button>

						<div className="flex flex-col gap-2 lg:min-w-56">
							<Label htmlFor="payroll-export-target">Payroll export target</Label>
							<Select
								value={formatId}
								onValueChange={setFormatId}
								disabled={!hasExportFormats || isPending}
							>
								<SelectTrigger id="payroll-export-target" className="w-full">
									<SelectValue placeholder="Select format" />
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
								<p className="text-muted-foreground text-sm">No configured payroll export target</p>
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
							Trigger export
						</Button>
					</div>
				</CardContent>
			</Card>

			<section className="grid gap-4 md:grid-cols-4">
				<SummaryCard
					icon={<IconUsers aria-hidden="true" className="size-5" />}
					label="Employees"
					value={displayedTotals.employeeCount.toString()}
				/>
				<SummaryCard label="Worked hours" value={formatHours(displayedTotals.totalWorkedHours)} />
				<SummaryCard label="Ready" value={readyEmployeeCount.toString()} />
				<SummaryCard
					label="Blockers"
					value={displayedTotals.blockerCount.toString()}
					tone={displayedTotals.blockerCount > 0 ? "warning" : "default"}
				/>
			</section>

			<Card>
				<CardHeader>
					<CardTitle>Payroll scope</CardTitle>
					<CardDescription>
						Narrow this payroll workspace by assigned employees or teams.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-6 md:grid-cols-2">
					<div className="space-y-3">
						<div className="font-medium text-sm">Assigned employees</div>
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
						<div className="font-medium text-sm">Assigned teams</div>
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
									No assigned teams in this payroll scope.
								</p>
							)}
						</div>
					</div>
					{filtersHaveNoMatches ? (
						<p className="text-destructive text-sm md:col-span-2">
							No employees match the selected payroll filters.
						</p>
					) : null}
				</CardContent>
			</Card>

			{displayedBlockers.length > 0 ? (
				<Alert className="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>{displayedBlockers.length} payroll blockers need review</AlertTitle>
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
					<CardTitle>Employee totals</CardTitle>
					<CardDescription>
						Worked time, absence totals, contract type, and payroll status.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Employee</TableHead>
								<TableHead>Team</TableHead>
								<TableHead>Contract</TableHead>
								<TableHead className="text-right">Hours</TableHead>
								<TableHead>Absences</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{displayedEmployees.length > 0 ? (
								displayedEmployees.map((employee) => (
									<TableRow key={employee.id}>
										<TableCell>
											<div className="font-medium">{employee.name}</div>
											<div className="text-muted-foreground text-xs">
												{employee.employeeNumber ?? "No employee number"}
											</div>
										</TableCell>
										<TableCell>{employee.teamName ?? "No team"}</TableCell>
										<TableCell>
											<Badge variant={employee.contractType === "hourly" ? "default" : "secondary"}>
												{employee.contractType === "hourly" ? "Hourly" : "Fixed"}
											</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatTableHours(employee.workedHours)}
										</TableCell>
										<TableCell>{formatAbsences(employee.absenceDaysByCategory)}</TableCell>
										<TableCell>
											<Badge variant={employee.hasBlockers ? "destructive" : "secondary"}>
												{employee.hasBlockers ? "Blocked" : "Ready for payroll"}
											</Badge>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
										No employees match the selected payroll filters.
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
	absences: PayrollWorkspaceSummary["employees"][number]["absenceDaysByCategory"],
) {
	if (absences.length === 0) return "None";

	return absences.map((absence) => `${absence.categoryName}: ${absence.days}`).join(", ");
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

function toTitleCase(value: string) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
