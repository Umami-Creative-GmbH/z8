"use client";
import { IconFilterOff, IconPackage, IconSearch } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { ShowFormerEmployeesSwitch } from "@/components/former-employees/former-employee-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
	EquipmentAssignmentView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import {
	type AssignmentRowAction,
	EquipmentAssignmentsTable,
} from "./equipment-assignments-table";
import {
	type AssignmentFilters,
	type AssignmentSort,
	type AssignmentStatusView,
	DEFAULT_ASSIGNMENT_FILTERS,
	DEFAULT_ASSIGNMENT_SORT,
	filterAssignments,
	hasActiveFilters,
	sortAssignments,
	statusCounts,
} from "./equipment-list";
import { canTransfer } from "./equipment-panels";

const TOGGLE_VIEWS: readonly AssignmentStatusView[] = [
	"outstanding",
	"overdue",
	"all",
];
const ALL_TYPES = "all";

type FilterProps = {
	data: EquipmentView;
	filters: AssignmentFilters;
	onFiltersChange: (filters: AssignmentFilters) => void;
};

/** The status views with their counts under the other filters. */
function StatusToggle({ data, filters, onFiltersChange }: FilterProps) {
	const { t } = useTranslate();
	const counts = statusCounts(data.assignments, filters, data.today);
	const statusLabel: Record<AssignmentStatusView, string> = {
		outstanding: t("settings.equipment.list.statusOutstanding", "Outstanding"),
		overdue: t("settings.equipment.custody.overdue", "Overdue"),
		soon: t("settings.equipment.kpi.dueSoon", "Due within 14 days"),
		all: t("settings.equipment.filters.all", "All"),
	};
	return (
		<ToggleGroup
			type="single"
			variant="outline"
			value={filters.status}
			onValueChange={(value: string) => {
				const status = TOGGLE_VIEWS.find((entry) => entry === value);
				if (status) onFiltersChange({ ...filters, status });
			}}
			aria-label={t("settings.equipment.list.statusFilter", "Show assignments")}
		>
			{TOGGLE_VIEWS.map((status) => (
				<ToggleGroupItem
					key={status}
					value={status}
					className="gap-1.5 whitespace-nowrap px-3"
				>
					{statusLabel[status]}
					{status !== "all" ? (
						<span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
							{counts[status]}
						</span>
					) : null}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

/** Search, holder, type and former-employee filters, and "Clear filters". */
function FilterBar({
	data,
	filters,
	onFiltersChange,
	showHolder,
	filtered,
	onClear,
}: FilterProps & {
	showHolder: boolean;
	filtered: boolean;
	onClear: () => void;
}) {
	const { t } = useTranslate();
	const searchId = useId();
	const typeId = useId();
	const holderOptions = data.employees.map((employee) => ({
		code: employee.id,
		name: employee.former
			? `${employee.name} · ${t("common:formerEmployees.former", "Former")}`
			: employee.name,
	}));
	const allHolders = t("settings.equipment.list.allHolders", "All holders");
	const typeItems = [
		{
			value: ALL_TYPES,
			label: t("settings.equipment.list.allTypes", "All types"),
		},
		...data.types.map((type) => ({ value: type.id, label: type.name })),
	];
	return (
		<CardContent className="flex flex-wrap items-center gap-3 pb-4">
			<div className="relative w-full min-w-48 sm:max-w-xs sm:flex-1">
				<IconSearch
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<label htmlFor={searchId} className="sr-only">
					{t("settings.equipment.list.search", "Search assignments")}
				</label>
				<Input
					id={searchId}
					type="search"
					name="equipment-search"
					autoComplete="off"
					maxLength={100}
					className="pl-8"
					placeholder={t(
						"settings.equipment.list.searchPlaceholder",
						"Search identifier, type or holder",
					)}
					value={filters.search}
					onChange={(event) =>
						onFiltersChange({ ...filters, search: event.target.value })
					}
				/>
			</div>
			{showHolder ? (
				<SearchableSelect
					className="w-full sm:w-48"
					aria-label={t("settings.equipment.filters.holder", "Holder")}
					options={holderOptions}
					value={filters.holderId ?? ""}
					onValueChange={(value) =>
						onFiltersChange({ ...filters, holderId: value || null })
					}
					placeholder={allHolders}
					searchPlaceholder={t(
						"settings.equipment.list.searchHolders",
						"Search holders…",
					)}
					emptyText={t("settings.equipment.list.noHolder", "No holder found.")}
					allowEmpty
					emptyLabel={allHolders}
				/>
			) : null}
			{data.types.length ? (
				<div className="w-full sm:w-44">
					<span id={typeId} className="sr-only">
						{t("settings.equipment.filters.type", "Type")}
					</span>
					<Select
						value={filters.typeId ?? ALL_TYPES}
						items={typeItems}
						onValueChange={(value) =>
							onFiltersChange({
								...filters,
								typeId: !value || value === ALL_TYPES ? null : value,
							})
						}
					>
						<SelectTrigger aria-labelledby={typeId} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{typeItems.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}
			{showHolder ? (
				<ShowFormerEmployeesSwitch
					checked={filters.former !== "hide"}
					onCheckedChange={(checked) =>
						onFiltersChange({
							...filters,
							former: checked ? "show" : "hide",
						})
					}
				/>
			) : null}
			{filtered ? (
				<Button variant="ghost" size="sm" onClick={onClear}>
					<IconFilterOff className="size-4" aria-hidden="true" />
					{t("settings.equipment.filters.clear", "Clear filters")}
				</Button>
			) : null}
		</CardContent>
	);
}

/**
 * Assignments with the status toggle, search and filters, and the table (#1572).
 * Filters apply immediately; the overview keeps them in its URL.
 */
export function EquipmentAssignmentsCard({
	data,
	filters,
	onFiltersChange,
	showHolder,
	defaultStatus = DEFAULT_ASSIGNMENT_FILTERS.status,
	back,
	onAction,
	emptyAction,
}: {
	data: EquipmentView;
	filters: AssignmentFilters;
	onFiltersChange: (filters: AssignmentFilters) => void;
	/** The overview lists every holder; an employee's page lists theirs only. */
	showHolder: boolean;
	/** The view "Clear filters" returns to. */
	defaultStatus?: AssignmentStatusView;
	back?: string;
	onAction: (action: AssignmentRowAction, assignmentId: string) => void;
	/** The call to action when nothing has been issued yet. */
	emptyAction?: ReactNode;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [sort, setSort] = useState<AssignmentSort>(DEFAULT_ASSIGNMENT_SORT);
	const visible = sortAssignments(
		filterAssignments(data.assignments, filters, data.today),
		sort,
		locale,
	);
	const filtered = hasActiveFilters(filters, defaultStatus);
	const clear = () =>
		onFiltersChange({ ...DEFAULT_ASSIGNMENT_FILTERS, status: defaultStatus });
	const holderHref = (assignment: EquipmentAssignmentView) =>
		data.canManage
			? `/equipment/employees/${assignment.employeeId}`
			: undefined;
	return (
		<Card className="gap-0 overflow-hidden py-0">
			<CardHeader className="flex flex-wrap items-start justify-between gap-3 py-5">
				<div className="min-w-0 space-y-1">
					<h2 className="font-semibold leading-none">
						{t("settings.equipment.list.title", "Assignments")}
					</h2>
					<p className="text-sm text-muted-foreground tabular-nums">
						{t(
							"settings.equipment.list.count",
							"{shown} of {total, plural, one {# assignment} other {# assignments}}",
							{ shown: visible.length, total: data.assignments.length },
						)}
					</p>
				</div>
				<StatusToggle
					data={data}
					filters={filters}
					onFiltersChange={onFiltersChange}
				/>
			</CardHeader>
			{data.assignments.length ? (
				<FilterBar
					data={data}
					filters={filters}
					onFiltersChange={onFiltersChange}
					showHolder={showHolder}
					filtered={filtered}
					onClear={clear}
				/>
			) : null}
			{!data.assignments.length ? (
				<Empty className="rounded-none border-t md:p-10">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconPackage aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							{t("settings.equipment.list.emptyTitle", "Nothing issued yet")}
						</EmptyTitle>
						<EmptyDescription>
							{t(
								"settings.equipment.list.emptyDescription",
								"Issued equipment and recorded holdings appear here with their return deadlines.",
							)}
						</EmptyDescription>
					</EmptyHeader>
					{emptyAction ? <EmptyContent>{emptyAction}</EmptyContent> : null}
				</Empty>
			) : !visible.length ? (
				<div className="flex flex-col items-center gap-3 border-t px-6 py-10 text-center">
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							"settings.equipment.custody.empty",
							"No equipment assignments match this view.",
						)}
					</p>
					{filtered ? (
						<Button variant="outline" size="sm" onClick={clear}>
							<IconFilterOff className="size-4" aria-hidden="true" />
							{t("settings.equipment.filters.clear", "Clear filters")}
						</Button>
					) : null}
				</div>
			) : (
				<div className="border-t [&_td:first-child]:pl-6 [&_td:last-child]:pr-4 [&_th:first-child]:pl-6 [&_th:last-child]:pr-4">
					<EquipmentAssignmentsTable
						assignments={visible}
						today={data.today}
						sort={sort}
						onSort={setSort}
						showHolder={showHolder}
						holderHref={holderHref}
						back={back}
						canTransfer={(assignment) => canTransfer(data, assignment)}
						onAction={onAction}
					/>
				</div>
			)}
		</Card>
	);
}
