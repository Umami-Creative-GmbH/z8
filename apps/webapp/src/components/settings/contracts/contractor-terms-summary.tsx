"use client";

import { IconCalendar, IconCircleDot } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatRateDate, lastDayBefore } from "@/lib/billable-time/format";
import type {
	ContractorCompensationRecord,
	ContractorTermsView,
} from "@/lib/contractor-compensation/store";
import { cn } from "@/lib/utils";
import { describeCompensation } from "./contractor-terms-describe";

/**
 * A contractor's terms across their engagements, newest first: the terms in
 * effect today highlighted, an earlier engagement's terms marked as such.
 */
export function ContractorTermsHistory({
	record,
	inEffect,
}: {
	record: Pick<ContractorCompensationRecord, "history" | "contractorEngagementId">;
	inEffect: ContractorTermsView | null;
}) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	if (record.history.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.contracts.contractors.empty",
					"No rate yet. This contractor's work stays unpriced until a rate applies.",
				)}
			</p>
		);
	}
	return (
		<div className="relative pl-6">
			<div aria-hidden="true" className="absolute top-0 bottom-0 left-[11px] w-px bg-border" />
			<ol className="space-y-4">
				{record.history.map((terms) => {
					const isInEffect = terms.id === inEffect?.id;
					// Open terms of an ended engagement never price later work; say so.
					const isEarlierEngagement = terms.employmentPeriodId !== record.contractorEngagementId;
					const summary = describeCompensation(t, locale, terms.compensation);
					// Plain days are formatted as they are.
					const from = formatRateDate(locale, terms.effectiveFrom);
					return (
						<li key={terms.id} className="relative flex items-start gap-4">
							<div
								aria-hidden="true"
								className={cn(
									"absolute left-[-13px] flex size-6 items-center justify-center rounded-full",
									isInEffect ? "bg-primary text-primary-foreground" : "bg-muted",
								)}
							>
								<IconCircleDot className="size-4" />
							</div>
							<div className="ml-4 min-w-0 flex-1 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className={cn("font-medium tabular-nums", isInEffect && "text-primary")}>
										{summary.rate}
									</span>
									{isInEffect && (
										<Badge variant="default">
											{t("settings.contracts.contractors.inEffect", "In effect")}
										</Badge>
									)}
									{isEarlierEngagement && (
										<Badge variant="outline">
											{t("settings.contracts.contractors.earlierEngagement", "Earlier engagement")}
										</Badge>
									)}
								</div>
								{summary.rule && <p className="text-sm text-muted-foreground">{summary.rule}</p>}
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<IconCalendar aria-hidden="true" className="size-3" />
									<span className="tabular-nums">
										{terms.effectiveTo === null
											? t("settings.contracts.contractors.openPeriod", "From {from}", { from })
											: t("settings.contracts.contractors.closedPeriod", "{from} to {to}", {
													from,
													to: formatRateDate(locale, lastDayBefore(terms.effectiveTo)),
												})}
									</span>
								</div>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
