"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { EmployeeDirectoryRow } from "./employee-action-types";

export function ContractTypeCell({
	contractType,
}: {
	contractType: EmployeeDirectoryRow["contractType"];
}) {
	const { t } = useTranslate();

	return (
		<Badge
			variant="outline"
			className={
				contractType === "hourly"
					? "border-orange-500 text-orange-600 dark:text-orange-400"
					: "border-purple-500 text-purple-600 dark:text-purple-400"
			}
		>
			{contractType === "hourly"
				? t("settings.employees.directory.contract.hourly", "Hourly")
				: t("settings.employees.directory.contract.fixed", "Fixed")}
		</Badge>
	);
}
