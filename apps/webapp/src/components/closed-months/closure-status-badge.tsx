"use client";

import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { MonthClosureStatus } from "@/lib/time-tracking/closed-months/store";

/** Closed, partly closed or open, for one month and the current selection (#762). */
export function ClosureStatusBadge({
	status,
}: {
	status: Pick<MonthClosureStatus, "state" | "closedEmployees" | "employees">;
}) {
	const { t } = useTranslate();
	switch (status.state) {
		case "closed":
			return (
				<Badge variant="secondary">
					<IconLock aria-hidden="true" />
					{t("common:closedMonths.status.closed", "Closed")}
				</Badge>
			);
		case "partly_closed":
			return (
				<Badge variant="outline">
					<IconLock aria-hidden="true" />
					{t("common:closedMonths.status.partlyClosed", "Partly closed ({closed} of {total})", {
						closed: status.closedEmployees,
						total: status.employees,
					})}
				</Badge>
			);
		default:
			return (
				<Badge variant="outline" className="text-muted-foreground">
					<IconLockOpen aria-hidden="true" />
					{t("common:closedMonths.status.open", "Open")}
				</Badge>
			);
	}
}
