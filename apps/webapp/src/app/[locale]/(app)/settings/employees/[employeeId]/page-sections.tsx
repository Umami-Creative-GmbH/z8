"use client";

import { IconArrowBack } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import type { Translate } from "./employee-section-shared";

export { EmployeeEditFormCard } from "./employee-edit-form-card";
export { EmployeeOverviewCard } from "./employee-overview-card";

export function EmployeeDetailHeader({
	t,
	actions,
}: {
	t: Translate;
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						asChild
						aria-label={t(
							"settings.employees.detailView.backToEmployeeList",
							"Back to employee list",
						)}
					>
						<Link href="/settings/employees">
							<IconArrowBack className="size-4" aria-hidden="true" />
						</Link>
					</Button>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.employees.detailsTitle", "Employee Details")}
					</h1>
				</div>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.employees.detailsDescription",
						"View and edit employee information",
					)}
				</p>
			</div>
			{actions && (
				<div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
					{actions}
				</div>
			)}
		</div>
	);
}
