"use client";

import { IconArrowDown, IconArrowUp, IconArrowsSort, IconHourglassHigh } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { CategoryBadge } from "@/components/absences/category-badge";
import { EmployeeSingleSelect, toSelectableEmployee } from "@/components/employee-select";
import { Badge } from "@/components/ui/badge";
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
import type { PayrollDayPeriod } from "@/lib/payroll-workspace/types";
import type { PayrollPeriodAbsence } from "@/lib/payroll-period/types";
import { cn } from "@/lib/utils";
import { PENDING_HATCH } from "./payroll-absence-style";
import type { PayrollTranslate } from "./state";

import type { PayrollAbsenceListFormat } from "./payroll-absence-list-format";

const ALL = "all";

type SortKey = "employee" | "category" | "from" | "days";
type SortDirection = "asc" | "desc";

/**
 * One row per absence in the period: employee, category, from–to with half days, and
 * the days it counts inside the period. Sortable, and filterable by employee and category.
 */
export function PayrollAbsenceList({
	absences,
	employeeNames,
	format,
	t,
}: {
	absences: readonly PayrollPeriodAbsence[];
	employeeNames: ReadonlyMap<string, string>;
	format: PayrollAbsenceListFormat;
	t: PayrollTranslate;
}) {
	const [employeeFilter, setEmployeeFilter] = useState<string>(ALL);
	const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
	const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
		key: "employee",
		direction: "asc",
	});

	const nameOf = (employeeId: string) => employeeNames.get(employeeId) ?? employeeId;
	const employeeOptions = useMemo(
		() =>
			[...new Set(absences.map((absence) => absence.employeeId))]
				.map((id) => ({ id, name: employeeNames.get(id) ?? id }))
				.toSorted((left, right) => left.name.localeCompare(right.name))
				.map((option) => toSelectableEmployee(option)),
		[absences, employeeNames],
	);
	const categoryOptions = useMemo(
		() =>
			[...new Map(absences.map((absence) => [absence.categoryId, absence.categoryName] as const))]
				.map(([id, name]) => ({ id, name }))
				.toSorted((left, right) => left.name.localeCompare(right.name)),
		[absences],
	);

	const rows = absences
		.filter(
			(absence) =>
				(employeeFilter === ALL || absence.employeeId === employeeFilter) &&
				(categoryFilter === ALL || absence.categoryId === categoryFilter),
		)
		.toSorted((left, right) => {
			const order = compareBy(sort.key, left, right, nameOf);
			const tieBreak =
				nameOf(left.employeeId).localeCompare(nameOf(right.employeeId)) ||
				left.startDate.localeCompare(right.startDate) ||
				left.id.localeCompare(right.id);
			return (sort.direction === "asc" ? order : -order) || tieBreak;
		});

	const toggleSort = (key: SortKey) =>
		setSort((current) =>
			current.key === key
				? { key, direction: current.direction === "asc" ? "desc" : "asc" }
				: { key, direction: "asc" },
		);

	const sortableHead = (key: SortKey, label: string, className?: string) => (
		<TableHead
			className={className}
			aria-sort={
				sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
			}
		>
			<button
				type="button"
				className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				onClick={() => toggleSort(key)}
			>
				{label}
				{sort.key !== key ? (
					<IconArrowsSort aria-hidden="true" className="size-3.5 text-muted-foreground" />
				) : sort.direction === "asc" ? (
					<IconArrowUp aria-hidden="true" className="size-3.5" />
				) : (
					<IconArrowDown aria-hidden="true" className="size-3.5" />
				)}
			</button>
		</TableHead>
	);

	return (
		<div className="flex min-w-0 flex-col gap-3">
			<div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
				<div className="flex min-w-0 flex-col gap-1.5">
					<Label htmlFor="payroll-absence-employee-filter">
						{t("payroll.absences.filter.employee", "Employee")}
					</Label>
					<EmployeeSingleSelect
						id="payroll-absence-employee-filter"
						className="space-y-0"
						value={employeeFilter === ALL ? null : employeeFilter}
						onChange={(value) => setEmployeeFilter(value ?? ALL)}
						employees={employeeOptions}
						allowClear
						clearLabel={t("payroll.absences.filter.allEmployees", "All employees")}
						placeholder={t("payroll.absences.filter.allEmployees", "All employees")}
					/>
				</div>
				<div className="flex min-w-0 flex-col gap-1.5">
					<Label htmlFor="payroll-absence-category-filter">
						{t("payroll.absences.filter.category", "Category")}
					</Label>
					<Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value ?? ALL)}>
						<SelectTrigger id="payroll-absence-category-filter" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>
								{t("payroll.absences.filter.allCategories", "All categories")}
							</SelectItem>
							{categoryOptions.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									{option.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<Table mobileLayout="stacked">
				<TableHeader>
					<TableRow>
						{sortableHead("employee", t("payroll.absences.column.employee", "Employee"))}
						{sortableHead("category", t("payroll.absences.column.category", "Category"))}
						{sortableHead("from", t("payroll.absences.column.dates", "From – to"))}
						{sortableHead("days", t("payroll.absences.column.days", "Days counted"), "text-right")}
						<TableHead>{t("payroll.absences.column.status", "Status")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
								{t("payroll.absences.noMatches", "No absences match the selected filters.")}
							</TableCell>
						</TableRow>
					) : (
						rows.map((absence) => {
							const pending = absence.approvalState === "pending";
							return (
								<TableRow
									key={absence.id}
									className={cn(pending && "bg-amber-50/60 dark:bg-amber-950/20")}
								>
									<TableCell className="font-medium">{nameOf(absence.employeeId)}</TableCell>
									<TableCell>
										<CategoryBadge
											name={absence.categoryName}
											type={absence.categoryType ?? "custom"}
											color={absence.categoryColor}
										/>
									</TableCell>
									<TableCell className="whitespace-normal tabular-nums">
										{absenceRangeLabel(absence, format, t)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{format.days(absence.daysInPeriod)}
									</TableCell>
									<TableCell>
										{pending ? (
											<Badge
												variant="outline"
												className="gap-1 border-amber-500 text-amber-800 dark:text-amber-300"
												style={{ backgroundImage: PENDING_HATCH }}
											>
												<IconHourglassHigh aria-hidden="true" className="size-3.5" />
												{t("payroll.absences.pending", "Pending")}
											</Badge>
										) : (
											<span className="text-muted-foreground">
												{t("payroll.absences.approved", "Approved")}
											</span>
										)}
									</TableCell>
								</TableRow>
							);
						})
					)}
				</TableBody>
			</Table>
		</div>
	);
}

function compareBy(
	key: SortKey,
	left: PayrollPeriodAbsence,
	right: PayrollPeriodAbsence,
	nameOf: (employeeId: string) => string,
): number {
	switch (key) {
		case "employee":
			return nameOf(left.employeeId).localeCompare(nameOf(right.employeeId));
		case "category":
			return left.categoryName.localeCompare(right.categoryName);
		case "from":
			return left.startDate.localeCompare(right.startDate);
		case "days":
			return left.daysInPeriod - right.daysInPeriod;
	}
}

function absenceRangeLabel(
	absence: PayrollPeriodAbsence,
	format: PayrollAbsenceListFormat,
	t: PayrollTranslate,
): string {
	const from = withHalf(format.date(absence.startDate), absence.startPeriod, t);
	if (absence.startTime && absence.endTime) {
		const times = `${absence.startTime.slice(0, 5)}–${absence.endTime.slice(0, 5)}`;
		return absence.startDate === absence.endDate
			? `${format.date(absence.startDate)}, ${times}`
			: `${format.date(absence.startDate)} – ${format.date(absence.endDate)}, ${times}`;
	}
	if (absence.startDate === absence.endDate) {
		// One day: a single half is that half; anything else covers the whole day.
		return absence.startPeriod === absence.endPeriod ? from : format.date(absence.startDate);
	}
	return `${from} – ${withHalf(format.date(absence.endDate), absence.endPeriod, t)}`;
}

function withHalf(date: string, period: PayrollDayPeriod, t: PayrollTranslate): string {
	if (period === "am") return `${date} (${t("payroll.days.cell.am", "AM")})`;
	if (period === "pm") return `${date} (${t("payroll.days.cell.pm", "PM")})`;
	return date;
}
