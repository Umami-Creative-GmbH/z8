"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import type { EmployeeDirectoryRow } from "./employee-action-types";

export function ViewDetailsCell({ employee }: { employee: EmployeeDirectoryRow }) {
	const { t } = useTranslate();
	const href =
		employee.kind === "invitationDraft"
			? `/settings/employees/${employee.encodedId}`
			: `/settings/employees/${employee.id}`;

	return (
		<div className="text-right">
			<Button variant="ghost" size="sm" asChild>
				<Link href={href}>
					{t("settings.employees.directory.actions.viewDetails", "View Details")}
				</Link>
			</Button>
		</div>
	);
}
