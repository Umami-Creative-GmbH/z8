"use client";

import {
	IconArrowDown,
	IconArrowsSort,
	IconArrowUp,
	IconCalendarPlus,
	IconSearch,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { UserAvatar } from "@/components/user-avatar";
import { useRouter } from "@/navigation";
import type {
	ManagerAbsenceEmployeeRow,
	ManagerAbsenceListResult,
	ManagerAbsenceSortKey,
} from "./manager-absence-types";
import { RecordAbsenceDialog } from "./record-absence-dialog";

type AbsenceCategoryOption = {
	id: string;
	name: string;
	type: string;
	color: string | null;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
};

type TeamAbsencesTableProps = {
	data: ManagerAbsenceListResult;
	categories: AbsenceCategoryOption[];
	search: string;
};

function TeamAbsencesTableContent({ data, categories, search }: TeamAbsencesTableProps) {
	const { push } = useRouter();
	const searchParams = useSearchParams();
	const [selectedEmployee, setSelectedEmployee] = useState<ManagerAbsenceEmployeeRow | null>(null);
	const [isPending, startTransition] = useTransition();
	const hasRows = data.rows.length > 0;
	const firstItem = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
	const lastItem = Math.min(data.page * data.pageSize, data.total);
	const canGoPrevious = data.page > 1;
	const canGoNext = data.page < data.pageCount;
	const visiblePageCount = Math.max(data.pageCount, 1);
	const visiblePage = Math.min(data.page, visiblePageCount);
	const years = [data.year - 1, data.year, data.year + 1];

	function pushParams(updates: Record<string, string | number | null>) {
		const params = new URLSearchParams(searchParams.toString());
		const updatesTeamId = Object.hasOwn(updates, "teamId");

		if (data.teamId === null && !updatesTeamId) {
			params.delete("teamId");
		}

		Object.entries(updates).forEach(([key, value]) => {
			if (value === null || value === "") {
				params.delete(key);
				return;
			}

			params.set(key, String(value));
		});

		const query = params.toString();
		startTransition(() => {
			push(query ? `/team/absences?${query}` : "/team/absences");
		});
	}

	function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const nextSearch = String(formData.get("search") ?? "").trim();

		pushParams({ search: nextSearch || null, page: 1 });
	}

	function handleSort(sort: ManagerAbsenceSortKey) {
		const nextDirection = data.sort === sort && data.direction === "asc" ? "desc" : "asc";

		pushParams({ sort, direction: nextDirection, page: 1 });
	}

	return (
		<div className="space-y-4">
			<TeamAbsencesFilters
				data={data}
				search={search}
				years={years}
				isPending={isPending}
				onSearchSubmit={handleSearchSubmit}
				onTeamChange={(teamId) =>
					pushParams({ teamId: teamId === "all" ? null : teamId, page: 1 })
				}
				onYearChange={(year) => pushParams({ year, page: 1 })}
			/>

			{hasRows ? (
				<TeamAbsencesRowsTable
					rows={data.rows}
					sort={data.sort}
					direction={data.direction}
					isPending={isPending}
					onSort={handleSort}
					onRecordAbsence={setSelectedEmployee}
				/>
			) : (
				<TeamAbsencesEmptyState />
			)}

			<TeamAbsencesPagination
				firstItem={firstItem}
				lastItem={lastItem}
				total={data.total}
				visiblePage={visiblePage}
				visiblePageCount={visiblePageCount}
				canGoPrevious={canGoPrevious}
				canGoNext={canGoNext}
				isPending={isPending}
				onPrevious={() => pushParams({ page: data.page - 1 })}
				onNext={() => pushParams({ page: data.page + 1 })}
			/>

			<RecordAbsenceDialog
				open={selectedEmployee !== null}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedEmployee(null);
					}
				}}
				employee={
					selectedEmployee ? { id: selectedEmployee.id, name: selectedEmployee.name } : null
				}
				categories={categories}
			/>
		</div>
	);
}

function TeamAbsencesFilters({
	data,
	search,
	years,
	isPending,
	onSearchSubmit,
	onTeamChange,
	onYearChange,
}: {
	data: ManagerAbsenceListResult;
	search: string;
	years: number[];
	isPending: boolean;
	onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
	onTeamChange: (teamId: string) => void;
	onYearChange: (year: string) => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
			<form className="flex w-full gap-2 sm:max-w-md" onSubmit={onSearchSubmit}>
				<div className="relative flex-1">
					<IconSearch
						className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						type="search"
						name="search"
						defaultValue={search}
						placeholder={t("team.absences.filters.searchPlaceholder", "Search employees…")}
						aria-label={t("team.absences.filters.searchLabel", "Search employees")}
						autoComplete="off"
						className="pl-9"
						disabled={isPending}
					/>
				</div>
				<Button type="submit" variant="outline" disabled={isPending}>
					{t("team.absences.filters.searchSubmit", "Search")}
				</Button>
			</form>

			<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
				<Select value={data.teamId ?? "all"} onValueChange={onTeamChange} disabled={isPending}>
					<SelectTrigger
						className="w-full sm:w-44"
						aria-label={t("team.absences.filters.teamLabel", "Filter by team")}
					>
						<SelectValue placeholder={t("team.absences.filters.teamPlaceholder", "Team")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">{t("team.absences.filters.allTeams", "All teams")}</SelectItem>
						{data.teams.map((team) => (
							<SelectItem key={team.id} value={team.id}>
								{team.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={String(data.year)} onValueChange={onYearChange} disabled={isPending}>
					<SelectTrigger
						className="w-full sm:w-36"
						aria-label={t("team.absences.filters.yearLabel", "Filter by year")}
					>
						<SelectValue placeholder={t("team.absences.filters.yearPlaceholder", "Year")} />
					</SelectTrigger>
					<SelectContent>
						{years.map((year) => (
							<SelectItem key={year} value={String(year)}>
								{year}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

function SortableAbsenceTableHead({
	label,
	sort,
	activeSort,
	direction,
	className,
	disabled,
	onSort,
}: {
	label: string;
	sort: ManagerAbsenceSortKey;
	activeSort: ManagerAbsenceSortKey;
	direction: "asc" | "desc";
	className?: string;
	disabled: boolean;
	onSort: (sort: ManagerAbsenceSortKey) => void;
}) {
	const { t } = useTranslate();
	const isActive = activeSort === sort;
	const ariaSort = direction === "asc" ? "ascending" : "descending";
	const directionLabel =
		direction === "asc"
			? t("team.absences.sort.ascending", "ascending")
			: t("team.absences.sort.descending", "descending");
	const sortLabel = isActive
		? t("team.absences.sort.byWithDirection", "Sort by {label} ({direction})", {
				label,
				direction: directionLabel,
			})
		: t("team.absences.sort.by", "Sort by {label}", { label });
	const SortIcon = !isActive ? IconArrowsSort : direction === "asc" ? IconArrowUp : IconArrowDown;

	return (
		<TableHead className={className} aria-sort={isActive ? ariaSort : undefined}>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-auto gap-1 px-0 font-medium hover:bg-transparent"
				aria-label={sortLabel}
				onClick={() => onSort(sort)}
				disabled={disabled}
			>
				<span>{label}</span>
				<SortIcon className="size-4 text-muted-foreground" aria-hidden="true" />
			</Button>
		</TableHead>
	);
}

function TeamAbsencesRowsTable({
	rows,
	sort,
	direction,
	isPending,
	onSort,
	onRecordAbsence,
}: {
	rows: ManagerAbsenceEmployeeRow[];
	sort: ManagerAbsenceSortKey;
	direction: "asc" | "desc";
	isPending: boolean;
	onSort: (sort: ManagerAbsenceSortKey) => void;
	onRecordAbsence: (employee: ManagerAbsenceEmployeeRow) => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="rounded-lg border bg-card">
			<div className="overflow-x-auto">
				<Table className="min-w-[760px]">
					<TableHeader>
						<TableRow>
							<SortableAbsenceTableHead
								label={t("team.absences.table.employee", "Employee")}
								sort="employee"
								activeSort={sort}
								direction={direction}
								disabled={isPending}
								onSort={onSort}
							/>
							<SortableAbsenceTableHead
								label={t("team.absences.table.teamOrPosition", "Team or Position")}
								sort="team"
								activeSort={sort}
								direction={direction}
								disabled={isPending}
								onSort={onSort}
							/>
							<SortableAbsenceTableHead
								label={t("team.absences.table.allowance", "Allowance")}
								sort="vacationAllowance"
								activeSort={sort}
								direction={direction}
								className="text-right"
								disabled={isPending}
								onSort={onSort}
							/>
							<SortableAbsenceTableHead
								label={t("team.absences.table.used", "Used")}
								sort="usedVacationDays"
								activeSort={sort}
								direction={direction}
								className="text-right"
								disabled={isPending}
								onSort={onSort}
							/>
							<SortableAbsenceTableHead
								label={t("team.absences.table.pending", "Pending")}
								sort="pendingVacationDays"
								activeSort={sort}
								direction={direction}
								className="text-right"
								disabled={isPending}
								onSort={onSort}
							/>
							<SortableAbsenceTableHead
								label={t("team.absences.table.left", "Left")}
								sort="remainingVacationDays"
								activeSort={sort}
								direction={direction}
								className="text-right"
								disabled={isPending}
								onSort={onSort}
							/>
							<SortableAbsenceTableHead
								label={t("team.absences.table.sick", "Sick")}
								sort="sickDays"
								activeSort={sort}
								direction={direction}
								className="text-right"
								disabled={isPending}
								onSort={onSort}
							/>
							<TableHead className="text-right">
								{t("team.absences.table.actions", "Actions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((employee) => (
							<TableRow key={employee.id}>
								<TableCell>
									<div className="flex min-w-0 items-center gap-3">
										<UserAvatar
											image={employee.image}
											seed={employee.userId}
											name={employee.name}
											size="sm"
										/>
										<div className="min-w-0">
											<p className="truncate font-medium">{employee.name}</p>
											<p className="truncate text-muted-foreground text-sm">{employee.email}</p>
										</div>
									</div>
								</TableCell>
								<TableCell className="text-muted-foreground text-sm">
									{employee.teamName ?? employee.position ?? "-"}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{employee.vacationAllowance}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{employee.usedVacationDays}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{employee.pendingVacationDays}
								</TableCell>
								<TableCell className="text-right font-medium tabular-nums">
									{employee.remainingVacationDays}
								</TableCell>
								<TableCell className="text-right tabular-nums">{employee.sickDays}</TableCell>
								<TableCell className="text-right">
									<Button
										type="button"
										variant="outline"
										size="icon"
										aria-label={t(
											"team.absences.actions.recordForEmployee",
											"Record absence for {name}",
											{ name: employee.name },
										)}
										onClick={() => onRecordAbsence(employee)}
									>
										<IconCalendarPlus className="size-4" aria-hidden="true" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function TeamAbsencesEmptyState() {
	const { t } = useTranslate();

	return (
		<output
			aria-label={t("team.absences.empty.label", "No employees found")}
			className="rounded-lg border bg-card p-6 text-center"
		>
			<p className="font-medium">{t("team.absences.empty.title", "No employees found")}</p>
			<p className="mt-1 text-muted-foreground text-sm">
				{t(
					"team.absences.empty.description",
					"Try adjusting filters or search to find team members.",
				)}
			</p>
		</output>
	);
}

function TeamAbsencesPagination({
	firstItem,
	lastItem,
	total,
	visiblePage,
	visiblePageCount,
	canGoPrevious,
	canGoNext,
	isPending,
	onPrevious,
	onNext,
}: {
	firstItem: number;
	lastItem: number;
	total: number;
	visiblePage: number;
	visiblePageCount: number;
	canGoPrevious: boolean;
	canGoNext: boolean;
	isPending: boolean;
	onPrevious: () => void;
	onNext: () => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<p className="text-muted-foreground text-sm">
				{t("team.absences.pagination.showing", "Showing {firstItem} to {lastItem} of {total}", {
					firstItem,
					lastItem,
					total,
				})}
			</p>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onPrevious}
					disabled={!canGoPrevious || isPending}
					aria-label={t("team.absences.pagination.previousLabel", "Previous page")}
				>
					{t("team.absences.pagination.previous", "Previous")}
				</Button>
				<span className="text-muted-foreground text-sm tabular-nums">
					{t("team.absences.pagination.page", "Page {page} of {pageCount}", {
						page: visiblePage,
						pageCount: visiblePageCount,
					})}
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onNext}
					disabled={!canGoNext || isPending}
					aria-label={t("team.absences.pagination.nextLabel", "Next page")}
				>
					{t("team.absences.pagination.next", "Next")}
				</Button>
			</div>
		</div>
	);
}

export function TeamAbsencesTable(props: TeamAbsencesTableProps) {
	return (
		<Suspense fallback={null}>
			<TeamAbsencesTableContent {...props} />
		</Suspense>
	);
}
