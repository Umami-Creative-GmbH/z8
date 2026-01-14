"use client";

import {
	IconArrowRight,
	IconLayoutGrid,
	IconLayoutList,
	IconSearch,
	IconUserCheck,
	IconUsers,
} from "@tabler/icons-react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/navigation";
import type { ManagedEmployee } from "./actions";

interface TeamMembersListProps {
	employees: ManagedEmployee[];
}

export function TeamMembersList({ employees }: TeamMembersListProps) {
	const { t } = useTranslate();
	const [searchQuery, setSearchQuery] = useState("");
	const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
	const [sorting, setSorting] = useState<SortingState>([]);

	const filteredEmployees = employees.filter((emp) => {
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

	// Table columns
	const columns: ColumnDef<ManagedEmployee>[] = [
		{
			accessorKey: "user.name",
			header: t("team.table.employee", "Employee"),
			cell: ({ row }) => (
				<Link
					href={`/settings/employees/${row.original.id}`}
					className="flex items-center gap-3 hover:underline"
				>
					<UserAvatar
						image={row.original.user.image}
						seed={row.original.user.id}
						name={row.original.user.name}
						size="sm"
					/>
					<div>
						<div className="flex items-center gap-1.5 font-medium">
							{row.original.user.name}
							{row.original.isPrimaryManager && <IconUserCheck className="size-4 text-primary" />}
						</div>
						<div className="text-sm text-muted-foreground">{row.original.user.email}</div>
					</div>
				</Link>
			),
		},
		{
			accessorKey: "position",
			header: t("team.table.position", "Position"),
			cell: ({ row }) => row.original.position || "—",
		},
		{
			accessorKey: "team.name",
			header: t("team.table.team", "Team"),
			cell: ({ row }) =>
				row.original.team ? <Badge variant="secondary">{row.original.team.name}</Badge> : "—",
		},
		{
			accessorKey: "role",
			header: t("team.table.role", "Role"),
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
			cell: ({ row }) => (
				<Badge variant={row.original.isActive ? "default" : "secondary"}>
					{row.original.isActive
						? t("team.status.active", "Active")
						: t("team.status.inactive", "Inactive")}
				</Badge>
			),
		},
	];

	const table = useReactTable({
		data: filteredEmployees,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		state: { sorting },
		initialState: {
			pagination: { pageSize: 10 },
		},
	});

	if (employees.length === 0) {
		return (
			<Card className="border-dashed">
				<CardContent className="flex flex-col items-center justify-center py-16 text-center">
					<div className="rounded-full bg-muted p-4">
						<IconUsers className="size-10 text-muted-foreground" />
					</div>
					<h3 className="mt-6 text-xl font-semibold">
						{t("team.empty.title", "No team members yet")}
					</h3>
					<p className="mt-2 max-w-sm text-muted-foreground">
						{t(
							"team.empty.description",
							"Employees assigned to you as their manager will appear here. You can manage team assignments in the employee settings.",
						)}
					</p>
					<Button className="mt-6" variant="outline" asChild>
						<Link href="/settings/employees">
							{t("team.empty.action", "Go to Employee Settings")}
						</Link>
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{/* Search and View Toggle */}
			<div className="flex items-center justify-between gap-4">
				<div className="relative max-w-md flex-1">
					<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder={t(
							"team.search.placeholder",
							"Search by name, email, position, or team...",
						)}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-10"
					/>
				</div>
				<ToggleGroup
					type="single"
					value={viewMode}
					onValueChange={(value) => value && setViewMode(value as "cards" | "table")}
					className="hidden sm:flex"
				>
					<ToggleGroupItem value="cards" aria-label={t("team.view.cards", "Card view")}>
						<IconLayoutGrid className="size-4" />
					</ToggleGroupItem>
					<ToggleGroupItem value="table" aria-label={t("team.view.table", "Table view")}>
						<IconLayoutList className="size-4" />
					</ToggleGroupItem>
				</ToggleGroup>
			</div>

			{/* Content */}
			{filteredEmployees.length > 0 ? (
				viewMode === "cards" ? (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{filteredEmployees.map((emp) => (
							<Link key={emp.id} href={`/settings/employees/${emp.id}`}>
								<Card className="group relative h-full overflow-hidden py-0 transition-all hover:shadow-md">
									<CardContent className="p-3">
										<div className="flex items-center gap-3">
											<UserAvatar
												image={emp.user.image}
												seed={emp.user.id}
												name={emp.user.name}
												size="md"
											/>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-1.5">
													<h3 className="truncate text-sm font-medium">{emp.user.name}</h3>
													{emp.isPrimaryManager && (
														<IconUserCheck
															className="size-3.5 shrink-0 text-primary"
															title={t("team.primaryManager", "You are the primary manager")}
														/>
													)}
												</div>
												<p className="truncate text-xs text-muted-foreground">{emp.user.email}</p>
												{emp.position && (
													<p className="truncate text-xs text-muted-foreground">{emp.position}</p>
												)}
											</div>
										</div>
										<div className="mt-2 flex items-center justify-between">
											<div className="flex flex-wrap gap-1">
												{emp.team && (
													<Badge variant="secondary" className="text-xs font-normal">
														{emp.team.name}
													</Badge>
												)}
												{!emp.isActive && (
													<Badge variant="outline" className="text-xs font-normal">
														{t("team.status.inactive", "Inactive")}
													</Badge>
												)}
												{emp.role !== "employee" && (
													<Badge
														variant={emp.role === "admin" ? "default" : "secondary"}
														className="text-xs font-normal"
													>
														{emp.role}
													</Badge>
												)}
											</div>
											<IconArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
										</div>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				) : (
					<div className="space-y-4">
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									{table.getHeaderGroups().map((headerGroup) => (
										<TableRow key={headerGroup.id}>
											{headerGroup.headers.map((header) => (
												<TableHead key={header.id}>
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
										from:
											table.getState().pagination.pageIndex * table.getState().pagination.pageSize +
											1,
										to: Math.min(
											(table.getState().pagination.pageIndex + 1) *
												table.getState().pagination.pageSize,
											filteredEmployees.length,
										),
										total: filteredEmployees.length,
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
				)
			) : (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center justify-center py-12 text-center">
						<IconSearch className="size-8 text-muted-foreground" />
						<h3 className="mt-4 font-semibold">{t("team.noResults.title", "No results found")}</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							{t("team.noResults.description", 'No team members match "{query}"', {
								query: searchQuery,
							})}
						</p>
						<Button variant="ghost" size="sm" className="mt-4" onClick={() => setSearchQuery("")}>
							{t("team.noResults.action", "Clear search")}
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
