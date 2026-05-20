"use client";

import { IconCalendar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { format } from "@/lib/datetime/luxon-utils";
import { formatDateRangeLabel, getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { DateRange, PeriodPreset } from "@/lib/reports/types";
import { cn } from "@/lib/utils";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

interface DateRangePickerProps {
	value: DateRange;
	onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
	const { t } = useTranslate();
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const loadingDescriptionId = useId();
	const [preset, setPreset] = useState<PeriodPreset>("current_month");
	const [isCalendarOpen, setIsCalendarOpen] = useState(false);

	const handlePresetChange = (newPreset: PeriodPreset) => {
		if (!isHydrated) {
			return;
		}

		setPreset(newPreset);

		if (newPreset !== "custom") {
			const range = getDateRangeForPreset(newPreset, { timezone });
			onChange(range);
			setIsCalendarOpen(false);
		} else {
			setIsCalendarOpen(true);
		}
	};

	const handleDateSelect = (range: { from?: Date; to?: Date } | undefined) => {
		if (range?.from && range?.to) {
			onChange({
				start: range.from,
				end: range.to,
			});
		}
	};

	const currentYear = DateTime.now().setZone(timezone).year;

	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
			{/* Preset Selector */}
			<Select
				value={preset}
				onValueChange={(v) => handlePresetChange(v as PeriodPreset)}
				disabled={!isHydrated}
			>
				<SelectTrigger
					aria-describedby={!isHydrated ? loadingDescriptionId : undefined}
					aria-label={t("reports.filter.period", "Period")}
					className="w-full sm:w-[200px]"
				>
					<SelectValue placeholder={t("reports.filter.selectPeriod", "Select period")} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="last_month">{t("reports.period.lastMonth", "Last Month")}</SelectItem>
					<SelectItem value="current_month">
						{t("reports.period.currentMonth", "Current Month")}
					</SelectItem>
					<SelectItem value="last_year">{t("reports.period.lastYear", "Last Year")}</SelectItem>
					<SelectItem value="current_year">
						{t("reports.period.currentYear", "Current Year")}
					</SelectItem>
					<SelectItem value="ytd">{t("reports.period.yearToDate", "Year to Date")}</SelectItem>
					<SelectItem value="q1">Q1 {currentYear}</SelectItem>
					<SelectItem value="q2">Q2 {currentYear}</SelectItem>
					<SelectItem value="q3">Q3 {currentYear}</SelectItem>
					<SelectItem value="q4">Q4 {currentYear}</SelectItem>
					<SelectItem value="custom">{t("reports.period.customRange", "Custom Range")}</SelectItem>
				</SelectContent>
			</Select>
			{!isHydrated && (
				<p id={loadingDescriptionId} className="text-sm text-muted-foreground">
					{t(
						"reports.filter.loadingSettings",
						"Loading organization settings before enabling presets.",
					)}
				</p>
			)}

			{/* Calendar picker for custom range */}
			{preset === "custom" && (
				<Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							className={cn(
								"w-full justify-start text-left font-normal sm:w-[280px]",
								!value && "text-muted-foreground",
							)}
						>
							<IconCalendar className="mr-2 size-4" />
							{value?.start ? (
								value.end ? (
									<>
										{format(value.start, "LLL dd, y")} - {format(value.end, "LLL dd, y")}
									</>
								) : (
									format(value.start, "LLL dd, y")
								)
							) : (
								<span>{t("reports.period.pickDateRange", "Pick a date range")}</span>
							)}
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-auto p-0" align="start">
						<Calendar
							autoFocus
							mode="range"
							defaultMonth={value?.start}
							selected={{
								from: value?.start,
								to: value?.end,
							}}
							onSelect={handleDateSelect}
							numberOfMonths={2}
						/>
					</PopoverContent>
				</Popover>
			)}

			{/* Display current range for non-custom presets */}
			{preset !== "custom" && (
				<div className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-sm text-muted-foreground">
					<IconCalendar className="mr-2 size-4" />
					{formatDateRangeLabel(value.start, value.end, timezone)}
				</div>
			)}
		</div>
	);
}
