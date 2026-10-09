"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
	type BillableRateHistory,
	endBillableRate,
	getBillableRateHistory,
	setBillableRate,
} from "@/app/[locale]/(app)/settings/billable-time/rates/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import type { BillableRatePeriodView, BillableRateTarget } from "@/lib/billable-time/rate-target";
import { billableRateTargetIds } from "@/lib/billable-time/rate-target";
import type { ServerActionResult } from "@/lib/effect/result";
import { queryKeys } from "@/lib/query/keys";
import { type RateChangeResult, RateHistoryCard } from "./rate-history-card";

function rateHistoryKey(target: BillableRateTarget) {
	const ids = billableRateTargetIds(target);
	return queryKeys.billableTime.rateHistory(
		target.level,
		ids.employeeId,
		ids.projectId,
		ids.customerId,
	);
}

/** Which rate applies when this level has none, by level. */
function useFallbackText(level: BillableRateTarget["level"]): string {
	const { t } = useTranslate();
	switch (level) {
		case "employee_project":
			return t(
				"settings.billableTime.rates.emptyEmployeeProject",
				"No rate for this employee on this project. The project, customer or employee rate applies.",
			);
		case "project":
			return t(
				"settings.billableTime.rates.emptyProject",
				"No project rate. The customer or employee rate applies.",
			);
		case "customer":
			return t(
				"settings.billableTime.rates.emptyCustomer",
				"No customer rate. Each employee's rate applies.",
			);
		case "employee":
			return t(
				"settings.billableTime.rates.emptyEmployee",
				"No employee rate. Work without a more specific rate is unpriced.",
			);
	}
}

export interface BillableRateSeriesProps {
	target: BillableRateTarget;
	title: ReactNode;
	description?: ReactNode;
	/** Render without the card frame, e.g. inside an action panel. */
	bare?: boolean;
	/** Called after a change was saved, e.g. to refresh an overview. */
	onChanged?: () => void;
}

/**
 * The billable rate history of one rate level and target, loaded and changed
 * through the Billable Time server actions (#898). Owners and admins only; the
 * actions authorize every read and write.
 */
export function BillableRateSeries({
	target,
	title,
	description,
	bare,
	onChanged,
}: BillableRateSeriesProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = rateHistoryKey(target);
	const emptyText = useFallbackText(target.level);

	const history = useQuery({
		queryKey,
		queryFn: async (): Promise<BillableRateHistory> => {
			const result = await getBillableRateHistory({ target });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const applyChange = async (
		change: Promise<ServerActionResult<{ changed: boolean; periods: BillableRatePeriodView[] }>>,
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
		queryClient.setQueryData<BillableRateHistory>(queryKey, (previous) =>
			previous ? { ...previous, periods: result.data.periods } : previous,
		);
		toast.success(
			result.data.changed
				? t("settings.billableTime.rates.saved", "Billable rate saved")
				: t("settings.billableTime.rates.unchanged", "That rate already applies"),
		);
		if (result.data.changed) onChanged?.();
		return null;
	};

	if (history.isError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				{history.error.message ||
					t("settings.billableTime.rates.loadError", "Billable rates could not be loaded")}
			</p>
		);
	}

	return (
		<RateHistoryCard
			title={title}
			description={description}
			currency={history.data?.currency ?? ""}
			periods={history.data?.periods ?? []}
			isLoading={history.isPending}
			canEdit={history.isSuccess}
			emptyText={emptyText}
			bare={bare}
			onSetRate={(input) => applyChange(setBillableRate({ target, ...input }))}
			onEndRate={(input) => applyChange(endBillableRate({ target, ...input }))}
		/>
	);
}

/** A side panel with one billable rate series, for contextual entry points. */
export function BillableRateActionPanel({
	open,
	onOpenChange,
	target,
	title,
	description,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: BillableRateTarget | null;
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
					{open && target && (
						<BillableRateSeries target={target} title={null} bare onChanged={onChanged} />
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
