import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { systemClock } from "@/lib/datetime/temporal-core";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { formatPresenceSince } from "@/lib/time-tracking/who-is-in/format";
import { getRenderUserPreferences } from "@/lib/user-preferences/render-snapshot";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { LocationPresenceList, type LocationPresenceRow } from "../location-presence-list";
import { getLocationPresence } from "../presence-data";

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
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="space-y-2 px-4 lg:px-6">
				<Link
					href="/team/presence"
					className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				>
					<IconArrowLeft className="size-4" aria-hidden="true" />
					{t("team.presence.allLocations", "All locations")}
				</Link>
				<h1 className="text-pretty text-2xl font-semibold">
					{t("team.presence.locationTitle", "Who is in: {location}", {
						location: result.location.name,
					})}
				</h1>
				<p className="text-muted-foreground">
					{result.viewer.scope.kind === "all"
						? t(
								"team.presence.descriptionAll",
								"Employees assigned to this location who are clocked in or on a break.",
							)
						: t(
								"team.presence.descriptionManaged",
								"Employees you manage who are assigned to this location and clocked in or on a break.",
							)}
				</p>
			</div>
			<div className="px-4 lg:px-6">
				<LocationPresenceList rows={rows} />
			</div>
		</div>
	);
}

function LocationPresencePageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="space-y-2 px-4 lg:px-6">
				<Skeleton className="h-4 w-28" />
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-5 w-full max-w-xl" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function LocationPresencePage({ params }: LocationPresencePageProps) {
	return (
		<Suspense fallback={<LocationPresencePageLoading />}>
			<LocationPresencePageContent params={params} />
		</Suspense>
	);
}
