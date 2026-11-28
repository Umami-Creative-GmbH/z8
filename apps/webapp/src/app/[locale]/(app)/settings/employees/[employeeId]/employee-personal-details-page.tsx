"use client";

import { useTranslate } from "@tolgee/react";
import { PersonalDetailsCard } from "@/components/settings/personal-details/personal-details-card";
import { PageHeader } from "@/components/ui/page-header";
import type { PersonalDetailsView } from "@/lib/organization/personal-details/types";

/**
 * The employee page for a viewer whose only right to this employee is deciding
 * their personal details (#2071): a payroll access holder without settings access
 * to the employee record sees the personal details card and nothing else of it.
 */
export function EmployeePersonalDetailsPage({
	organizationId,
	employeeName,
	view,
}: {
	organizationId: string;
	/** The employee's display name; empty when none is on record. */
	employeeName: string;
	view: PersonalDetailsView;
}) {
	const { t } = useTranslate();
	const title = t("settings.personalDetails.title", "Personal details");
	return (
		<div className="page-frame flex flex-col gap-6">
			<PageHeader
				title={employeeName.trim() || title}
				description={t(
					"settings.personalDetails.pageDescription",
					"The bank account on file for this employee. The employee is told about every change.",
				)}
			/>
			<PersonalDetailsCard key={`${organizationId}:${view.employeeId}`} view={view} />
		</div>
	);
}
