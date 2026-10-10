"use client";

import { IconAlertTriangle, IconLock } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getMonthCloseContext,
	getMonthClosureStatuses,
} from "@/app/[locale]/(app)/settings/closed-months/actions";
import { CloseMonthPanel } from "@/components/settings/closed-months/close-month-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import { ClosureStatusBadge } from "./closure-status-badge";

const STATUS_KEY = ["closed-months", "statuses"] as const;

/**
 * The payroll export's warning (#762): the chosen range contains months that
 * are not closed for the selection, so their work can still change after the
 * export. Users allowed to close are offered "Close this month". Closing never
 * requires an export, and an export never closes a month.
 */
export function UnclosedMonthsNotice({
	months,
	employeeIds,
}: {
	months: readonly string[];
	employeeIds?: readonly string[];
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const queryClient = useQueryClient();
	const [closing, setClosing] = useState<string | null>(null);
	const { data: statuses } = useQuery({
		queryKey: [...STATUS_KEY, months, employeeIds ?? null],
		queryFn: async () => {
			const result = await getMonthClosureStatuses({
				months: [...months],
				employeeIds: employeeIds ? [...employeeIds] : undefined,
			});
			return result.success ? result.data : [];
		},
		enabled: months.length > 0,
		staleTime: 30_000,
	});
	const { data: context } = useQuery({
		queryKey: ["closed-months", "close-context"],
		queryFn: async () => {
			const result = await getMonthCloseContext();
			return result.success ? result.data : { canClose: false, teams: [] };
		},
		staleTime: 5 * 60_000,
	});
	const unclosed = (statuses ?? []).filter(
		(status) => status.state !== "closed" && status.employees > 0,
	);
	if (unclosed.length === 0) return null;

	return (
		<>
			<Alert>
				<IconAlertTriangle className="size-4" aria-hidden="true" />
				<AlertTitle>
					{t("common:closedMonths.unclosedTitle", "Not every month in this range is closed")}
				</AlertTitle>
				<AlertDescription className="space-y-3">
					<p>
						{t(
							"common:closedMonths.unclosedDescription",
							"Work and absences in these months can still change after the export. Close a month once its payroll is final.",
						)}
					</p>
					<ul className="space-y-2">
						{unclosed.map((status) => (
							<li key={status.month} className="flex flex-wrap items-center gap-2">
								<span className="tabular-nums">{formatClosedMonthLabel(status.month, locale)}</span>
								<ClosureStatusBadge status={status} />
								{context?.canClose ? (
									<Button size="sm" variant="outline" onClick={() => setClosing(status.month)}>
										<IconLock className="size-4" aria-hidden="true" />
										{t("common:closedMonths.closeThisMonth", "Close this month")}
									</Button>
								) : null}
							</li>
						))}
					</ul>
				</AlertDescription>
			</Alert>
			{context?.canClose ? (
				<CloseMonthPanel
					open={closing !== null}
					month={closing}
					teams={context.teams}
					onOpenChange={(open) => !open && setClosing(null)}
					onClosed={() => void queryClient.invalidateQueries({ queryKey: STATUS_KEY })}
				/>
			) : null}
		</>
	);
}
