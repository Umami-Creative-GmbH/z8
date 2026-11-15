import type { ComplianceCriticalEvent } from "@/lib/compliance-command-center/types";
import { Link } from "@/navigation";
import { renderComplianceText } from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

export function RecentCriticalEventsList({
	events,
	coverage,
	t,
}: {
	events: ComplianceCriticalEvent[];
	coverage: "available" | "partial" | "unavailable";
	t: Translate;
}) {
	return (
		<section
			aria-labelledby="compliance-events"
			className="space-y-3 rounded-xl border bg-card p-5"
		>
			<h2 id="compliance-events" className="text-lg font-semibold text-balance">
				{t(
					"compliance.commandCenter.recentEvents.title",
					"Recent Critical Events",
				)}
			</h2>
			{coverage !== "available" ? (
				<p className="text-sm text-muted-foreground">
					{coverage === "unavailable"
						? t(
								"compliance.commandCenter.recentEvents.unavailable",
								"Recent events could not be confirmed because the signal sources are unavailable.",
							)
						: t(
								"compliance.commandCenter.recentEvents.partial",
								"Recent events are limited to available sources. Some signals could not be loaded.",
							)}
				</p>
			) : null}
			{events.length === 0 && coverage === "available" ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"compliance.commandCenter.recentEvents.empty",
						"No recent critical events were detected.",
					)}
				</p>
			) : events.length > 0 ? (
				<ul className="divide-y">
					{events.map((event) => (
						<li key={event.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
							<p className="break-words font-medium">
								{renderComplianceText(t, event.title)}
							</p>
							<p className="break-words text-sm text-muted-foreground">
								{renderComplianceText(t, event.description)}
							</p>
							<Link
								className="inline-flex min-h-9 items-center rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
								href={event.primaryLink.href}
							>
								{renderComplianceText(t, event.primaryLink.label)}
							</Link>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
