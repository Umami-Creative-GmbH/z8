"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { EmployeeDirectoryRow } from "./employee-action-types";

export function StatusCell({ employee }: { employee: EmployeeDirectoryRow }) {
	const { t } = useTranslate();

	if (employee.kind === "invitationDraft") {
		return (
			<div className="flex flex-wrap gap-1">
				<Badge variant="secondary">
					{t("settings.employees.directory.statuses.draft", "Draft")}
				</Badge>
				<Badge variant="outline">{employee.invitationStatus}</Badge>
			</div>
		);
	}

	return (
		<Badge variant={employee.isActive ? "default" : "secondary"}>
			{employee.isActive
				? t("settings.employees.directory.statuses.active", "Active")
				: t("settings.employees.directory.statuses.inactive", "Inactive")}
		</Badge>
	);
}
