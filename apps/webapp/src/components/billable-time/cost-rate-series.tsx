"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import {
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
import { queryKeys } from "@/lib/query/keys";
import { RateSeries } from "./rate-series";

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

	return (
		<RateSeries<CostRateHistory>
			title={title}
			description={description}
			bare={bare}
			onChanged={onChanged}
			queryKey={queryKeys.billableTime.costRateHistory(employeeId)}
			loadHistory={() => getCostRateHistory({ employeeId })}
			setRate={(input) => setCostRate({ employeeId, ...input })}
			endRate={(input) => endCostRate({ employeeId, ...input })}
			messages={{
				saved: t("settings.billableTime.costRates.saved", "Cost rate saved"),
				unchanged: t(
					"settings.billableTime.costRates.unchanged",
					"That cost rate already applies",
				),
				loadError: t(
					"settings.billableTime.costRates.loadError",
					"Cost rates could not be loaded",
				),
			}}
			emptyText={t(
				"settings.billableTime.costRates.empty",
				"No cost rate yet. Margin for this employee's work shows as cost unknown.",
			)}
			setRateHelp={t(
				"settings.billableTime.costRates.setRateHelp",
				"The new cost rate applies from this date until the next change. It never changes the wage, payroll or hourly earnings.",
			)}
			suggestion={(history) =>
				history?.suggestedWage
					? {
							rate: history.suggestedWage.hourlyRate,
							label: (rate) =>
								t(
									"settings.billableTime.costRates.useWage",
									"Start from the wage of {rate}",
									{ rate },
								),
						}
					: null
			}
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
					{description && (
						<ActionPanelDescription>{description}</ActionPanelDescription>
					)}
				</ActionPanelHeader>
				<ActionPanelBody>
					{open && employeeId && (
						<CostRateSeries
							employeeId={employeeId}
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
