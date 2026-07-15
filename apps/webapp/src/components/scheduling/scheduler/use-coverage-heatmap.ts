"use client";

import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { getTargetHeatmapData } from "@/app/[locale]/(app)/settings/coverage-rules/actions";
import type { HeatmapDataPoint } from "@/lib/coverage/domain/entities/coverage-snapshot";
import { queryKeys } from "@/lib/query/keys";

function formatDateKey(date: Date): string {
	return date.toISOString().split("T")[0];
}

export function useCoverageHeatmap(
	organizationId: string,
	dateRange: DateRange,
	enabled: boolean,
) {
	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.coverage.heatmap(organizationId, dateRange),
		queryFn: async () => {
			const result = await getTargetHeatmapData({
				startDate: dateRange.startDate,
				endDateExclusive: dateRange.endDateExclusive,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled,
	});

	const dataByDate = (() => {
		if (!data) return new Map<string, HeatmapDataPoint[]>();

		const map = new Map<string, HeatmapDataPoint[]>();
		for (const point of data) {
			const key = formatDateKey(point.date);
			const existing = map.get(key) || [];
			existing.push(point);
			map.set(key, existing);
		}
		return map;
	})();

	const hasGaps =
		data?.some((dataPoint) => dataPoint.status === "under") ?? false;

	return {
		data: data || [],
		dataByDate,
		hasGaps,
		isLoading,
		error,
	};
}
