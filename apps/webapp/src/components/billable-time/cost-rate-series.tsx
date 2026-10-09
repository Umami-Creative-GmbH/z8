"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
	type CostRateChangeResult,
	type CostRateHistory,
	endCostRate,
	getCostRateHistory,
	setCostRate,
} from "@/app/[locale]/(app)/settings/billable-time/cost-rates/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import type { ServerActionResult } from "@/lib/effect/result";
import { queryKeys } from "@/lib/query/keys";
import { type RateChangeResult, RateHistoryCard } from "./rate-history-card";

export interface CostRateSeriesProps {
	employeeId: string;
	title: ReactNode;
	description?: ReactNode;
	/** Render without the card frame, e.g. inside an action panel. */
	bare?: boolean;
	/** Called after a change was saved, e.g. to refresh an overview. */
	onChanged?: () => void;
}

/**
 * One employee's cost rate history, loaded and changed through the Billable
 * Time server actions (#899). Owners and admins only; the actions authorize
 * every read and write. For an hourly employee with a wage in effect, the form
 * offers that wage as a starting value; nothing copies it.
 */
export function CostRateSeries({
	employeeId,
	title,
	description,
	bare,
	onChanged,
}: CostRateSeriesProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.billableTime.costRateHistory(employeeId);

	const history = useQuery({
		queryKey,
		queryFn: async (): Promise<CostRateHistory> => {
			const result = await getCostRateHistory({ employeeId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const applyChange = async (
		change: Promise<ServerActionResult<CostRateChangeResult>>,
	): Promise<RateChangeResult> => {
		const result = await change.catch(() => null);
		if (!result) {
			const message = t("common.unexpectedError", "An unexpected error occurred");
			toast.error(message);
			return message;
		}
		if (!result.success) {
			toast.error(result.error);
			return result.error;
		}
		queryClient.setQueryData<CostRateHistory>(queryKey, (previous) =>
			previous ? { ...previous, periods: result.data.periods } : previous,
		);
		toast.success(
			result.data.changed
				? t("settings.billableTime.costRates.saved", "Cost rate saved")
				: t("settings.billableTime.costRates.unchanged", "That cost rate already applies"),
		);
		if (result.data.changed) onChanged?.();
		return null;
	};

	if (history.isError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				{history.error.message ||
					t("settings.billableTime.costRates.loadError", "Cost rates could not be loaded")}
			</p>
		);
	}

	const suggestedWage = history.data?.suggestedWage ?? null;

	return (
		<RateHistoryCard
			title={title}
			description={description}
			currency={history.data?.currency ?? ""}
			periods={history.data?.periods ?? []}
			isLoading={history.isPending}
			canEdit={history.isSuccess}
			emptyText={t(
				"settings.billableTime.costRates.empty",
				"No cost rate yet. Margin for this employee's work shows as cost unknown.",
			)}
			setRateHelp={t(
				"settings.billableTime.costRates.setRateHelp",
				"The new cost rate applies from this date until the next change. It never changes the wage, payroll or hourly earnings.",
			)}
			suggestion={
				suggestedWage
					? {
							rate: suggestedWage.hourlyRate,
							label: (rate) =>
								t("settings.billableTime.costRates.useWage", "Start from the wage of {rate}", {
									rate,
								}),
						}
					: null
			}
			bare={bare}
			onSetRate={(input) => applyChange(setCostRate({ employeeId, ...input }))}
			onEndRate={(input) => applyChange(endCostRate({ employeeId, ...input }))}
		/>
	);
}

/** A side panel with one employee's cost rates. */
export function CostRateActionPanel({
	open,
	onOpenChange,
	employeeId,
	title,
	description,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	employeeId: string | null;
	title: ReactNode;
	description?: ReactNode;
	onChanged?: () => void;
}) {
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{title}</ActionPanelTitle>
					{description && <ActionPanelDescription>{description}</ActionPanelDescription>}
				</ActionPanelHeader>
				<ActionPanelBody>
					{open && employeeId && (
						<CostRateSeries employeeId={employeeId} title={null} bare onChanged={onChanged} />
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
