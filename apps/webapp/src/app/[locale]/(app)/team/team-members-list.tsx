"use client";

import {
	IconArrowDown,
	IconArrowRight,
	IconArrowsSort,
	IconArrowUp,
	IconLayoutGrid,
	IconLayoutList,
	IconSearch,
	IconUserCheck,
	IconUsers,
} from "@tabler/icons-react";
import {
	type ColumnDef,
	columnVisibilityFeature,
	createPaginatedRowModel,
	createSortedRowModel,
	flexRender,
	rowPaginationFeature,
	rowSortingFeature,
	type SortingState,
	sortFn_alphanumeric,
	sortFn_basic,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { EmployeeActivityText } from "@/components/employee-activity-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type EmployeeClockStatus, UserAvatar } from "@/components/user-avatar";
import { BalanceAdjustmentHistoryDialog } from "@/components/work-balance/balance-adjustment-history-button";
import { useEmployeeClockStatuses } from "@/lib/query";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import { Link } from "@/navigation";
import type { ManagedEmployee } from "./team-members-data";

type ManagedEmployeeWithPresence = ManagedEmployee & {
	clockStatus?: EmployeeClockStatus;
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
	/** A break in progress (#861). */
	breakStartedAt: string | null;
	breakStartedZone: string | null;
};

const teamTableFeatures = tableFeatures({
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSortingFeature,
	paginatedRowModel: createPaginatedRowModel(),
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		text: sortFn_text,
		basic: sortFn_basic,
	},
});

interface TeamMembersListProps {
	employees: ManagedEmployee[];
}

function getBalanceVariant(balanceMinutes: number | null | undefined) {
	if (balanceMinutes == null || balanceMinutes === 0) return "outline" as const;
	return balanceMinutes > 0 ? ("default" as const) : ("secondary" as const);
}

/**
 * The employee's work balance; it opens their balance adjustment history,
 * read-only (#996). Everyone on this list is the viewer or someone they
 * manage, and the server checks again when the history loads.
 */
function TimeBalanceBadge({
	employee,
	noBalanceLabel,
	workBalanceLabel,
	historyLabel,
}: {
	employee: ManagedEmployee;
	noBalanceLabel: string;
	workBalanceLabel: string;
	historyLabel: string;
}) {
	const balance = employee.timeBalance;
	const label = balance ? formatSignedWorkBalance(balance.balanceMinutes) : noBalanceLabel;
	const accessibleLabel = `${workBalanceLabel}: ${label}`;
	return (
		<BalanceAdjustmentHistoryDialog
			employeeId={employee.id}
			trigger={
				<Badge
					asChild
					variant={balance ? getBalanceVariant(balance.balanceMinutes) : "outline"}
					className={cn(
						"relative z-10 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
						balance && "text-xs font-normal",
					)}
				>
					<button type="button" aria-label={accessibleLabel} title={historyLabel}>
						{label}
					</button>
				</Badge>
			}
		/>
	);
}

function YouBadge({ show, label }: { show: boolean; label: string }) {
	if (!show) return null;
	return (
		<Badge variant="outline" className="text-xs font-normal">
			{label}
		</Badge>
	);
}

export function TeamMembersList({ employees }: TeamMembersListProps) {
	const { t } = useTranslate();
	const [searchQuery, setSearchQuery] = useState("");
	const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
	const youLabel = t("team.member.you", "You");
	const noBalanceLabel = t("team.balance.noBalance", "No balance");
	const workBalanceLabel = t("workBalance.label", "All-time balance");
	const historyLabel = t("workBalance.adjustments.open", "Balance adjustments");
	const primaryManagerLabel = t("team.primaryManager", "You are the primary manager");
	const presence = useEmployeeClockStatuses(
		employees.map((employee) => employee.id),
		{ polling: true },
	);
	const employeesWithPresence = employees.map((employee) => {
		const activity = presence.getActivity(employee.id);
		return {
			...employee,
			clockStatus: presence.getStatus(employee.id),
			lastActivityAt: activity?.lastActivityAt ?? null,
			lastActivityUtcOffsetMinutes: activity?.lastActivityUtcOffsetMinutes ?? null,
			breakStartedAt: presence.getBreak(employee.id)?.breakStartedAt ?? null,
			breakStartedZone: presence.getBreak(employee.id)?.breakStartedZone ?? null,
		};
	});

	const filteredEmployees = employeesWithPresence.filter((emp) => {
		const search = searchQuery.toLowerCase();
		const name = emp.user.name?.toLowerCase() || "";
		const email = emp.user.email?.toLowerCase() || "";
		const position = emp.position?.toLowerCase() || "";
		const team = emp.team?.name?.toLowerCase() || "";
		return (
			name.includes(search) ||
			email.includes(search) ||
			position.includes(search) ||
			team.includes(search)
		);
	});

	if (employees.length === 0) {
		return (
			<EmptyTeamMembers
				title={t("team.empty.title", "No team members yet")}
				description={t(
					"team.empty.description",
					"Employees assigned to you as their manager will appear here. You can manage team assignments in the employee settings.",
				)}
				actionLabel={t("team.empty.action", "Go to Employee Settings")}
			/>
		);
	}

	return (
		<div className="space-y-4">
			<TeamMembersToolbar
				searchQuery={searchQuery}
				onSearchQueryChange={setSearchQuery}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				searchPlaceholder={t(
					"team.search.placeholder",
					"Search by name, email, position, or team...",
				)}
				searchLabel={t("team.search.ariaLabel", "Search team members")}
				cardsLabel={t("team.view.cards", "Card view")}
				tableLabel={t("team.view.table", "Table view")}
			/>

			{filteredEmployees.length > 0 ? (
				viewMode === "cards" ? (
					<TeamMemberCards
						employees={filteredEmployees}
						youLabel={youLabel}
						noBalanceLabel={noBalanceLabel}
						workBalanceLabel={workBalanceLabel}
						historyLabel={historyLabel}
						primaryManagerLabel={primaryManagerLabel}
						inactiveLabel={t("team.status.inactive", "Inactive")}
					/>
				) : (
					<TeamMembersTable
						employees={filteredEmployees}
						youLabel={youLabel}
						noBalanceLabel={noBalanceLabel}
						workBalanceLabel={workBalanceLabel}
						historyLabel={historyLabel}
						primaryManagerLabel={primaryManagerLabel}
					/>
				)
			) : (
				<NoTeamMemberResults
					description={t("team.noResults.description", 'No team members match "{query}"', {
						query: searchQuery,
					})}
					title={t("team.noResults.title", "No results found")}
					clearLabel={t("team.noResults.action", "Clear search")}
					onClear={() => setSearchQuery("")}
				/>
			)}
		</div>
	);
}

function EmptyTeamMembers({
	title,
	description,
	actionLabel,
}: {
	title: string;
	description: string;
	actionLabel: string;
}) {
	return (
		<Card className="border-dashed">
			<CardContent className="flex flex-col items-center justify-center py-16 text-center">
				<div className="rounded-full bg-muted p-4">
					<IconUsers className="size-10 text-muted-foreground" />
				</div>
				<h3 className="mt-6 text-xl font-semibold">{title}</h3>
				<p className="mt-2 max-w-sm text-muted-foreground">{description}</p>
				<Button className="mt-6" variant="outline" asChild>
					<Link href="/settings/employees">{actionLabel}</Link>
				</Button>
			</CardContent>
		</Card>
	);
}

function TeamMembersToolbar({
	searchQuery,
	onSearchQueryChange,
	viewMode,
	onViewModeChange,
	searchPlaceholder,
	searchLabel,
	cardsLabel,
	tableLabel,
}: {
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	viewMode: "cards" | "table";
	onViewModeChange: (value: "cards" | "table") => void;
	searchPlaceholder: string;
	searchLabel: string;
	cardsLabel: string;
	tableLabel: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="relative max-w-md flex-1">
				<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					placeholder={searchPlaceholder}
					aria-label={searchLabel}
					value={searchQuery}
					onChange={(event) => onSearchQueryChange(event.target.value)}
					className="pl-10"
				/>
			</div>
			<ToggleGroup
				type="single"
				value={viewMode}
				onValueChange={(value) => value && onViewModeChange(value as "cards" | "table")}
				className="hidden sm:flex"
			>
				<ToggleGroupItem value="cards" aria-label={cardsLabel}>
					<IconLayoutGrid className="size-4" />
				</ToggleGroupItem>
				<ToggleGroupItem value="table" aria-label={tableLabel}>
					<IconLayoutList className="size-4" />
				</ToggleGroupItem>
			</ToggleGroup>
		</div>
	);
}

type TeamMemberPresentationProps = {
	employees: ManagedEmployeeWithPresence[];
	youLabel: string;
	noBalanceLabel: string;
	workBalanceLabel: string;
	historyLabel: string;
	primaryManagerLabel: string;
};

function TeamMemberCards({
	employees,
	youLabel,
	noBalanceLabel,
	workBalanceLabel,
	historyLabel,
	primaryManagerLabel,
	inactiveLabel,
}: TeamMemberPresentationProps & { inactiveLabel: string }) {
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{employees.map((employee) => (
				// The name is the link, stretched over the card, so the balance badge
				// can be its own control (#996).
				<Card
					key={employee.id}
					className="group relative h-full overflow-hidden py-0 transition-shadow focus-within:shadow-md hover:shadow-md"
				>
					<CardContent className="p-3">
						<div className="flex items-center gap-3">
							<UserAvatar
								image={employee.user.image}
								seed={employee.user.id}
								name={employee.user.name}
								clockStatus={employee.clockStatus ?? "unknown"}
								size="md"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<h3 className="truncate text-sm font-medium">
										<Link
											href={`/settings/employees/${employee.id}`}
											className="after:absolute after:inset-0 focus-visible:outline-none"
										>
											{employee.user.name}
										</Link>
									</h3>
									{employee.isPrimaryManager && (
										<IconUserCheck
											className="size-3.5 shrink-0 text-primary"
											title={primaryManagerLabel}
										/>
									)}
									<YouBadge show={employee.isCurrentUser} label={youLabel} />
								</div>
								<p className="truncate text-xs text-muted-foreground">{employee.user.email}</p>
								{employee.position && (
									<p className="truncate text-xs text-muted-foreground">{employee.position}</p>
								)}
								<EmployeeActivityText
									lastActivityAt={employee.lastActivityAt}
									lastActivityUtcOffsetMinutes={employee.lastActivityUtcOffsetMinutes}
									breakStartedAt={employee.breakStartedAt}
									breakStartedZone={employee.breakStartedZone}
								/>
							</div>
						</div>
						<div className="mt-2 flex items-center justify-between">
							<div className="flex flex-wrap gap-1">
								{employee.team && (
									<Badge variant="secondary" className="text-xs font-normal">
										{employee.team.name}
									</Badge>
								)}
								<TimeBalanceBadge
									employee={employee}
									noBalanceLabel={noBalanceLabel}
									workBalanceLabel={workBalanceLabel}
									historyLabel={historyLabel}
								/>
								{!employee.isActive && (
									<Badge variant="outline" className="text-xs font-normal">
										{inactiveLabel}
									</Badge>
								)}
								{employee.role !== "employee" && (
									<Badge
										variant={employee.role === "admin" ? "default" : "secondary"}
										className="text-xs font-normal"
									>
										{employee.role}
									</Badge>
								)}
							</div>
							<IconArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function TeamMembersTable({
	employees,
	youLabel,
	noBalanceLabel,
	workBalanceLabel,
	historyLabel,
	primaryManagerLabel,
}: TeamMemberPresentationProps) {
	const { t } = useTranslate();
	const [sorting, setSorting] = useState<SortingState>([]);
	const columns = useMemo<ColumnDef<typeof teamTableFeatures, ManagedEmployeeWithPresence>[]>(
		() => [
			{
				accessorKey: "user.name",
				header: t("team.table.employee", "Employee"),
				enableSorting: false,
				cell: ({ row }) => (
					<Link
						href={`/settings/employees/${row.original.id}`}
						className="flex items-center gap-3 hover:underline"
					>
						<UserAvatar
							image={row.original.user.image}
							seed={row.original.user.id}
							name={row.original.user.name}
							clockStatus={row.original.clockStatus ?? "unknown"}
							size="sm"
						/>
						<div>
							<div className="flex items-center gap-1.5 font-medium">
								{row.original.user.name}
								{row.original.isPrimaryManager && (
									<IconUserCheck className="size-4 text-primary" title={primaryManagerLabel} />
								)}
								<YouBadge show={row.original.isCurrentUser} label={youLabel} />
							</div>
							<div className="text-sm text-muted-foreground">{row.original.user.email}</div>
							<EmployeeActivityText
								lastActivityAt={row.original.lastActivityAt}
								lastActivityUtcOffsetMinutes={row.original.lastActivityUtcOffsetMinutes}
								breakStartedAt={row.original.breakStartedAt}
								breakStartedZone={row.original.breakStartedZone}
							/>
						</div>
					</Link>
				),
			},
			{
				accessorKey: "position",
				header: t("team.table.position", "Position"),
				enableSorting: false,
				cell: ({ row }) => row.original.position || "—",
			},
			{
				accessorKey: "team.name",
				header: t("team.table.team", "Team"),
				enableSorting: false,
				cell: ({ row }) =>
					row.original.team ? <Badge variant="secondary">{row.original.team.name}</Badge> : "—",
			},
			{
				id: "timeBalance",
				header: ({ column }) => {
					const sorted = column.getIsSorted();
					const directionLabel =
						sorted === "asc"
							? t("team.table.sort.ascending", "ascending")
							: sorted === "desc"
								? t("team.table.sort.descending", "descending")
								: null;
					const SortIcon =
						sorted === "asc" ? IconArrowUp : sorted === "desc" ? IconArrowDown : IconArrowsSort;
					return (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="-ml-2 h-8 gap-1 px-2 font-medium hover:bg-transparent"
							onClick={column.getToggleSortingHandler()}
							aria-label={
								directionLabel ? `${workBalanceLabel} (${directionLabel})` : workBalanceLabel
							}
						>
							<span>{workBalanceLabel}</span>
							<SortIcon className="size-4 text-muted-foreground" aria-hidden="true" />
						</Button>
					);
				},
				accessorFn: (row) => row.timeBalance?.balanceMinutes ?? 0,
				sortDescFirst: false,
				cell: ({ row }) => (
					<TimeBalanceBadge
						employee={row.original}
						noBalanceLabel={noBalanceLabel}
						workBalanceLabel={workBalanceLabel}
						historyLabel={historyLabel}
					/>
				),
			},
			{
				accessorKey: "role",
				header: t("team.table.role", "Role"),
				enableSorting: false,
				cell: ({ row }) => (
					<Badge
						variant={
							row.original.role === "admin"
								? "default"
								: row.original.role === "manager"
									? "secondary"
									: "outline"
						}
					>
						{row.original.role}
					</Badge>
				),
			},
			{
				accessorKey: "isActive",
				header: t("team.table.status", "Status"),
				enableSorting: false,
				cell: ({ row }) => (
					<Badge variant={row.original.isActive ? "default" : "secondary"}>
						{row.original.isActive
							? t("team.status.active", "Active")
							: t("team.status.inactive", "Inactive")}
					</Badge>
				),
			},
		],
		[t, primaryManagerLabel, youLabel, workBalanceLabel, noBalanceLabel, historyLabel],
	);
	const table = useTable({
		features: teamTableFeatures,
		data: employees,
		columns,
		onSortingChange: setSorting,
		state: { sorting },
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto rounded-md border">
				<Table className="min-w-[760px]">
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										aria-sort={
											header.column.getCanSort()
												? header.column.getIsSorted() === "asc"
													? "ascending"
													: header.column.getIsSorted() === "desc"
														? "descending"
														: "none"
												: undefined
										}
									>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.map((row) => (
							<TableRow key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{table.getPageCount() > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						{t("team.pagination.showing", "Showing {from} to {to} of {total}", {
							from: table.state.pagination.pageIndex * table.state.pagination.pageSize + 1,
							to: Math.min(
								(table.state.pagination.pageIndex + 1) * table.state.pagination.pageSize,
								employees.length,
							),
							total: employees.length,
						})}
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.previousPage()}
							disabled={!table.getCanPreviousPage()}
						>
							{t("team.pagination.previous", "Previous")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.nextPage()}
							disabled={!table.getCanNextPage()}
						>
							{t("team.pagination.next", "Next")}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function NoTeamMemberResults({
	title,
	description,
	clearLabel,
	onClear,
}: {
	title: string;
	description: string;
	clearLabel: string;
	onClear: () => void;
}) {
	return (
		<Card className="border-dashed">
			<CardContent className="flex flex-col items-center justify-center py-12 text-center">
				<IconSearch className="size-8 text-muted-foreground" />
				<h3 className="mt-4 font-semibold">{title}</h3>
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
				<Button variant="ghost" size="sm" className="mt-4" onClick={onClear}>
					{clearLabel}
				</Button>
			</CardContent>
		</Card>
	);
}
