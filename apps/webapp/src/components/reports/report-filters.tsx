"use client";

import { IconChartBar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
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
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(currentEmployeeId);
	const [dateRange, setDateRange] = useState<DateRange | null>(null);

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

	const handleGenerate = () => {
		if (selectedEmployeeId && dateRange) {
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
							<label className="text-sm font-medium leading-none">
								{t("reports.filter.period", "Period")}
							</label>
							{dateRange ? (
								<DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
							) : (
								<p className="text-sm text-muted-foreground">
									{t(
										"reports.filter.loadingSettings",
										"Loading organization settings before enabling presets.",
									)}
								</p>
							)}
						</div>
					</div>

					{/* Generate Button */}
					<div className="flex justify-end">
						<Button
							onClick={handleGenerate}
							disabled={isGenerating || !selectedEmployeeId || !dateRange}
							size="lg"
							className="w-full sm:w-auto"
						>
							<IconChartBar className="mr-2 size-4" aria-hidden="true" />
							{isGenerating
								? t("reports.generating", "Generating Report…")
								: t("reports.generate", "Generate Report")}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
