"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useApprovalInboxText } from "@/components/approvals/use-approval-inbox-text";
import type { ApprovalInboxTriage } from "@/lib/approvals/inbox/types";

/** The same complete explanation in list, detail, sprint and fast lanes. */
export function ApprovalTriageReasons({
	triage,
}: {
	triage: ApprovalInboxTriage;
}) {
	const text = useApprovalInboxText();
	const { t } = useTranslate();
	const locale = useLocale();
	const numberFormat = new Intl.NumberFormat(locale, {
		maximumFractionDigits: 9,
	});
	const labels: Record<string, string> = {
		available: t("approvals:triage.facts.available", "Available"),
		required: t("approvals:triage.facts.required", "Required"),
		evidenceValidity: t(
			"approvals:triage.facts.evidenceValidity",
			"Evidence validity",
		),
		limitation: t("approvals:triage.facts.limitation", "Evidence limitation"),
		staffCount: t("approvals:triage.facts.staffCount", "Available staff"),
		minimumStaffCount: t(
			"approvals:triage.facts.minimumStaffCount",
			"Required staff",
		),
		subareaName: t("approvals:triage.facts.subareaName", "Staffing area"),
	};
	const factValue = (
		key: string,
		value: string | number | boolean | null,
	): string => {
		if (typeof value === "number") return numberFormat.format(value);
		if (typeof value === "boolean")
			return value
				? t("approvals:triage.facts.yes", "Yes")
				: t("approvals:triage.facts.no", "No");
		if (
			typeof value === "string" &&
			["date", "startDate", "endDate"].includes(key) &&
			/^\d{4}-\d{2}-\d{2}$/.test(value)
		)
			return text({ kind: "plain_date", date: value });
		return String(value).replaceAll("_", " ");
	};
	if (!triage.reasons?.length) return <span>{triage.explanation}</span>;
	return (
		<ul className="space-y-1 break-words text-muted-foreground text-xs leading-5">
			{triage.reasons.map((reason) => (
				<li key={reason.code}>
					<span>{text(reason.text)}</span>
					{(reason.supportingFacts ?? (reason.facts ? [reason.facts] : [])).map(
						(facts) => (
							<ul className="pl-3" key={JSON.stringify(facts)}>
								{Object.entries(facts)
									.filter(([, value]) => value !== null)
									.map(([key, value]) => {
										const words = key
											.replace(/([a-z])([A-Z])/g, "$1 $2")
											.replaceAll("_", " ");
										const label =
											labels[key] ??
											words.charAt(0).toUpperCase() + words.slice(1);
										return (
											<li key={key}>
												{t(
													"approvals:triage.supportingFact",
													"{label}: {value}",
													{ label, value: factValue(key, value) },
												)}
											</li>
										);
									})}
							</ul>
						),
					)}
				</li>
			))}
		</ul>
	);
}
