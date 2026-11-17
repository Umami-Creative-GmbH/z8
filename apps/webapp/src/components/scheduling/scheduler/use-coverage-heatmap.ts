"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { getTargetHeatmapData } from "@/app/[locale]/(app)/settings/coverage-rules/actions";
import { ApiError } from "@/lib/api-error";
import type { HeatmapDataPoint } from "@/lib/coverage/domain/entities/coverage-snapshot";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";

function formatDateKey(date: Date): string {
	return date.toISOString().split("T")[0];
}

export type CoverageReadState = "ready" | "loading" | "unavailable" | "unloaded";

export function useCoverageHeatmap(
	organizationId: string,
	dateRange: DateRange,
	enabled: boolean,
	employeeId: string,
) {
	const { t } = useTranslate();
	const { data, isLoading, isFetching, error, refetch } = useQuery({
		queryKey: [...queryKeys.coverage.heatmap(organizationId, dateRange), employeeId],
		queryFn: async () => {
			const result = await getTargetHeatmapData({
				startDate: dateRange.startDate,
				endDateExclusive: dateRange.endDateExclusive,
			});
			if (!result.success) {
				const message = actionErrorMessage(t, result);
				// A scoped coverage refusal is not an expired scheduling session.
				if (result.code === "AuthorizationError") throw new ApiError(message, 403);
				if (result.code === "AuthenticationError") throw new ApiError(message, 401);
				throw new Error(message);
			}
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

	const hasGaps = data?.some((dataPoint) => dataPoint.status === "under") ?? false;
	const readState: CoverageReadState = error
		? "unavailable"
		: data !== undefined
			? "ready"
			: isLoading
				? "loading"
				: "unloaded";

	return {
		data: data || [],
		dataByDate,
		hasGaps,
		isLoading,
		isFetching,
		hasLoadedData: data !== undefined,
		error,
		readState,
		retry: () => refetch({ cancelRefetch: false }),
	};
}
