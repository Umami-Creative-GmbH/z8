"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ProjectInfo } from "@/lib/reports/project-types";
import { ReportCustomFieldList } from "../report-custom-fields";

/**
 * The detailed project report's "Details" card (#820): the project's customer
 * and the project's and the customer's custom fields the reader sees, with
 * values as of the period's last day.
 */
export function ProjectReportDetails({ project }: { project: ProjectInfo }) {
	const { t } = useTranslate();
	const headingId = useId();
	const projectFields = project.customFields ?? [];
	const customerFields = project.customer?.customFields ?? [];
	return (
		<Card aria-labelledby={headingId}>
			<CardHeader>
				<h3 id={headingId} className="leading-none font-semibold">
					{t("reports.projects.details.title", "Details")}
				</h3>
			</CardHeader>
			<CardContent className="space-y-6">
				<dl className="grid gap-0.5">
					<dt className="text-sm text-muted-foreground">
						{t("reports.projects.details.customer", "Customer")}
					</dt>
					<dd className="text-sm font-medium">
						{project.customer?.name ?? t("reports.projects.details.noCustomer", "No customer")}
					</dd>
				</dl>
				{projectFields.length > 0 && (
					<section className="space-y-3">
						<h4 className="text-sm font-semibold">
							{t("reports.projects.details.projectFields", "Project fields")}
						</h4>
						<ReportCustomFieldList fields={projectFields} />
					</section>
				)}
				{customerFields.length > 0 && (
					<section className="space-y-3">
						<h4 className="text-sm font-semibold">
							{t("reports.projects.details.customerFields", "Customer fields")}
						</h4>
						<ReportCustomFieldList fields={customerFields} />
					</section>
				)}
			</CardContent>
		</Card>
	);
}
