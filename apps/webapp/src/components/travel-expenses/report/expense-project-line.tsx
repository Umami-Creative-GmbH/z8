"use client";

import { IconBriefcase, IconShieldCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { TravelExpenseReportProjectAttribution } from "@/lib/approvals/evidence/travel-expense-report-facts";
import { formatPlainDateRange } from "./format";

export type ExpenseProjectSummary = Pick<
	TravelExpenseReportProjectAttribution,
	"name" | "customerName" | "inheritedFromTrip" | "basis" | "exception"
>;

/**
 * The project an expense was submitted under (#605), with the names frozen at
 * submission. An attribution exception is shown conspicuously with its reason
 * and evidence, so every reader sees that captured history did not prove it.
 */
export function ExpenseProjectLine({ project }: { project: ExpenseProjectSummary }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<div className="mt-1 space-y-1 text-sm">
			<p className="flex flex-wrap items-center gap-2">
				<IconBriefcase aria-hidden="true" className="size-4 text-muted-foreground" />
				<span>
					{project.name}
					{project.customerName ? ` · ${project.customerName}` : ""}
				</span>
				{project.inheritedFromTrip && (
					<span className="text-muted-foreground">
						{t("travelExpenses.report.project.fromTrip", "(trip project)")}
					</span>
				)}
				{project.basis === "exception" && (
					<Badge variant="outline" className="gap-1">
						<IconShieldCheck aria-hidden="true" className="size-3.5" />
						{t("travelExpenses.report.project.exceptionBadge", "Attribution exception")}
					</Badge>
				)}
			</p>
			{project.exception && (
				<dl className="grid gap-x-3 gap-y-0.5 pl-6 text-muted-foreground sm:grid-cols-[auto_1fr]">
					<dt>{t("travelExpenses.report.project.exceptionDates", "Covers")}</dt>
					<dd>
						{formatPlainDateRange(locale, project.exception.validFrom, project.exception.validTo)}
					</dd>
					<dt>{t("travelExpenses.report.project.exceptionReason", "Reason")}</dt>
					<dd className="break-words">{project.exception.reason}</dd>
					<dt>{t("travelExpenses.report.project.exceptionEvidence", "Evidence")}</dt>
					<dd className="break-words">{project.exception.evidence}</dd>
				</dl>
			)}
		</div>
	);
}
