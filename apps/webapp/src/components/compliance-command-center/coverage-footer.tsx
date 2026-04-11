import { DateTime } from "luxon";

export function CoverageFooter({ notes, refreshedAt }: { notes: string[]; refreshedAt: string }) {
	return (
		<section className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
			<p>Last refreshed: {DateTime.fromISO(refreshedAt).toLocaleString(DateTime.DATETIME_MED)}</p>
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
