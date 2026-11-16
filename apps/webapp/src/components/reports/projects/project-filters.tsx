"use client";

import { IconChartBar } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { ReportDateRange } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { DateRangePicker } from "../date-range-picker";

interface ProjectFiltersProps {
	onGenerate: (dateRange: ReportDateRange, statusFilter?: string[]) => void;
	isGenerating?: boolean;
}

export function ProjectFilters({
	onGenerate,
	isGenerating = false,
}: ProjectFiltersProps) {
	const { t } = useTranslate();
	const statusFilterId = useId();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const lifetime = useRef<object | null>(null);
	useLayoutEffect(() => {
		lifetime.current = {};
		return () => {
			lifetime.current = null;
		};
	}, []);
	const form = useForm({
		defaultValues: {
			dateRange: null as ReportDateRange | null,
			statusFilter: "all",
		},
		onSubmitMeta: { generation: null as object | null },
		onSubmit: ({ value, meta }) => {
			if (
				!value.dateRange ||
				isGenerating ||
				!meta.generation ||
				meta.generation !== lifetime.current
			)
				return;
			onGenerate(
				value.dateRange,
				value.statusFilter === "all"
					? undefined
					: value.statusFilter.split(","),
			);
		},
	});
	const { dateRange, statusFilter } = useStore(
		form.store,
		(state) => state.values,
	);

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) {
			return;
		}

		form.setFieldValue(
			"dateRange",
			getDateRangeForPreset("current_month", { timezone }),
		);
	}, [form, isHydrated, timezone]);

	const handleDateRangeChange = (range: ReportDateRange) => {
		hasUserChangedRange.current = true;
		form.setFieldValue("dateRange", range);
	};

	const STATUS_OPTIONS = [
		{
			value: "all",
			label: t("reports.projects.filter.allStatuses", "All Statuses"),
		},
		{
			value: "active",
			label: t("reports.projects.filter.activeOnly", "Active Only"),
		},
		{
			value: "active,planned",
			label: t("reports.projects.filter.activePlanned", "Active & Planned"),
		},
		{
			value: "completed",
			label: t("reports.projects.filter.completed", "Completed"),
		},
		{
			value: "archived",
			label: t("reports.projects.filter.archived", "Archived"),
		},
	];

	return (
		<Card>
			<CardContent className="pt-6">
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit({ generation: lifetime.current });
					}}
				>
					<div className="grid gap-4 md:grid-cols-2">
						{/* Date Range Picker */}
						<fieldset disabled={isGenerating} className="min-w-0 space-y-2">
							<legend className="text-sm font-medium leading-none">
								{t("reports.projects.filter.period", "Period")}
							</legend>
							{dateRange ? (
								<DateRangePicker
									value={dateRange}
									onChange={handleDateRangeChange}
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

						{/* Status Filter */}
						<div className="space-y-2">
							<Label
								htmlFor={statusFilterId}
								className="text-sm font-medium leading-none"
							>
								{t("reports.projects.filter.status", "Status")}
							</Label>
							<Select
								value={statusFilter}
								onValueChange={(value) =>
									form.setFieldValue("statusFilter", value ?? "all")
								}
								disabled={isGenerating}
							>
								<SelectTrigger id={statusFilterId}>
									<SelectValue
										placeholder={t(
											"reports.projects.filter.selectStatus",
											"Select status filter",
										)}
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
							type="submit"
							disabled={isGenerating || !dateRange}
							size="default"
							className="w-full sm:w-auto"
						>
							<IconChartBar aria-hidden="true" className="mr-2 size-4" />
							{isGenerating
								? t("reports.projects.generating", "Generating Report...")
								: t("reports.projects.generate", "Generate Report")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
