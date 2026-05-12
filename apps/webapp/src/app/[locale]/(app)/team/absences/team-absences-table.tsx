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

	return (
		<div className="space-y-4">
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
