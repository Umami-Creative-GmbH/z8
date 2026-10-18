"use client";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { useApprovalInboxText } from "@/components/approvals/use-approval-inbox-text";
import {
	presentTriageFacts,
	presentTriageReasonText,
} from "@/lib/approvals/inbox/triage-fact-presentation";
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
	const numberFormat = useMemo(
		() => new Intl.NumberFormat(locale, { maximumFractionDigits: 9 }),
		[locale],
	);
	if (!triage.reasons?.length) return <span>{triage.explanation}</span>;
	return (
		<ul className="space-y-1 break-words text-muted-foreground text-xs leading-5">
			{triage.reasons.map((reason) => (
				<li key={reason.code}>
					<span>{text(presentTriageReasonText(reason))}</span>
					{(reason.supportingFacts ?? (reason.facts ? [reason.facts] : [])).map(
						(facts) => {
							const rows = presentTriageFacts(
								facts,
								reason.code,
								locale,
								numberFormat,
								text,
							);
							return rows.length ? (
								<ul className="pl-3" key={JSON.stringify(facts)}>
									{rows.map((row) => (
										<li key={row.key}>
											{t(
												"approvals:triage.supportingFact",
												"{label}: {value}",
												row,
											)}
										</li>
									))}
								</ul>
							) : null;
						},
					)}
				</li>
			))}
		</ul>
	);
}
