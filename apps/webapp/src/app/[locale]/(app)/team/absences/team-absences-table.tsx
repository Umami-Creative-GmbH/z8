"use client";

import { IconSearch } from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState, useTransition } from "react";
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
import { useRouter } from "@/navigation";
import type { ManagerAbsenceEmployeeRow, ManagerAbsenceListResult } from "./manager-absence-types";
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

export function TeamAbsencesTable({ data, categories, search }: TeamAbsencesTableProps) {
	const router = useRouter();
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

		Object.entries(updates).forEach(([key, value]) => {
			if (value === null || value === "") {
				params.delete(key);
				return;
			}

			params.set(key, String(value));
		});

		const query = params.toString();
		startTransition(() => {
			router.push(query ? `/team/absences?${query}` : "/team/absences");
		});
	}

	function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const nextSearch = String(formData.get("search") ?? "").trim();

		pushParams({ search: nextSearch || null, page: 1 });
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
				<form className="flex w-full gap-2 sm:max-w-md" onSubmit={handleSearchSubmit}>
					<div className="relative flex-1">
						<IconSearch
							className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							type="search"
							name="search"
							defaultValue={search}
							placeholder="Search employees…"
							aria-label="Search employees"
							autoComplete="off"
							className="pl-9"
							disabled={isPending}
						/>
					</div>
					<Button type="submit" variant="outline" disabled={isPending}>
						Search
					</Button>
				</form>

				<Select
					value={String(data.year)}
					onValueChange={(year) => pushParams({ year, page: 1 })}
					disabled={isPending}
				>
					<SelectTrigger className="w-full sm:w-36" aria-label="Filter by year">
						<SelectValue placeholder="Year" />
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

			{hasRows ? (
				<div className="rounded-lg border bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Employee</TableHead>
								<TableHead>Team or Position</TableHead>
								<TableHead className="text-right">Allowance</TableHead>
								<TableHead className="text-right">Used</TableHead>
								<TableHead className="hidden text-right md:table-cell">Pending</TableHead>
								<TableHead className="text-right">Left</TableHead>
								<TableHead className="hidden text-right lg:table-cell">Sick</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.rows.map((employee) => (
								<TableRow key={employee.id}>
									<TableCell>
										<div className="min-w-0">
											<p className="truncate font-medium">{employee.name}</p>
											<p className="truncate text-muted-foreground text-sm">{employee.email}</p>
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
									<TableCell className="hidden text-right tabular-nums md:table-cell">
										{employee.pendingVacationDays}
									</TableCell>
									<TableCell className="text-right font-medium tabular-nums">
										{employee.remainingVacationDays}
									</TableCell>
									<TableCell className="hidden text-right tabular-nums lg:table-cell">
										{employee.sickDays}
									</TableCell>
									<TableCell className="text-right">
										<Button
											type="button"
											variant="outline"
											size="sm"
											aria-label={`Record absence for ${employee.name}`}
											onClick={() => setSelectedEmployee(employee)}
										>
											Record absence
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : (
				<div
					role="status"
					aria-label="No employees found"
					className="rounded-lg border bg-card p-6 text-center"
				>
					<p className="font-medium">No employees found</p>
					<p className="mt-1 text-muted-foreground text-sm">
						Try adjusting filters or search to find team members.
					</p>
				</div>
			)}

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-muted-foreground text-sm">
					Showing {firstItem} to {lastItem} of {data.total}
				</p>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => pushParams({ page: data.page - 1 })}
						disabled={!canGoPrevious || isPending}
						aria-label="Previous page"
					>
						Previous
					</Button>
					<span className="text-muted-foreground text-sm tabular-nums">
						Page {visiblePage} of {visiblePageCount}
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => pushParams({ page: data.page + 1 })}
						disabled={!canGoNext || isPending}
						aria-label="Next page"
					>
						Next
					</Button>
				</div>
			</div>

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
