"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getMonthCloseWarningsAction } from "@/app/[locale]/(app)/settings/closed-months/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryKeys } from "@/lib/query/keys";
import type { CloseMonthWarning } from "@/lib/time-tracking/closed-months/close-warnings";
import type { CloseMonthScope } from "@/lib/time-tracking/closed-months/store";

/** Warnings shown before the list is shortened. */
const LISTED_WARNINGS = 10;

/**
 * Before closing (#1065): missing or unapproved period submissions about the month for the
 * chosen scope. A warning only; the close is not refused for them.
 */
export function CloseMonthWarnings({
	month,
	scope,
}: {
	month: string | null;
	scope: CloseMonthScope;
}) {
	const scopeKey = scope.kind === "team" ? scope.teamId : scope.kind;
	const { data } = useQuery({
		queryKey: queryKeys.closedMonths.closeWarnings(month ?? "", scopeKey),
		queryFn: async () => {
			if (!month) return [];
			const result = await getMonthCloseWarningsAction({ month, scope });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: month !== null,
	});
	return <CloseMonthWarningList warnings={data ?? []} />;
}

export function CloseMonthWarningList({ warnings }: { warnings: readonly CloseMonthWarning[] }) {
	const { t } = useTranslate();
	if (warnings.length === 0) return null;

	const describe = (warning: CloseMonthWarning) => {
		const range = { startDate: warning.startDate, endDate: warning.endDate };
		switch (warning.status) {
			case "awaiting_submission":
				return t(
					"settings.closedMonths.warning.periodNotSubmitted",
					"period {startDate} – {endDate} not submitted",
					range,
				);
			case "rejected":
				return t(
					"settings.closedMonths.warning.periodRejected",
					"period {startDate} – {endDate} rejected",
					range,
				);
			case "sent_back_after_change":
				return t(
					"settings.closedMonths.warning.periodSentBack",
					"period {startDate} – {endDate} sent back after a change",
					range,
				);
		}
	};
	const listed = warnings.slice(0, LISTED_WARNINGS);
	const more = warnings.length - listed.length;

	return (
		<Alert role="status" className="border-amber-300 dark:border-amber-700">
			<IconAlertTriangle aria-hidden="true" className="text-amber-600" />
			<AlertTitle>
				{t(
					"settings.closedMonths.warnings.title",
					"Not every period submission for this month is approved. This does not stop the close:",
				)}
			</AlertTitle>
			<AlertDescription>
				<ul className="list-disc space-y-1 ps-5">
					{listed.map((warning) => (
						<li
							key={`${warning.employeeId}:${warning.startDate}`}
							className="break-words"
						>
							{warning.employeeName}
							{": "}
							{describe(warning)}
						</li>
					))}
				</ul>
				{more > 0 ? (
					<p>{t("settings.closedMonths.warnings.more", "and {count} more", { count: more })}</p>
				) : null}
			</AlertDescription>
		</Alert>
	);
}
