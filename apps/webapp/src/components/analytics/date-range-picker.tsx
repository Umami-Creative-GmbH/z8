"use client";

import { DateRangePicker } from "@/components/reports/date-range-picker";
import { toAnalyticsDateRange, toReportDateRange } from "@/lib/analytics/date-ranges";
import type { DateRange } from "@/lib/analytics/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

interface AnalyticsDateRangePickerProps {
	value: DateRange;
	onChange: (range: DateRange) => void;
}

export function AnalyticsDateRangePicker({ value, onChange }: AnalyticsDateRangePickerProps) {
	const timezone = useOrganizationSettings((state) => state.timezone);

	return (
		<DateRangePicker
			value={toReportDateRange(value, timezone)}
			onChange={(range) => onChange(toAnalyticsDateRange(range, timezone))}
		/>
	);
}
