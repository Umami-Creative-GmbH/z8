"use client";

import {
	IconAlertTriangle,
	IconCalendarWeek,
	IconDownload,
	IconFileExport,
	IconLoader2,
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
	const request = {
		startDate: summary.period.start,
		endDate: summary.period.end,
		label: summary.period.label,
		employeeIds: filteredEmployeeIds,
	};

	function refreshSummary(nextRequest: PayrollPeriodRequest, employeeIds = filteredEmployeeIds) {
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
		setDateMode(nextMode);

		if (nextMode === "custom") return;

		const now = DateTime.utc();
		const start = now.startOf(nextMode);
		const end = now.endOf(nextMode);
		refreshSummary({
			startDate: start.toISODate() ?? summary.period.start,
			endDate: end.toISODate() ?? summary.period.end,
			label: formatPeriodLabel(start, end, nextMode),
		});
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
			<header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div className="space-y-1">
					<h1 className="text-3xl font-semibold tracking-tight">Payroll</h1>
					<p className="text-muted-foreground">{summary.period.label}</p>
				</div>

				<div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm md:flex-row md:items-end">
					<div className="flex gap-1 rounded-lg bg-muted p-1">
						{(["month", "week", "custom"] as const).map((mode) => (
							<Button
								key={mode}
								type="button"
								variant={dateMode === mode ? "default" : "ghost"}
								size="sm"
								disabled={isPending}
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
			</header>

			<section className="grid gap-4 md:grid-cols-4">
				<SummaryCard label="Selected period" value={summary.period.label} />
				<SummaryCard
					icon={<IconUsers aria-hidden="true" className="size-5" />}
					label="Employees"
					value={summary.totals.employeeCount.toString()}
				/>
				<SummaryCard label="Worked hours" value={formatHours(summary.totals.totalWorkedHours)} />
				<SummaryCard
					label="Blockers"
					value={summary.totals.blockerCount.toString()}
					tone={summary.totals.blockerCount > 0 ? "warning" : "default"}
				/>
			</section>

			<Card>
				<CardHeader>
					<CardTitle>Payroll filters</CardTitle>
					<CardDescription>
						Limit this workspace to employees and teams in your payroll scope.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-5 md:grid-cols-2">
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

			{summary.blockers.length > 0 ? (
				<Alert className="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>Payroll blockers require review</AlertTitle>
					<AlertDescription>
						<ul className="grid gap-1">
							{summary.blockers.map((blocker) => (
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
							{summary.employees.map((employee) => (
								<TableRow
									key={employee.id}
									className={
										employee.contractType === "hourly"
											? "bg-blue-50/50 dark:bg-blue-950/20"
											: undefined
									}
								>
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
											{employee.hasBlockers ? "Blocked" : "Ready"}
										</Badge>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Exports</CardTitle>
					<CardDescription>
						Download a review PDF or start a configured payroll export.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
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
						Download combined PDF
					</Button>

					<div className="flex flex-col gap-2 md:min-w-56">
						<Label>Payroll export target</Label>
						<Select
							value={formatId}
							onValueChange={setFormatId}
							disabled={!hasExportFormats || isPending}
						>
							<SelectTrigger aria-label="Payroll export target" className="w-full">
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
						Trigger payroll export
					</Button>
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

function getTeamOptions(employees: PayrollWorkspaceSummary["employees"]): string[] {
	return [
		...new Set(employees.map((employee) => employee.teamName).filter(Boolean)),
	].sort() as string[];
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
