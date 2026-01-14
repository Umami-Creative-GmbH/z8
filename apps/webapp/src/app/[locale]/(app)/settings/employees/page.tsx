"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconPlus,
	IconRefresh,
	IconSearch,
	IconUser,
} from "@tabler/icons-react";
import {
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useEmployees } from "@/lib/query/use-employees";
import { Link } from "@/navigation";
import { columns } from "./columns";

export default function EmployeesPage() {
	const {
		employees,
		total,
		isLoading,
		isFetching,
		hasEmployee,
		isAdmin,
		role,
		status,
		setSearch,
		setRole,
		setStatus,
		pagination,
		setPagination,
		pageCount,
		refresh,
	} = useEmployees();

	// Local sorting state (client-side sorting on current page)
	const [sorting, setSorting] = useState<SortingState>([]);

	// Debounced search input
	const [searchInput, setSearchInput] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(searchInput);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput, setSearch]);

	const table = useReactTable({
		data: employees,
		columns,
		state: { sorting, pagination },
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		manualPagination: true,
		pageCount,
		manualFiltering: true,
	});

	if (!hasEmployee && !isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employees" />
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
					<p className="text-sm text-muted-foreground">
						Manage employee profiles, teams, and permissions
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching}>
						<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">Refresh</span>
					</Button>
					{isAdmin && (
						<Button asChild>
							<Link href="/settings/employees/new">
								<IconPlus className="mr-2 size-4" />
								Add Employee
							</Link>
						</Button>
					)}
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Employee Directory</CardTitle>
					<CardDescription>
						{total} employee{total !== 1 ? "s" : ""} found
					</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="mb-4 flex flex-col gap-4 sm:flex-row">
						<div className="relative flex-1">
							<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search by name, email, or position..."
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								className="pl-9"
							/>
						</div>
						<Select value={role} onValueChange={setRole}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder="Filter by role" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Roles</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
								<SelectItem value="manager">Manager</SelectItem>
								<SelectItem value="employee">Employee</SelectItem>
							</SelectContent>
						</Select>
						<Select value={status} onValueChange={setStatus}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder="Filter by status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Status</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="inactive">Inactive</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Table */}
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<p className="text-sm text-muted-foreground">Loading employees...</p>
						</div>
					) : (
						<>
							<div className="overflow-x-auto rounded-md border">
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
										{table.getRowModel().rows.length ? (
											table.getRowModel().rows.map((row) => (
												<TableRow key={row.id}>
													{row.getVisibleCells().map((cell) => (
														<TableCell key={cell.id}>
															{flexRender(cell.column.columnDef.cell, cell.getContext())}
														</TableCell>
													))}
												</TableRow>
											))
										) : (
											<TableRow>
												<TableCell colSpan={columns.length} className="h-24 text-center">
													<div className="flex flex-col items-center justify-center">
														<IconUser className="mb-2 size-8 text-muted-foreground" />
														<p className="text-sm text-muted-foreground">No employees found</p>
													</div>
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
							</div>

							{/* Pagination Controls */}
							{pageCount > 1 && (
								<div className="flex items-center justify-between mt-4">
									<div className="text-sm text-muted-foreground">
										Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => table.previousPage()}
											disabled={!table.getCanPreviousPage() || isFetching}
										>
											<IconChevronLeft className="size-4 mr-1" />
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => table.nextPage()}
											disabled={!table.getCanNextPage() || isFetching}
										>
											Next
											<IconChevronRight className="size-4 ml-1" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
