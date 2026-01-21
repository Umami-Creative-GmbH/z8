"use client";

import { FileBarChart } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { DateRangePicker } from "./date-range-picker";
import { ReportEmployeeSelector } from "./report-employee-selector";

interface ReportFiltersProps {
	currentEmployeeId: string;
	onGenerate: (employeeId: string, dateRange: DateRange) => void;
	isGenerating?: boolean;
}

export function ReportFilters({
	currentEmployeeId,
	onGenerate,
	isGenerating = false,
}: ReportFiltersProps) {
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(currentEmployeeId);
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_month"));

	const handleGenerate = () => {
		if (selectedEmployeeId) {
			onGenerate(selectedEmployeeId, dateRange);
		}
	};

	return (
		<Card>
			<CardContent className="pt-6">
				<div className="flex flex-col gap-4">
					<div className="grid gap-4 md:grid-cols-2">
						{/* Employee Selector - rendered by ReportEmployeeSelector, hidden for regular employees */}
						<ReportEmployeeSelector
							currentEmployeeId={currentEmployeeId}
							selectedEmployeeId={selectedEmployeeId}
							onEmployeeChange={setSelectedEmployeeId}
							disabled={isGenerating}
						/>

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
							<FileBarChart className="mr-2 h-4 w-4" aria-hidden="true" />
							{isGenerating ? "Generating Report…" : "Generate Report"}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
