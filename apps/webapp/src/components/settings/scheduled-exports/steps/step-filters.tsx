/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useTranslate } from "@tolgee/react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { FilterSelector, type FilterItem } from "../filter-selector";
import type { ScheduledExportForm } from "../scheduled-export-dialog";
import type { DateRangeStrategy } from "@/lib/scheduled-exports/domain/types";

interface StepFiltersProps {
	form: ScheduledExportForm;
	filterOptions: FilterOptions | null;
}

export interface FilterOptions {
	employees: Array<{ id: string; firstName: string; lastName: string; employeeNumber?: string }>;
	teams: Array<{ id: string; name: string }>;
	projects: Array<{ id: string; name: string }>;
}

export function StepFilters({ form, filterOptions }: StepFiltersProps) {
	const { t } = useTranslate();

	const DATE_RANGE_STRATEGIES: {
		value: DateRangeStrategy;
		label: string;
		description: string;
	}[] = [
		{
			value: "previous_day",
			label: t("settings.scheduledExports.dateRange.previousDay", "Previous Day"),
			description: t("settings.scheduledExports.dateRange.previousDayDesc", "Export data from the previous day"),
		},
		{
			value: "previous_week",
			label: t("settings.scheduledExports.dateRange.previousWeek", "Previous Week"),
			description: t("settings.scheduledExports.dateRange.previousWeekDesc", "Export data from the previous week (Mon-Sun)"),
		},
		{
			value: "previous_month",
			label: t("settings.scheduledExports.dateRange.previousMonth", "Previous Month"),
			description: t("settings.scheduledExports.dateRange.previousMonthDesc", "Export data from the previous calendar month"),
		},
		{
			value: "previous_quarter",
			label: t("settings.scheduledExports.dateRange.previousQuarter", "Previous Quarter"),
			description: t("settings.scheduledExports.dateRange.previousQuarterDesc", "Export data from the previous quarter"),
		},
	];

	// Convert filter options to FilterItem format
	const employeeItems: FilterItem[] = (filterOptions?.employees || []).map((emp) => ({
		id: emp.id,
		label: `${emp.firstName} ${emp.lastName}`,
		sublabel: emp.employeeNumber,
	}));

	const teamItems: FilterItem[] = (filterOptions?.teams || []).map((team) => ({
		id: team.id,
		label: team.name,
	}));

	const projectItems: FilterItem[] = (filterOptions?.projects || []).map((project) => ({
		id: project.id,
		label: project.name,
	}));

	return (
		<div className="space-y-6">
			<form.Field name="dateRangeStrategy">
				{(field: any) => (
					<div className="space-y-2">
						<Label id="date-range-label">
							{t("settings.scheduledExports.filters.dateRange", "Date Range")} *
						</Label>
						<Select
							value={field.state.value}
							onValueChange={(v) => field.handleChange(v as DateRangeStrategy)}
							aria-labelledby="date-range-label"
						>
							<SelectTrigger aria-describedby="date-range-hint">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DATE_RANGE_STRATEGIES.map((strategy) => (
									<SelectItem key={strategy.value} value={strategy.value}>
										<div>
											<div>{strategy.label}</div>
											<div className="text-xs text-muted-foreground">
												{strategy.description}
											</div>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p id="date-range-hint" className="text-xs text-muted-foreground">
							{t("settings.scheduledExports.filters.dateRangeHint", "The date range is calculated automatically based on when the export runs")}
						</p>
					</div>
				)}
			</form.Field>

			<div className="space-y-2">
				<Label>{t("settings.scheduledExports.filters.filtersOptional", "Filters (Optional)")}</Label>
				<p className="text-sm text-muted-foreground">
					{t("settings.scheduledExports.filters.filtersHint", "Leave empty to include all employees, teams, and projects")}
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<form.Field name="filters">
					{(field: any) => {
						const filters = field.state.value || {};
						const employeeIds = filters.employeeIds || [];
						const teamIds = filters.teamIds || [];
						const projectIds = filters.projectIds || [];

						const updateFilter = (key: string, ids: string[]) => {
							field.handleChange({
								...filters,
								[key]: ids.length > 0 ? ids : undefined,
							});
						};

						return (
							<>
								<FilterSelector
									label={t("settings.scheduledExports.filters.employees", "Employees")}
									items={employeeItems}
									selectedIds={employeeIds}
									onSelectionChange={(ids) => updateFilter("employeeIds", ids)}
									allLabel={t("settings.scheduledExports.filters.allEmployees", "All Employees")}
									selectedLabel={(count) => t("settings.scheduledExports.filters.selectedCount", "{count} selected", { count })}
									emptyMessage={t("settings.scheduledExports.filters.noEmployees", "No employees found")}
									clearLabel={t("settings.scheduledExports.filters.clearSelection", "Clear Selection")}
									ariaLabel={t("settings.scheduledExports.filters.selectEmployees", "Select employees to filter")}
								/>

								<FilterSelector
									label={t("settings.scheduledExports.filters.teams", "Teams")}
									items={teamItems}
									selectedIds={teamIds}
									onSelectionChange={(ids) => updateFilter("teamIds", ids)}
									allLabel={t("settings.scheduledExports.filters.allTeams", "All Teams")}
									selectedLabel={(count) => t("settings.scheduledExports.filters.selectedCount", "{count} selected", { count })}
									emptyMessage={t("settings.scheduledExports.filters.noTeams", "No teams found")}
									clearLabel={t("settings.scheduledExports.filters.clearSelection", "Clear Selection")}
									ariaLabel={t("settings.scheduledExports.filters.selectTeams", "Select teams to filter")}
								/>

								<FilterSelector
									label={t("settings.scheduledExports.filters.projects", "Projects")}
									items={projectItems}
									selectedIds={projectIds}
									onSelectionChange={(ids) => updateFilter("projectIds", ids)}
									allLabel={t("settings.scheduledExports.filters.allProjects", "All Projects")}
									selectedLabel={(count) => t("settings.scheduledExports.filters.selectedCount", "{count} selected", { count })}
									emptyMessage={t("settings.scheduledExports.filters.noProjects", "No projects found")}
									clearLabel={t("settings.scheduledExports.filters.clearSelection", "Clear Selection")}
									ariaLabel={t("settings.scheduledExports.filters.selectProjects", "Select projects to filter")}
								/>
							</>
						);
					}}
				</form.Field>
			</div>
		</div>
	);
}
