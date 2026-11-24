"use client";

import { IconExternalLink, IconGauge, IconInfoCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { listStatutoryMonitorFindingsAction } from "@/app/[locale]/(app)/settings/contracts/statutory-review-actions";
import { statutoryWarningText } from "@/components/scheduling/statutory-warning-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { StatutoryReviewDomain } from "@/lib/statutory/review-domains";
import { Link } from "@/navigation";
import { reviewDomainLabel } from "./statutory-review-shared";

export const statutoryMonitorFindingsQueryKey = (organizationId: string) =>
	["contracts", "statutory-monitor-findings", organizationId] as const;

/**
 * Statutory findings an org admin cannot acknowledge, only act on (#1994): Minijob tiers and the
 * rolling 12-month cap, short-term day and month limits, JArbSchG hard limits and apprentice
 * release conflicts, in the planning horizon. Each links to the employee.
 */
export function StatutoryMonitorFindingsSection({
	organizationId,
	domain,
	showWhenEmpty = false,
}: {
	readonly organizationId: string;
	/** Only this domain's findings; null for every domain. */
	readonly domain: StatutoryReviewDomain | null;
	/** Show the card with an empty note instead of nothing. */
	readonly showWhenEmpty?: boolean;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const query = useQuery({
		queryKey: statutoryMonitorFindingsQueryKey(organizationId),
		queryFn: async () => {
			const result = await listStatutoryMonitorFindingsAction();
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		staleTime: 30 * 1000,
	});
	const items = (query.data ?? []).filter((item) => !domain || item.reviewDomain === domain);
	if (query.isPending || (items.length === 0 && !query.isError && !showWhenEmpty)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconGauge className="size-5 text-primary" aria-hidden="true" />
					{t("settings.contracts.reviews.monitor.title", "Statutory limits to act on")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.reviews.monitor.description",
						"Limits approaching or exceeded in the last week and the next eight weeks that cannot be acknowledged: change the schedule or the contract instead. Shown until the figures are back within the limit.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isError ? (
					<p className="text-destructive text-sm" role="alert">
						{query.error.message}
					</p>
				) : items.length === 0 ? (
					<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
						<IconInfoCircle className="size-4" aria-hidden="true" />
						{t(
							"settings.contracts.reviews.monitor.empty",
							"No statutory limits approaching or exceeded.",
						)}
					</div>
				) : (
					<ul className="space-y-2">
						{items.map((item) => (
							<li key={item.id} className="space-y-1 rounded-lg border p-3 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>
										{item.severity === "critical"
											? t("settings.contracts.reviews.severity.critical", "Critical")
											: t("settings.contracts.reviews.severity.warning", "Warning")}
									</Badge>
									<Link
										href={`/settings/employees/${item.employeeId}#contract`}
										className="inline-flex items-center gap-1 font-medium hover:underline"
									>
										{item.employeeName}
										<IconExternalLink className="size-3.5" aria-hidden="true" />
									</Link>
									<Badge variant="outline">{reviewDomainLabel(item.reviewDomain, t)}</Badge>
									<span className="text-muted-foreground tabular-nums">
										{formatPlainDate(parsePlainDate(item.periodStart), locale, "dateMedium")}
									</span>
								</div>
								<p>{item.warning ? statutoryWarningText(item.warning, t, locale) : item.kind}</p>
								<p className="text-muted-foreground text-xs">{item.legalReference}</p>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
