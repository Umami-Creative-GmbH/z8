"use client";

import { IconChartBar } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { ReportDateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { DateRangePicker } from "./date-range-picker";
import { ReportEmployeeSelector } from "./report-employee-selector";

interface ReportFiltersProps {
	currentEmployeeId: string;
	onGenerate: (employeeId: string, dateRange: ReportDateRange) => void;
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
	const form = useForm({
		defaultValues: {
			employeeId: currentEmployeeId as string | null,
			dateRange: null as ReportDateRange | null,
		},
		onSubmit: ({ value }) => {
			if (value.employeeId && value.dateRange && !isGenerating)
				onGenerate(value.employeeId, value.dateRange);
		},
	});

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		form.setFieldValue(
			"dateRange",
			getDateRangeForPreset("current_month", { timezone }),
		);
	}, [form, isHydrated, timezone]);

	return (
		<Card>
			<CardContent className="pt-6">
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<h2 className="font-semibold">
						{t("reports.filter.title", "Generate an employee report")}
					</h2>
					<div className="grid gap-4 md:grid-cols-2">
						{/* Employee Selector - rendered by ReportEmployeeSelector, hidden for regular employees */}
						<form.Field name="employeeId">
							{(field) => (
								<ReportEmployeeSelector
									currentEmployeeId={currentEmployeeId}
									selectedEmployeeId={field.state.value}
									onEmployeeChange={field.handleChange}
									disabled={isGenerating}
								/>
							)}
						</form.Field>

						{/* Date Range Picker */}
						<form.Field name="dateRange">
							{(field) => (
								<fieldset
									className="min-w-0 space-y-2 [&>div]:flex-wrap [&>div>*]:min-w-0 [&>div>*]:max-w-full [&>div>div]:h-auto [&>div>div]:min-h-9 [&>div>div]:py-2"
									disabled={isGenerating}
								>
									<legend className="text-sm font-medium leading-none">
										{t("reports.filter.period", "Period")}
									</legend>
									{field.state.value ? (
										<DateRangePicker
											value={field.state.value}
											onChange={(range) => {
												hasUserChangedRange.current = true;
												field.handleChange(range);
											}}
										/>
									) : (
										<p className="text-sm text-muted-foreground">
											{t(
												"reports.filter.loadingSettings",
												"Loading organization settings before enabling presets.",
											)}
										</p>
									)}
								</fieldset>
							)}
						</form.Field>
					</div>

					{/* Generate Button */}
					<div className="flex justify-end">
						<form.Subscribe selector={(state) => state.values}>
							{(values) => (
								<Button
									type="submit"
									disabled={
										isGenerating || !values.employeeId || !values.dateRange
									}
									size="lg"
									className="w-full sm:w-auto"
								>
									<IconChartBar className="mr-2 size-4" aria-hidden="true" />
									{isGenerating
										? t("reports.generating", "Generating Report…")
										: t("reports.generate", "Generate Report")}
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
