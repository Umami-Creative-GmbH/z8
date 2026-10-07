"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";

/** What an allowance expense still needs, or that its malformed fields come first. */
export function ItemRequirementsSection<Requirement extends string>({
	headingId,
	missing,
	label,
}: {
	headingId: string;
	/** The open requirements; null while any entered value is malformed. */
	missing: readonly Requirement[] | null;
	label: (requirement: Requirement) => ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<section aria-labelledby={headingId} className="space-y-2 rounded-lg border p-4">
			<h3 id={headingId} className="text-base font-semibold">
				{t("travelExpenses.report.requirements.title", "Still needed")}
			</h3>
			{missing === null ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.requirements.fixFields",
						"Correct the highlighted fields first.",
					)}
				</p>
			) : missing.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.requirements.complete",
						"Everything for this expense is entered.",
					)}
				</p>
			) : (
				<ul className="list-disc space-y-1 pl-5 text-sm">
					{missing.map((requirement) => (
						<li key={requirement}>{label(requirement)}</li>
					))}
				</ul>
			)}
		</section>
	);
}
