import type { ComplianceCriticalEvent } from "@/lib/compliance-command-center/types";
import { Link } from "@/navigation";
import { renderComplianceText } from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

export function RecentCriticalEventsList({
	events,
	t,
}: {
	events: ComplianceCriticalEvent[];
	t: Translate;
}) {
	return (
		<section className="space-y-3 rounded-xl border bg-card p-5">
			<h2 className="text-lg font-semibold text-balance">
				{t("compliance.commandCenter.recentEvents.title", "Recent Critical Events")}
			</h2>
			{events.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"compliance.commandCenter.recentEvents.empty",
						"No recent critical events were detected.",
					)}
				</p>
			) : (
				<ul className="space-y-3">
					{events.map((event) => (
						<li key={event.id} className="rounded-lg border p-3">
							<p className="break-words font-medium">{renderComplianceText(t, event.title)}</p>
							<p className="break-words text-sm text-muted-foreground">
								{renderComplianceText(t, event.description)}
							</p>
							<Link
								className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
								href={event.primaryLink.href}
							>
								{renderComplianceText(t, event.primaryLink.label)}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
