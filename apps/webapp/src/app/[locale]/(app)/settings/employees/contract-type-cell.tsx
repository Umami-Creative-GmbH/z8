"use client";

import { IconCalendar, IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { EmployeeDirectoryRow } from "./employee-action-types";

/** Contract type is a category: a neutral badge told apart by its icon and label. */
export function ContractTypeCell({
	contractType,
}: {
	contractType: EmployeeDirectoryRow["contractType"];
}) {
	const { t } = useTranslate();
	if (contractType === null) return null;
	const isHourly = contractType === "hourly";
	const Icon = isHourly ? IconClock : IconCalendar;

	return (
		<Badge variant="outline" className="gap-1">
			<Icon className="size-3" aria-hidden="true" />
			{isHourly
				? t("settings.employees.directory.contract.hourly", "Hourly")
				: t("settings.employees.directory.contract.fixed", "Fixed")}
		</Badge>
	);
}
