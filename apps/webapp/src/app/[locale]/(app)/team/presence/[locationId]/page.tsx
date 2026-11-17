import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { systemClock } from "@/lib/datetime/temporal-core";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { formatPresenceSince } from "@/lib/time-tracking/who-is-in/format";
import { getRenderUserPreferences } from "@/lib/user-preferences/render-snapshot";
import { getTranslate } from "@/tolgee/server";
import { LocationPresenceList, type LocationPresenceRow } from "../location-presence-list";
import { getLocationPresence } from "../presence-data";
import { AllLocationsLink } from "./all-locations-link";
import { LocationPresenceLoading } from "./location-presence-loading";

interface LocationPresencePageProps {
	params: Promise<{ locale: string; locationId: string }>;
}

async function LocationPresencePageContent({ params }: LocationPresencePageProps) {
	const [{ locale, locationId }, t] = await Promise.all([params, getTranslate()]);
	const result = await getLocationPresence(locationId);

	if (result.status === "forbidden") {
		return redirectWithLocale("/");
	}
	if (result.status === "not_found") {
		notFound();
	}

	const { timeFormat } = await getRenderUserPreferences(result.viewer.userId);
	const now = systemClock.nowInstant();
	const rows: LocationPresenceRow[] = result.entries.map((entry) => ({
		employeeId: entry.employeeId,
		name: entry.name,
		state: entry.state,
		sinceText: formatPresenceSince(entry.since, entry.sinceZone, { locale, timeFormat, now }),
	}));

	return (
		<div className="@container/main mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
			<PageHeader
				scope={<AllLocationsLink />}
				title={t("team.presence.locationTitle", "Who is in: {location}", {
					location: result.location.name,
				})}
				description={
					result.viewer.scope.kind === "all"
						? t(
								"team.presence.descriptionAll",
								"Employees assigned to this location who are clocked in or on a break.",
							)
						: t(
								"team.presence.descriptionManaged",
								"Employees you manage who are assigned to this location and clocked in or on a break.",
							)
				}
			/>
			<section aria-label={t("team.presence.title", "Who is in")} className="min-w-0 space-y-3">
				<LocationPresenceList rows={rows} />
				<p className="max-w-3xl text-pretty text-sm text-muted-foreground">
					{t(
						"team.presence.assignmentContext",
						"Location assignment is not evidence of device position. Times use the zone captured when work or the break began. Presence refreshes every minute.",
					)}
				</p>
			</section>
		</div>
	);
}

export default function LocationPresencePage({ params }: LocationPresencePageProps) {
	return (
		<Suspense fallback={<LocationPresenceLoading />}>
			<LocationPresencePageContent params={params} />
		</Suspense>
	);
}
