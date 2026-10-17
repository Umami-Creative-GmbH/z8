"use client";

import { type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import type { BillableRatePeriodView } from "@/lib/billable-time/rate-target";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	type RateChangeResult,
	RateHistoryCard,
	type RateHistoryCardProps,
} from "./rate-history-card";

interface RateSeriesHistory {
	currency: string;
	periods: BillableRatePeriodView[];
}
type ChangeResult = { changed: boolean; periods: BillableRatePeriodView[] };

interface RateSeriesProps<History extends RateSeriesHistory>
	extends Pick<
		RateHistoryCardProps,
		"title" | "description" | "bare" | "emptyText" | "setRateHelp"
	> {
	queryKey: QueryKey;
	loadHistory: () => Promise<ServerActionResult<History>>;
	setRate: (input: {
		effectiveFrom: string;
		rate: string;
	}) => Promise<ServerActionResult<ChangeResult>>;
	endRate: (input: {
		effectiveFrom: string;
	}) => Promise<ServerActionResult<ChangeResult>>;
	messages: { saved: string; unchanged: string; loadError: string };
	suggestion?: (
		history: History | undefined,
	) => RateHistoryCardProps["suggestion"];
	onChanged?: () => void;
}

/** Query and mutation behavior shared by the explicit billable and cost adapters. */
export function RateSeries<History extends RateSeriesHistory>({
	queryKey,
	loadHistory,
	setRate,
	endRate,
	messages,
	suggestion,
	onChanged,
	...card
}: RateSeriesProps<History>) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const history = useQuery({
		queryKey,
		queryFn: async (): Promise<History> => {
			const result = await loadHistory();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const applyChange = async (
		change: Promise<ServerActionResult<ChangeResult>>,
	): Promise<RateChangeResult> => {
		const result = await change.catch(() => null);
		if (!result) {
			const message = t(
				"common.unexpectedError",
				"An unexpected error occurred",
			);
			toast.error(message);
			return message;
		}
		if (!result.success) {
			toast.error(result.error);
			return result.error;
		}
		queryClient.setQueryData<History>(queryKey, (previous) =>
			previous ? { ...previous, periods: result.data.periods } : previous,
		);
		toast.success(result.data.changed ? messages.saved : messages.unchanged);
		if (result.data.changed) onChanged?.();
		return null;
	};

	if (history.isError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				{history.error.message || messages.loadError}
			</p>
		);
	}

	return (
		<RateHistoryCard
			{...card}
			currency={history.data?.currency ?? ""}
			periods={history.data?.periods ?? []}
			isLoading={history.isPending}
			canEdit={history.isSuccess}
			suggestion={suggestion?.(history.data)}
			onSetRate={(input) => applyChange(setRate(input))}
			onEndRate={(input) => applyChange(endRate(input))}
		/>
	);
}
