import { IconActivity } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import type { SCIMManagedConnectionEventDTO } from "@/lib/scim/managed-control-plane";

const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

function getTimestampFormatter(locale: string) {
	let formatter = timestampFormatters.get(locale);
	if (!formatter) {
		formatter = Intl.DateTimeFormat(locale, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "UTC",
		});
		timestampFormatters.set(locale, formatter);
	}
	return formatter;
}

export function ScimEventsList({
	events,
	error,
}: {
	events: SCIMManagedConnectionEventDTO[];
	error: boolean;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const timestampFormatter = getTimestampFormatter(locale);
	if (error)
		return (
			<p
				role="status"
				className="rounded-lg border border-destructive/40 p-3 text-destructive text-sm"
			>
				{t(
					"settings.enterprise.identity.scim.events.error",
					"Events could not be loaded. Refresh status and try again.",
				)}
			</p>
		);
	if (!events.length)
		return (
			<p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
				{t(
					"settings.enterprise.identity.scim.events.empty",
					"No provisioning events have been recorded.",
				)}
			</p>
		);
	return (
		<ul className="divide-y rounded-lg border">
			{events.map((event) => (
				<li
					key={`${event.type}-${event.createdAt}`}
					className="flex min-w-0 gap-3 p-3 text-sm"
				>
					<IconActivity
						className="mt-0.5 size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<div className="min-w-0">
						<p className="break-words font-medium">{event.type}</p>
						<p className="text-muted-foreground text-xs">
							{timestampFormatter.format(new Date(event.createdAt))}
						</p>
					</div>
				</li>
			))}
		</ul>
	);
}
