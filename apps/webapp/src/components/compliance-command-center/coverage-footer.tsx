import { DateTime } from "luxon";

export function CoverageFooter({ notes, refreshedAt }: { notes: string[]; refreshedAt: string }) {
	const refreshedLabel = DateTime.fromISO(refreshedAt, { zone: "utc" }).toFormat(
		"yyyy-LL-dd HH:mm 'UTC'",
	);

	return (
		<section className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
			<p>
				Last refreshed: <time dateTime={refreshedAt}>{refreshedLabel}</time>
			</p>
			<ul className="space-y-1">
				{notes.map((note) => (
					<li className="break-words" key={note}>
						{note}
					</li>
				))}
			</ul>
		</section>
	);
}
