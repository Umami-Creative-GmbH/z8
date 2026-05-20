import { DateTime } from "luxon";
import type { ComplianceText } from "@/lib/compliance-command-center/types";
import { renderComplianceText } from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

export function CoverageFooter({
	notes,
	refreshedAt,
	t,
}: {
	notes: ComplianceText[];
	refreshedAt: string;
	t: Translate;
}) {
	const refreshedLabel = DateTime.fromISO(refreshedAt, { zone: "utc" }).toFormat(
		"yyyy-LL-dd HH:mm 'UTC'",
	);

	return (
		<section className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
			<p>
				{t("compliance.commandCenter.footer.lastRefreshed", "Last refreshed: {time}", {
					time: refreshedLabel,
				})}
			</p>
			<time className="sr-only" dateTime={refreshedAt}>
				{refreshedLabel}
			</time>
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
