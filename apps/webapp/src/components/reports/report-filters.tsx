"use client";

import { useState } from "react";
import { FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { AccessibleEmployee, DateRange } from "@/lib/reports/types";
import { DateRangePicker } from "./date-range-picker";

interface ReportFiltersProps {
	employees: AccessibleEmployee[];
	currentEmployeeId: string;
	onGenerate: (employeeId: string, dateRange: DateRange) => void;
	isGenerating?: boolean;
}

export function ReportFilters({
	employees,
	currentEmployeeId,
	onGenerate,
	isGenerating = false,
}: ReportFiltersProps) {
	const [selectedEmployeeId, setSelectedEmployeeId] = useState(currentEmployeeId);
	const [dateRange, setDateRange] = useState<DateRange>(
		getDateRangeForPreset("current_month"),
	);

	const showEmployeeSelector = employees.length > 1;

	const handleGenerate = () => {
		onGenerate(selectedEmployeeId, dateRange);
	};

	return (
		<Card>
			<CardContent className="pt-6">
				<div className="flex flex-col gap-4">
					<div className={`grid gap-4 ${showEmployeeSelector ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
						{/* Employee Selector - only show if user has access to multiple employees */}
						{showEmployeeSelector && (
							<div className="space-y-2">
								<label className="text-sm font-medium leading-none">Employee</label>
								<Select
									value={selectedEmployeeId}
									onValueChange={setSelectedEmployeeId}
									disabled={isGenerating}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select employee" />
									</SelectTrigger>
									<SelectContent>
										{employees.map((emp) => (
											<SelectItem key={emp.id} value={emp.id}>
												{emp.name}
												{emp.position && ` - ${emp.position}`}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
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
							disabled={isGenerating}
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
