"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	type DatevConfigResult,
	type FilterOptions,
	getFilterOptionsAction,
	startExportAction,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ExportFormProps {
	organizationId: string;
	config: DatevConfigResult | null;
	exportAvailability: Record<
		string,
		{
			configured: boolean;
			reason: "missingConfiguration" | "missingCredentials" | null;
		}
	>;
	onExportComplete?: () => void;
}

const EXPORT_FORMAT_IDS = [
	"datev_lohn",
	"lexware_lohn",
	"sage_lohn",
	"personio",
	"successfactors_api",
	"successfactors_csv",
	"workday_api",
] as const;
type Translate = ReturnType<typeof useTranslate>["t"];
type DateMode = "month" | "custom";

export function ExportForm({
	organizationId,
	config,
	exportAvailability,
	onExportComplete,
}: ExportFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const { data: filterOptions } = useQuery({
		queryKey: ["payroll-export-filter-options", organizationId],
		queryFn: async () => {
			const result = await getFilterOptionsAction(organizationId);
			return result.success ? result.data : null;
		},
	});
	const formatOptions = getFormatOptions(t);
	const firstConfiguredFormatId =
		EXPORT_FORMAT_IDS.find((id) => exportAvailability[id]?.configured) ??
		"datev_lohn";
	const [requestedFormatId, setRequestedFormatId] = useState(
		config?.formatId && exportAvailability[config.formatId]?.configured
			? config.formatId
			: firstConfiguredFormatId,
	);
	const selectedFormatId = exportAvailability[requestedFormatId]?.configured
		? requestedFormatId
		: firstConfiguredFormatId;
	const [dateMode, setDateMode] = useState<DateMode>("month");
	const [initialMonth] = useState(() => {
		const now = DateTime.now();
		return {
			year: now.year,
			month: now.month,
			start: now.startOf("month").toISODate() || "",
			end: now.endOf("month").toISODate() || "",
		};
	});
	const [selectedYear, setSelectedYear] = useState(initialMonth.year);
	const [selectedMonth, setSelectedMonth] = useState<number>(
		initialMonth.month,
	);
	const [customStartDate, setCustomStartDate] = useState(initialMonth.start);
	const [customEndDate, setCustomEndDate] = useState(initialMonth.end);
	const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
	const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
	const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

	const handleExport = () => {
		const dateRange =
			dateMode === "month"
				? (() => {
						const month = DateTime.fromObject({
							year: selectedYear,
							month: selectedMonth,
						});
						return {
							start: month.startOf("month").toISODate() ?? "",
							end: month.endOf("month").toISODate() ?? "",
						};
					})()
				: { start: customStartDate, end: customEndDate };
		startTransition(async () => {
			const result = await startExportAction({
				organizationId,
				formatId: selectedFormatId,
				startDate: dateRange.start,
				endDate: dateRange.end,
				employeeIds: selectedEmployeeIds.length
					? selectedEmployeeIds
					: undefined,
				teamIds: selectedTeamIds.length ? selectedTeamIds : undefined,
				projectIds: selectedProjectIds.length ? selectedProjectIds : undefined,
			});
			if (!result.success) {
				toast.error(t("settings.payrollExport.export.error", "Export failed"), {
					description: result.error,
				});
				return;
			}
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
				const url = window.URL.createObjectURL(
					new Blob([result.data.fileContent], {
						type: "text/csv;charset=utf-8",
					}),
				);
				const link = document.createElement("a");
				link.href = url;
				link.download = `${selectedFormatId}_${dateRange.start}_${dateRange.end}.csv`;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				window.URL.revokeObjectURL(url);
				toast.success(
					t("settings.payrollExport.export.success", "Export downloaded"),
				);
			}
			onExportComplete?.();
		});
	};

	const unavailableHints = formatOptions
		.flatMap((option) =>
			exportAvailability[option.id]?.configured
				? []
				: [
						{
							id: option.id,
							label: option.label,
							isMissingCredentials:
								exportAvailability[option.id]?.reason === "missingCredentials",
							reason:
								exportAvailability[option.id]?.reason === "missingCredentials"
									? t(
											"settings.payrollExport.export.unavailable.missingCredentials",
											"credentials",
										)
									: t(
											"settings.payrollExport.export.unavailable.missingConfiguration",
											"config",
										),
						},
					],
		)
		.sort((left, right) =>
			left.isMissingCredentials === right.isMissingCredentials
				? left.label.localeCompare(right.label)
				: left.isMissingCredentials
					? -1
					: 1,
		);
	const years = Array.from(
		{ length: 5 },
		(_, index) => initialMonth.year - index,
	);
	const months = Array.from({ length: 12 }, (_, index) => ({
		value: index + 1,
		label: DateTime.fromObject({ month: index + 1 }).toFormat("LLLL"),
	}));
	const toggle = (
		setter: React.Dispatch<React.SetStateAction<string[]>>,
		id: string,
	) =>
		setter((current) =>
			current.includes(id)
				? current.filter((value) => value !== id)
				: [...current, id],
		);

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
				<FormatSection
					availability={exportAvailability}
					options={formatOptions}
					value={selectedFormatId}
					onChange={setRequestedFormatId}
					hints={unavailableHints}
					t={t}
				/>
				<DateSection
					mode={dateMode}
					year={selectedYear}
					month={selectedMonth}
					start={customStartDate}
					end={customEndDate}
					years={years}
					months={months}
					onModeChange={setDateMode}
					onYearChange={setSelectedYear}
					onMonthChange={setSelectedMonth}
					onStartChange={setCustomStartDate}
					onEndChange={setCustomEndDate}
					t={t}
				/>
				<FiltersSection
					options={filterOptions}
					employeeIds={selectedEmployeeIds}
					teamIds={selectedTeamIds}
					projectIds={selectedProjectIds}
					onToggleEmployee={(id) => toggle(setSelectedEmployeeIds, id)}
					onToggleTeam={(id) => toggle(setSelectedTeamIds, id)}
					onToggleProject={(id) => toggle(setSelectedProjectIds, id)}
					onClearEmployees={() => setSelectedEmployeeIds([])}
					onClearTeams={() => setSelectedTeamIds([])}
					onClearProjects={() => setSelectedProjectIds([])}
					t={t}
				/>
			</CardContent>
			<CardFooter>
				<Button
					onClick={handleExport}
					disabled={
						isPending || !exportAvailability[selectedFormatId]?.configured
					}
				>
					{isPending ? (
						<>
							<IconLoader2 className="mr-2 size-4 animate-spin" />
							{t("settings.payrollExport.export.exporting", "Exporting…")}
						</>
					) : (
						<>
							<IconDownload className="mr-2 size-4" />
							{getExportButtonLabel(selectedFormatId, t)}
						</>
					)}
				</Button>
			</CardFooter>
		</Card>
	);
}

function getFormatOptions(t: Translate) {
	return [
		{
			id: "datev_lohn",
			label: t("settings.payrollExport.export.format.datev", "DATEV"),
		},
		{
			id: "lexware_lohn",
			label: t("settings.payrollExport.export.format.lexware", "Lexware"),
		},
		{
			id: "sage_lohn",
			label: t("settings.payrollExport.export.format.sage", "Sage"),
		},
		{
			id: "personio",
			label: t("settings.payrollExport.export.format.personio", "Personio"),
		},
		{
			id: "successfactors_api",
			label: t(
				"settings.payrollExport.export.format.successfactorsApi",
				"SAP SuccessFactors (API)",
			),
		},
		{
			id: "successfactors_csv",
			label: t(
				"settings.payrollExport.export.format.successfactorsCsv",
				"SAP SuccessFactors (CSV)",
			),
		},
		{
			id: "workday_api",
			label: t("settings.payrollExport.export.format.workday", "Workday"),
		},
	];
}

function getExportButtonLabel(id: string, t: Translate) {
	const labels: Record<string, [string, string]> = {
		lexware_lohn: [
			"settings.payrollExport.export.exportButtonLexware",
			"Export to Lexware",
		],
		sage_lohn: [
			"settings.payrollExport.export.exportButtonSage",
			"Export to Sage",
		],
		personio: [
			"settings.payrollExport.export.exportButtonPersonio",
			"Export to Personio",
		],
		successfactors_api: [
			"settings.payrollExport.export.exportButtonSuccessFactorsApi",
			"Export to SAP SuccessFactors (API)",
		],
		successfactors_csv: [
			"settings.payrollExport.export.exportButtonSuccessFactorsCsv",
			"Export SAP SuccessFactors CSV",
		],
		workday_api: [
			"settings.payrollExport.export.exportButtonWorkday",
			"Export to Workday",
		],
	};
	const [key, fallback] = labels[id] ?? [
		"settings.payrollExport.export.exportButtonDatev",
		"Export to DATEV",
	];
	return t(key, fallback);
}

function FormatSection({
	availability,
	options,
	value,
	onChange,
	hints,
	t,
}: {
	availability: ExportFormProps["exportAvailability"];
	options: Array<{ id: string; label: string }>;
	value: string;
	onChange: (value: string) => void;
	hints: Array<{
		id: string;
		label: string;
		isMissingCredentials: boolean;
		reason: string;
	}>;
	t: Translate;
}) {
	return (
		<div className="space-y-2">
			<Label>
				{t("settings.payrollExport.export.format", "Export Format")}
			</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem
							key={option.id}
							value={option.id}
							disabled={!availability[option.id]?.configured}
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{hints.length ? (
				<div className="flex flex-wrap gap-2">
					{hints.map((hint) => (
						<Badge
							key={hint.id}
							variant="outline"
							className={
								hint.isMissingCredentials
									? "border-amber-300 bg-amber-50 text-amber-700 text-xs"
									: "border-slate-300 bg-slate-50 text-slate-700 text-xs"
							}
						>
							{hint.label} - {hint.reason}
						</Badge>
					))}
				</div>
			) : null}
		</div>
	);
}

function DateSection({
	mode,
	year,
	month,
	start,
	end,
	years,
	months,
	onModeChange,
	onYearChange,
	onMonthChange,
	onStartChange,
	onEndChange,
	t,
}: {
	mode: DateMode;
	year: number;
	month: number;
	start: string;
	end: string;
	years: number[];
	months: Array<{ value: number; label: string }>;
	onModeChange: (value: DateMode) => void;
	onYearChange: (value: number) => void;
	onMonthChange: (value: number) => void;
	onStartChange: (value: string) => void;
	onEndChange: (value: string) => void;
	t: Translate;
}) {
	return (
		<div className="space-y-4">
			<Label>
				{t("settings.payrollExport.export.dateRange", "Date Range")}
			</Label>
			<Tabs
				value={mode}
				onValueChange={(value) => onModeChange(value as DateMode)}
			>
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
						<NumberSelect
							label={t("settings.payrollExport.export.year", "Year")}
							value={year}
							options={years.map((value) => ({ value, label: String(value) }))}
							onChange={onYearChange}
						/>
						<NumberSelect
							label={t("settings.payrollExport.export.month", "Month")}
							value={month}
							options={months}
							onChange={onMonthChange}
						/>
					</div>
				</TabsContent>
				<TabsContent value="custom" className="space-y-4 pt-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label>
								{t("settings.payrollExport.export.startDate", "Start Date")}
							</Label>
							<DatePicker value={start} onChange={onStartChange} />
						</div>
						<div className="space-y-2">
							<Label>
								{t("settings.payrollExport.export.endDate", "End Date")}
							</Label>
							<DatePicker value={end} onChange={onEndChange} />
						</div>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function NumberSelect({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: number;
	options: Array<{ value: number; label: string }>;
	onChange: (value: number) => void;
}) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<Select
				value={String(value)}
				onValueChange={(next) => onChange(parseInt(next, 10))}
			>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={String(option.value)}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function FiltersSection({
	options,
	employeeIds,
	teamIds,
	projectIds,
	onToggleEmployee,
	onToggleTeam,
	onToggleProject,
	onClearEmployees,
	onClearTeams,
	onClearProjects,
	t,
}: {
	options: FilterOptions | null | undefined;
	employeeIds: string[];
	teamIds: string[];
	projectIds: string[];
	onToggleEmployee: (id: string) => void;
	onToggleTeam: (id: string) => void;
	onToggleProject: (id: string) => void;
	onClearEmployees: () => void;
	onClearTeams: () => void;
	onClearProjects: () => void;
	t: Translate;
}) {
	return (
		<div className="space-y-4">
			<Label>
				{t("settings.payrollExport.export.filters", "Filters (Optional)")}
			</Label>
			<div className="grid gap-4 md:grid-cols-3">
				<FilterPopover
					kind="employees"
					items={options?.employees ?? []}
					selectedIds={employeeIds}
					onToggle={onToggleEmployee}
					onClear={onClearEmployees}
					t={t}
				/>
				<FilterPopover
					kind="teams"
					items={options?.teams ?? []}
					selectedIds={teamIds}
					onToggle={onToggleTeam}
					onClear={onClearTeams}
					t={t}
				/>
				<FilterPopover
					kind="projects"
					items={options?.projects ?? []}
					selectedIds={projectIds}
					onToggle={onToggleProject}
					onClear={onClearProjects}
					t={t}
				/>
			</div>
		</div>
	);
}

function FilterPopover({
	kind,
	items,
	selectedIds,
	onToggle,
	onClear,
	t,
}: {
	kind: "employees" | "teams" | "projects";
	items: Array<{
		id: string;
		name?: string;
		firstName?: string | null;
		lastName?: string | null;
		employeeNumber?: string | null;
	}>;
	selectedIds: string[];
	onToggle: (id: string) => void;
	onClear: () => void;
	t: Translate;
}) {
	const labels =
		kind === "employees"
			? ["Employees", "All Employees", "emp"]
			: kind === "teams"
				? ["Teams", "All Teams", "team"]
				: ["Projects", "All Projects", "project"];
	const selected = new Set(selectedIds);
	return (
		<div className="space-y-2">
			<Label className="text-sm text-muted-foreground">
				{t(`settings.payrollExport.export.${kind}`, labels[0])}
			</Label>
			<Popover>
				<PopoverTrigger asChild>
					<Button variant="outline" className="w-full justify-start">
						{selectedIds.length
							? t(
									`settings.payrollExport.export.${kind}Selected`,
									"{{count}} selected",
									{ count: selectedIds.length },
								)
							: t(`settings.payrollExport.export.all${labels[0]}`, labels[1])}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[300px] p-0" align="start">
					<ScrollArea className="h-[200px] p-4">
						{items.map((item) => (
							<div key={item.id} className="flex items-center gap-x-2 py-1">
								<Checkbox
									id={`${labels[2]}-${item.id}`}
									checked={selected.has(item.id)}
									onCheckedChange={() => onToggle(item.id)}
								/>
								<label
									htmlFor={`${labels[2]}-${item.id}`}
									className="cursor-pointer text-sm"
								>
									{item.name ?? (
										<>
											{item.firstName} {item.lastName}
										</>
									)}
									{item.employeeNumber ? (
										<span className="text-muted-foreground">
											{" "}
											({item.employeeNumber})
										</span>
									) : null}
								</label>
							</div>
						))}
					</ScrollArea>
					{selectedIds.length ? (
						<div className="border-t p-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={onClear}
								className="w-full"
							>
								{t("common.clearSelection", "Clear Selection")}
							</Button>
						</div>
					) : null}
				</PopoverContent>
			</Popover>
		</div>
	);
}
