"use client";

import { FileBarChart } from "lucide-react";
import { useState } from "react";
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
import type { DateRange } from "@/lib/reports/types";
import { DateRangePicker } from "../date-range-picker";

interface ProjectFiltersProps {
	onGenerate: (dateRange: DateRange, statusFilter?: string[]) => void;
	isGenerating?: boolean;
}

const STATUS_OPTIONS = [
	{ value: "all", label: "All Statuses" },
	{ value: "active", label: "Active Only" },
	{ value: "active,planned", label: "Active & Planned" },
	{ value: "completed", label: "Completed" },
	{ value: "archived", label: "Archived" },
];

export function ProjectFilters({ onGenerate, isGenerating = false }: ProjectFiltersProps) {
	const [dateRange, setDateRange] = useState<DateRange>(getDateRangeForPreset("current_month"));
	const [statusFilter, setStatusFilter] = useState<string>("all");

	const handleGenerate = () => {
		const statusArray = statusFilter === "all" ? undefined : statusFilter.split(",");
		onGenerate(dateRange, statusArray);
	};

	return (
		<Card>
			<CardContent className="pt-6">
				<div className="flex flex-col gap-4">
					<div className="grid gap-4 md:grid-cols-2">
						{/* Date Range Picker */}
						<div className="space-y-2">
							<label className="text-sm font-medium leading-none">Period</label>
							<DateRangePicker value={dateRange} onChange={setDateRange} />
						</div>

						{/* Status Filter */}
						<div className="space-y-2">
							<label className="text-sm font-medium leading-none">Status</label>
							<Select value={statusFilter} onValueChange={setStatusFilter} disabled={isGenerating}>
								<SelectTrigger>
									<SelectValue placeholder="Select status filter" />
								</SelectTrigger>
								<SelectContent>
									{STATUS_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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
