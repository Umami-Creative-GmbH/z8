"use client";

import { IconCalendar, IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	getFilterOptionsAction,
	startExportAction,
	type DatevConfigResult,
	type FilterOptions,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ExportFormProps {
	organizationId: string;
	config: DatevConfigResult | null;
	onExportComplete?: () => void;
}

export function ExportForm({ organizationId, config, onExportComplete }: ExportFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

	// Date selection
	const [dateMode, setDateMode] = useState<"month" | "custom">("month");
	const [selectedYear, setSelectedYear] = useState<number>(DateTime.now().year);
	const [selectedMonth, setSelectedMonth] = useState<number>(DateTime.now().month);
	const [customStartDate, setCustomStartDate] = useState<string>(
		DateTime.now().startOf("month").toISODate() || "",
	);
	const [customEndDate, setCustomEndDate] = useState<string>(
		DateTime.now().endOf("month").toISODate() || "",
	);

	// Filters
	const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
	const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
	const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

	// Export result
	const [exportResult, setExportResult] = useState<{
		isAsync: boolean;
		fileContent?: string;
		fileName?: string;
	} | null>(null);

	// Memoize loader to avoid dependency warning
	const loadFilterOptions = useCallback(async () => {
		startTransition(async () => {
			const result = await getFilterOptionsAction(organizationId);
			if (result.success) {
				setFilterOptions(result.data);
			}
		});
	}, [organizationId]);

	// Load filter options on mount
	useEffect(() => {
		if (config) {
			loadFilterOptions();
		}
	}, [config, loadFilterOptions]);

	const getDateRange = () => {
		if (dateMode === "month") {
			const dt = DateTime.fromObject({ year: selectedYear, month: selectedMonth });
			return {
				start: dt.startOf("month").toISODate()!,
				end: dt.endOf("month").toISODate()!,
			};
		}
		return {
			start: customStartDate,
			end: customEndDate,
		};
	};

	const handleExport = async () => {
		if (!config) return;

		const dateRange = getDateRange();

		startTransition(async () => {
			const result = await startExportAction({
				organizationId,
				startDate: dateRange.start,
				endDate: dateRange.end,
				employeeIds: selectedEmployeeIds.length > 0 ? selectedEmployeeIds : undefined,
				teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
				projectIds: selectedProjectIds.length > 0 ? selectedProjectIds : undefined,
			});

			if (result.success) {
				if (result.data.isAsync) {
					toast.success(
						t("settings.payrollExport.export.asyncStarted", "Export started"),
						{
							description: t(
								"settings.payrollExport.export.asyncDescription",
								"Your export is being processed. Check the history tab for progress.",
							),
						},
					);
				} else if (result.data.fileContent) {
					// Sync export - trigger download
					const blob = new Blob([result.data.fileContent], { type: "text/csv;charset=utf-8" });
					const url = window.URL.createObjectURL(blob);
					const link = document.createElement("a");
					link.href = url;
					link.download = `datev_lohn_${dateRange.start}_${dateRange.end}.csv`;
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					window.URL.revokeObjectURL(url);

					toast.success(t("settings.payrollExport.export.success", "Export downloaded"));
				}
				onExportComplete?.();
			} else {
				toast.error(t("settings.payrollExport.export.error", "Export failed"), {
					description: result.error,
				});
			}
		});
	};

	// Memoize static arrays to prevent recreation on each render (rerender-hoist-jsx)
	const years = useMemo(
		() => Array.from({ length: 5 }, (_, i) => DateTime.now().year - i),
		[],
	);
	const months = useMemo(
		() =>
			Array.from({ length: 12 }, (_, i) => ({
				value: i + 1,
				label: DateTime.fromObject({ month: i + 1 }).toFormat("LLLL"),
			})),
		[],
	);

	// Use functional setState for stable callbacks (rerender-functional-setstate)
	const toggleEmployee = useCallback((id: string) => {
		setSelectedEmployeeIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	}, []);

	const toggleTeam = useCallback((id: string) => {
		setSelectedTeamIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	}, []);

	const toggleProject = useCallback((id: string) => {
		setSelectedProjectIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	}, []);

	if (!config) {
		return (
			<Card className="border-warning">
				<CardHeader>
					<CardTitle>
						{t("settings.payrollExport.export.notConfiguredTitle", "Configuration Required")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.export.notConfiguredDescription",
							"Please configure DATEV master data and wage type mappings before exporting.",
						)}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.payrollExport.export.title", "Export Payroll Data")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.payrollExport.export.description",
						"Export work periods and absences to DATEV Lohn & Gehalt format",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Date Range Selection */}
				<div className="space-y-4">
					<Label>{t("settings.payrollExport.export.dateRange", "Date Range")}</Label>
					<Tabs value={dateMode} onValueChange={(v) => setDateMode(v as "month" | "custom")}>
						<TabsList>
							<TabsTrigger value="month">
								{t("settings.payrollExport.export.monthSelection", "Select Month")}
							</TabsTrigger>
							<TabsTrigger value="custom">
								{t("settings.payrollExport.export.customRange", "Custom Range")}
							</TabsTrigger>
						</TabsList>
						<TabsContent value="month" className="space-y-4 pt-4">
							<div className="grid gap-4 md:grid-cols-2">
								<div className="space-y-2">
									<Label>{t("settings.payrollExport.export.year", "Year")}</Label>
									<Select
										value={selectedYear.toString()}
										onValueChange={(v) => setSelectedYear(parseInt(v))}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{years.map((year) => (
												<SelectItem key={year} value={year.toString()}>
													{year}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label>{t("settings.payrollExport.export.month", "Month")}</Label>
									<Select
										value={selectedMonth.toString()}
										onValueChange={(v) => setSelectedMonth(parseInt(v))}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{months.map((month) => (
												<SelectItem key={month.value} value={month.value.toString()}>
													{month.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</TabsContent>
						<TabsContent value="custom" className="space-y-4 pt-4">
							<div className="grid gap-4 md:grid-cols-2">
								<div className="space-y-2">
									<Label>{t("settings.payrollExport.export.startDate", "Start Date")}</Label>
									<Input
										type="date"
										value={customStartDate}
										onChange={(e) => setCustomStartDate(e.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label>{t("settings.payrollExport.export.endDate", "End Date")}</Label>
									<Input
										type="date"
										value={customEndDate}
										onChange={(e) => setCustomEndDate(e.target.value)}
									/>
								</div>
							</div>
						</TabsContent>
					</Tabs>
				</div>

				{/* Filters */}
				<div className="space-y-4">
					<Label>{t("settings.payrollExport.export.filters", "Filters (Optional)")}</Label>
					<div className="grid gap-4 md:grid-cols-3">
						{/* Employee Filter */}
						<div className="space-y-2">
							<Label className="text-sm text-muted-foreground">
								{t("settings.payrollExport.export.employees", "Employees")}
							</Label>
							<Popover>
								<PopoverTrigger asChild>
									<Button variant="outline" className="w-full justify-start">
										{selectedEmployeeIds.length === 0
											? t("settings.payrollExport.export.allEmployees", "All Employees")
											: t("settings.payrollExport.export.employeesSelected", "{{count}} selected", {
													count: selectedEmployeeIds.length,
												})}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[300px] p-0" align="start">
									<ScrollArea className="h-[200px] p-4">
										{filterOptions?.employees.map((emp) => (
											<div
												key={emp.id}
												className="flex items-center space-x-2 py-1"
											>
												<Checkbox
													id={`emp-${emp.id}`}
													checked={selectedEmployeeIds.includes(emp.id)}
													onCheckedChange={() => toggleEmployee(emp.id)}
												/>
												<label
													htmlFor={`emp-${emp.id}`}
													className="text-sm cursor-pointer"
												>
													{emp.firstName} {emp.lastName}
													{emp.employeeNumber && (
														<span className="text-muted-foreground">
															{" "}
															({emp.employeeNumber})
														</span>
													)}
												</label>
											</div>
										))}
									</ScrollArea>
									{selectedEmployeeIds.length > 0 && (
										<div className="border-t p-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setSelectedEmployeeIds([])}
												className="w-full"
											>
												{t("common.clearSelection", "Clear Selection")}
											</Button>
										</div>
									)}
								</PopoverContent>
							</Popover>
						</div>

						{/* Team Filter */}
						<div className="space-y-2">
							<Label className="text-sm text-muted-foreground">
								{t("settings.payrollExport.export.teams", "Teams")}
							</Label>
							<Popover>
								<PopoverTrigger asChild>
									<Button variant="outline" className="w-full justify-start">
										{selectedTeamIds.length === 0
											? t("settings.payrollExport.export.allTeams", "All Teams")
											: t("settings.payrollExport.export.teamsSelected", "{{count}} selected", {
													count: selectedTeamIds.length,
												})}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[300px] p-0" align="start">
									<ScrollArea className="h-[200px] p-4">
										{filterOptions?.teams.map((team) => (
											<div
												key={team.id}
												className="flex items-center space-x-2 py-1"
											>
												<Checkbox
													id={`team-${team.id}`}
													checked={selectedTeamIds.includes(team.id)}
													onCheckedChange={() => toggleTeam(team.id)}
												/>
												<label
													htmlFor={`team-${team.id}`}
													className="text-sm cursor-pointer"
												>
													{team.name}
												</label>
											</div>
										))}
									</ScrollArea>
									{selectedTeamIds.length > 0 && (
										<div className="border-t p-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setSelectedTeamIds([])}
												className="w-full"
											>
												{t("common.clearSelection", "Clear Selection")}
											</Button>
										</div>
									)}
								</PopoverContent>
							</Popover>
						</div>

						{/* Project Filter */}
						<div className="space-y-2">
							<Label className="text-sm text-muted-foreground">
								{t("settings.payrollExport.export.projects", "Projects")}
							</Label>
							<Popover>
								<PopoverTrigger asChild>
									<Button variant="outline" className="w-full justify-start">
										{selectedProjectIds.length === 0
											? t("settings.payrollExport.export.allProjects", "All Projects")
											: t("settings.payrollExport.export.projectsSelected", "{{count}} selected", {
													count: selectedProjectIds.length,
												})}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[300px] p-0" align="start">
									<ScrollArea className="h-[200px] p-4">
										{filterOptions?.projects.map((project) => (
											<div
												key={project.id}
												className="flex items-center space-x-2 py-1"
											>
												<Checkbox
													id={`project-${project.id}`}
													checked={selectedProjectIds.includes(project.id)}
													onCheckedChange={() => toggleProject(project.id)}
												/>
												<label
													htmlFor={`project-${project.id}`}
													className="text-sm cursor-pointer"
												>
													{project.name}
												</label>
											</div>
										))}
									</ScrollArea>
									{selectedProjectIds.length > 0 && (
										<div className="border-t p-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setSelectedProjectIds([])}
												className="w-full"
											>
												{t("common.clearSelection", "Clear Selection")}
											</Button>
										</div>
									)}
								</PopoverContent>
							</Popover>
						</div>
					</div>
				</div>
			</CardContent>
			<CardFooter>
				<Button onClick={handleExport} disabled={isPending}>
					{isPending ? (
						<>
							<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							{t("settings.payrollExport.export.exporting", "Exporting…")}
						</>
					) : (
						<>
							<IconDownload className="mr-2 h-4 w-4" />
							{t("settings.payrollExport.export.exportButton", "Export to DATEV")}
						</>
					)}
				</Button>
			</CardFooter>
		</Card>
	);
}
