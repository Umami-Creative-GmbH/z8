import { IconActivity } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { SCIMManagedConnectionEventDTO } from "@/lib/scim/managed-control-plane";

export function ScimEventsList({ events, error }: { events: SCIMManagedConnectionEventDTO[]; error: boolean }) {
	const { t } = useTranslate();
	if (error) return <p role="status" className="rounded-lg border border-destructive/40 p-3 text-destructive text-sm">{t("settings.enterprise.identity.scim.events.error", "Events could not be loaded. Refresh status and try again.")}</p>;
	if (!events.length) return <p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">{t("settings.enterprise.identity.scim.events.empty", "No provisioning events have been recorded.")}</p>;
	return <ul className="divide-y rounded-lg border">{events.map((event) => <li key={`${event.type}-${event.createdAt}`} className="flex min-w-0 gap-3 p-3 text-sm"><IconActivity className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><p className="break-words font-medium">{event.type}</p><p className="text-muted-foreground text-xs">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</p></div></li>)}</ul>;
}
