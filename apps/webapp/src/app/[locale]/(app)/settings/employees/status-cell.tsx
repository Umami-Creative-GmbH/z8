"use client";

import { useTranslate } from "@tolgee/react";
import { isMarkedFormer } from "@/components/former-employees/former-employee-ui";
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

	// A former employee is deactivated or past a due departure (#1438). The list
	// marks the latter; a deactivation made from this page shows at once.
	const isFormer = isMarkedFormer(employee);
	return (
		<Badge variant={isFormer ? "secondary" : "default"}>
			{isFormer
				? t("common:formerEmployees.former", "Former")
				: t("common:formerEmployees.current", "Current")}
		</Badge>
	);
}
