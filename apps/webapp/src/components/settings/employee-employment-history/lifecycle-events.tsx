"use client";

import {
	IconAlertTriangle,
	IconLoader2,
	IconPlayerPause,
	IconPlayerPlay,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { listEmployeeLifecycleHistoryAction } from "@/app/[locale]/(app)/settings/employees/employee-reactivation.actions";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-description";
import { Button } from "@/components/ui/button";
import { formatDepartureCutoff } from "@/lib/employee-lifecycle/cutoff-display";
import { queryKeys } from "@/lib/query/keys";

/**
 * Deactivations and reactivations in the employment history (#1441), in the
 * organization's time zone. Older ones come from their surviving audit entries.
 * Renders nothing when there are none, and says so when they could not be loaded.
 */
export function EmploymentLifecycleEvents({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const query = useQuery({
		queryKey: queryKeys.employees.lifecycleHistory(employeeId),
		queryFn: async () => {
			const result = await listEmployeeLifecycleHistoryAction(employeeId);
			if (!result.success) throw new Error("lifecycle_history_load_failed");
			return result.data;
		},
	});

	if (query.isError) {
		return (
			<Alert variant="destructive" role="alert">
				<IconAlertTriangle aria-hidden="true" />
				<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
					<span>
						{t(
							"settings.employmentHistory.lifecycleEvents.loadError",
							"Deactivations and reactivations could not be loaded.",
						)}
					</span>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => void query.refetch()}
						disabled={query.isFetching}
					>
						{query.isFetching && <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />}
						{t("settings.employmentHistory.lifecycleEvents.retry", "Try again")}
					</Button>
				</AlertDescription>
			</Alert>
		);
	}
	const history = query.data;
	if (!history || history.events.length === 0) return null;

	return (
		<section className="space-y-3" aria-labelledby={`lifecycle-events-${employeeId}`}>
			<div id={`lifecycle-events-${employeeId}`} className="text-sm font-medium">
				{t("settings.employmentHistory.lifecycleEvents.title", "Deactivations and reactivations")}
			</div>
			<ul className="space-y-2">
				{history.events.map((event) => {
					const at = formatDepartureCutoff(event.at, history.timeZone, locale);
					return (
						<li
							key={`${event.kind}:${event.at}`}
							className="flex items-center gap-2 rounded-lg border p-3 text-sm"
						>
							{event.kind === "deactivated" ? (
								<IconPlayerPause aria-hidden="true" className="size-4 text-muted-foreground" />
							) : (
								<IconPlayerPlay aria-hidden="true" className="size-4 text-muted-foreground" />
							)}
							<span>
								{event.kind === "deactivated"
									? t(
											"settings.employmentHistory.lifecycleEvents.deactivatedOn",
											"Deactivated on {date}",
											{ date: at },
										)
									: t(
											"settings.employmentHistory.lifecycleEvents.reactivatedOn",
											"Reactivated on {date}",
											{ date: at },
										)}
							</span>
						</li>
					);
				})}
			</ul>
			<p className="text-xs text-muted-foreground">
				{t("settings.employmentHistory.lifecycleEvents.timeZone", "Times in {timezone}.", {
					timezone: history.timeZone,
				})}
			</p>
		</section>
	);
}
