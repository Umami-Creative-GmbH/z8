"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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

export function TeamAbsencesTable({ data, categories }: TeamAbsencesTableProps) {
	const [selectedEmployee, setSelectedEmployee] = useState<ManagerAbsenceEmployeeRow | null>(null);
	const hasRows = data.rows.length > 0;

	return (
		<div className="space-y-4">
			{hasRows ? (
				<div className="rounded-lg border">
					{data.rows.map((employee) => (
						<div
							key={employee.id}
							className="flex flex-col gap-3 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{employee.name}</p>
								<p className="text-muted-foreground text-sm">Remaining vacation days</p>
								<p className="font-semibold tabular-nums">{employee.remainingVacationDays}</p>
							</div>
							<Button type="button" onClick={() => setSelectedEmployee(employee)}>
								Record absence
							</Button>
						</div>
					))}
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
