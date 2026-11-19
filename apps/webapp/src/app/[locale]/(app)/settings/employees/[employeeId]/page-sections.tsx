"use client";

import { IconArrowBack } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Link } from "@/navigation";
import type { Translate } from "./employee-section-shared";

export { EmployeeEditFormCard } from "./employee-edit-form-card";
export { EmployeeOverviewCard } from "./employee-overview-card";

/**
 * The employee detail heading. The page title is the employee's name; while it
 * is loading or missing, the generic "Employee Details" title stands in.
 */
export function EmployeeDetailHeader({
	t,
	employeeName,
	actions,
}: {
	t: Translate;
	/** The employee's display name, once known. */
	employeeName?: string | null;
	actions?: ReactNode;
}) {
	const detailsTitle = t("settings.employees.detailsTitle", "Employee Details");
	const name = employeeName?.trim();
	return (
		<PageHeader
			scope={
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<Link
						href="/settings/employees"
						className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<IconArrowBack className="size-4" aria-hidden="true" />
						{t(
							"settings.employees.detailView.backToEmployeeList",
							"Back to employee list",
						)}
					</Link>
					{name ? (
						<>
							<span aria-hidden="true">·</span>
							<span>{detailsTitle}</span>
						</>
					) : null}
				</span>
			}
			title={name || detailsTitle}
			description={t(
				"settings.employees.detailsDescription",
				"View and edit employee information",
			)}
			actions={actions}
		/>
	);
}
