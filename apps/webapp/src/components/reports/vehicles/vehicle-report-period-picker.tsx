"use client";

import { useTranslate } from "@tolgee/react";
import { DateRangePicker } from "../date-range-picker";
import type { ReportDateRange } from "@/lib/reports/types";

interface VehicleReportPeriodPickerProps {
	value: ReportDateRange;
	onChange: (range: ReportDateRange) => void;
}

export function VehicleReportPeriodPicker({ value, onChange }: VehicleReportPeriodPickerProps) {
	const { t } = useTranslate();
	return (
		<DateRangePicker
			value={value}
			onChange={onChange}
			initialPreset="current_year"
			loadingDescription={t(
				"reports.filter.loadingSettings",
				"Loading organization settings before enabling presets.",
			)}
		/>
	);
}
