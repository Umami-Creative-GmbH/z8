"use client";

import { useTranslate } from "@tolgee/react";
import {
	FormerEmployeeBadge,
	isMarkedFormer,
} from "@/components/former-employees/former-employee-ui";
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
	// marks the latter and says since when (#1439); a deactivation made from this
	// page shows at once, without a date until the list reloads.
	if (isMarkedFormer(employee)) {
		return <FormerEmployeeBadge since={employee.formerSince} />;
	}
	return <Badge variant="default">{t("common:formerEmployees.current", "Current")}</Badge>;
}
