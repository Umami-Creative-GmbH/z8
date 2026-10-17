"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
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
import type { BillableRateTarget } from "@/lib/billable-time/rate-target";
import { billableRateTargetIds } from "@/lib/billable-time/rate-target";
import { queryKeys } from "@/lib/query/keys";
import { RateSeries } from "./rate-series";

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
	const emptyText = useFallbackText(target.level);

	return (
		<RateSeries<BillableRateHistory>
			title={title}
			description={description}
			bare={bare}
			onChanged={onChanged}
			queryKey={rateHistoryKey(target)}
			loadHistory={() => getBillableRateHistory({ target })}
			setRate={(input) => setBillableRate({ target, ...input })}
			endRate={(input) => endBillableRate({ target, ...input })}
			emptyText={emptyText}
			messages={{
				saved: t("settings.billableTime.rates.saved", "Billable rate saved"),
				unchanged: t(
					"settings.billableTime.rates.unchanged",
					"That rate already applies",
				),
				loadError: t(
					"settings.billableTime.rates.loadError",
					"Billable rates could not be loaded",
				),
			}}
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
					{description && (
						<ActionPanelDescription>{description}</ActionPanelDescription>
					)}
				</ActionPanelHeader>
				<ActionPanelBody>
					{open && target && (
						<BillableRateSeries
							target={target}
							title={null}
							bare
							onChanged={onChanged}
						/>
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
