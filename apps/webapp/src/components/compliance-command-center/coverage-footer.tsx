import type { ReactNode } from "react";
import type { ComplianceText } from "@/lib/compliance-command-center/types";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { renderComplianceText } from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

function formatRefreshedUtc(refreshedAt: string): string {
	try {
		const zoned = parseInstant(refreshedAt).toZonedDateTimeISO("UTC");
		const hours = String(zoned.hour).padStart(2, "0");
		const minutes = String(zoned.minute).padStart(2, "0");
		return `${zoned.toPlainDate().toString()} ${hours}:${minutes} UTC`;
	} catch {
		return refreshedAt;
	}
}

export function CoverageFooter({
	notes,
	refreshedAt,
	t,
	children,
}: {
	notes: ComplianceText[];
	refreshedAt: string;
	t: Translate;
	children?: ReactNode;
}) {
	const refreshedLabel = formatRefreshedUtc(refreshedAt);

	return (
		<section
			aria-labelledby="compliance-coverage"
			className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground"
		>
			<h2 id="compliance-coverage" className="text-lg font-semibold text-foreground text-balance">
				{t("compliance.commandCenter.coverage.title", "Coverage")}
			</h2>
			{children}
			<p>
				{t("compliance.commandCenter.footer.lastRefreshed", "Last refreshed: {time}", {
					time: refreshedLabel,
				})}
			</p>
			<time className="sr-only" dateTime={refreshedAt}>
				{refreshedLabel}
			</time>
			<p>
				{t(
					"compliance.commandCenter.footer.refreshMeaning",
					"Refresh reloads recorded signals; it does not reevaluate findings under a new policy.",
				)}
			</p>
			<ul className="space-y-1">
				{notes.map((note) => (
					<li className="break-words" key={typeof note === "string" ? note : note.key}>
						{renderComplianceText(t, note)}
					</li>
				))}
			</ul>
		</section>
	);
}
