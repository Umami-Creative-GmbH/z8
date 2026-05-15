"use client";

import { useTranslate } from "@tolgee/react";
import { FileBarChart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { DateRangePicker } from "../date-range-picker";

interface ProjectFiltersProps {
	onGenerate: (dateRange: DateRange, statusFilter?: string[]) => void;
	isGenerating?: boolean;
}

export function ProjectFilters({ onGenerate, isGenerating = false }: ProjectFiltersProps) {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);
	const [statusFilter, setStatusFilter] = useState<string>("all");

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		setDateRange(getDateRangeForPreset("current_month", { timezone }));
	}, [isHydrated, timezone]);

	const handleDateRangeChange = (range: DateRange) => {
		hasUserChangedRange.current = true;
		setDateRange(range);
	};

	const STATUS_OPTIONS = [
		{ value: "all", label: t("reports.projects.filter.allStatuses", "All Statuses") },
		{ value: "active", label: t("reports.projects.filter.activeOnly", "Active Only") },
		{
			value: "active,planned",
			label: t("reports.projects.filter.activePlanned", "Active & Planned"),
		},
		{ value: "completed", label: t("reports.projects.filter.completed", "Completed") },
		{ value: "archived", label: t("reports.projects.filter.archived", "Archived") },
	];

	const handleGenerate = () => {
		if (!dateRange) {
			return;
		}

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
							<label className="text-sm font-medium leading-none">
								{t("reports.projects.filter.period", "Period")}
							</label>
							{dateRange ? (
								<DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
							) : (
								<p className="text-sm text-muted-foreground">
									Loading organization settings before enabling presets.
								</p>
							)}
						</div>

						{/* Status Filter */}
						<div className="space-y-2">
							<label className="text-sm font-medium leading-none">
								{t("reports.projects.filter.status", "Status")}
							</label>
							<Select value={statusFilter} onValueChange={setStatusFilter} disabled={isGenerating}>
								<SelectTrigger>
									<SelectValue
										placeholder={t("reports.projects.filter.selectStatus", "Select status filter")}
									/>
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
							disabled={isGenerating || !dateRange}
							size="lg"
							className="w-full sm:w-auto"
						>
							<FileBarChart className="mr-2 h-4 w-4" />
							{isGenerating
								? t("reports.projects.generating", "Generating Report...")
								: t("reports.projects.generate", "Generate Report")}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
