"use client";

import { FileBarChart } from "lucide-react";
import { useMemo, useState } from "react";
import { EmployeeSingleSelect, type SelectableEmployee } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { AccessibleEmployee, DateRange } from "@/lib/reports/types";
import { DateRangePicker } from "./date-range-picker";

interface ReportFiltersProps {
	employees: AccessibleEmployee[];
	currentEmployeeId: string;
	onGenerate: (employeeId: string, dateRange: DateRange) => void;
	isGenerating?: boolean;
}

/**
 * Convert AccessibleEmployee to SelectableEmployee format for the employee selector
 */
function toSelectableEmployee(emp: AccessibleEmployee): SelectableEmployee {
	return {
		id: emp.id,
		userId: emp.id, // Use same ID as seed for avatar
		firstName: null,
		lastName: null,
		position: emp.position,
		role: emp.role,
		isActive: true,
		teamId: null,
		user: {
			id: emp.id,
			name: emp.name,
			email: emp.email,
			image: null,
		},
		team: null,
	};
}

export function ReportFilters({
	employees,
	currentEmployeeId,
	onGenerate,
	isGenerating = false,
}: ReportFiltersProps) {
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(currentEmployeeId);
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_month"));

	// Convert AccessibleEmployee[] to SelectableEmployee[] for the employee selector
	const selectableEmployees = useMemo(() => employees.map(toSelectableEmployee), [employees]);

	const showEmployeeSelector = employees.length > 1;

	const handleGenerate = () => {
		if (selectedEmployeeId) {
			onGenerate(selectedEmployeeId, dateRange);
		}
	};

	return (
		<Card>
			<CardContent className="pt-6">
				<div className="flex flex-col gap-4">
					<div
						className={`grid gap-4 ${showEmployeeSelector ? "md:grid-cols-2" : "md:grid-cols-1"}`}
					>
						{/* Employee Selector - only show if user has access to multiple employees */}
						{showEmployeeSelector && (
							<div className="space-y-2">
								<label className="text-sm font-medium leading-none">Employee</label>
								<EmployeeSingleSelect
									value={selectedEmployeeId}
									onChange={setSelectedEmployeeId}
									employees={selectableEmployees}
									placeholder="Select employee"
									disabled={isGenerating}
									className="space-y-0"
								/>
							</div>
						)}

						{/* Date Range Picker */}
						<div className="space-y-2">
							<label className="text-sm font-medium leading-none">Period</label>
							<DateRangePicker value={dateRange} onChange={setDateRange} />
						</div>
					</div>

					{/* Generate Button */}
					<div className="flex justify-end">
						<Button
							onClick={handleGenerate}
							disabled={isGenerating || !selectedEmployeeId}
							size="lg"
							className="w-full sm:w-auto"
						>
							<FileBarChart className="mr-2 h-4 w-4" />
							{isGenerating ? "Generating Report..." : "Generate Report"}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
