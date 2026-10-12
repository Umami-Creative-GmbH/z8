import { IconChevronRight, IconMapPin } from "@tabler/icons-react";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { getWhoIsInLocations } from "./presence-data";

async function WhoIsInPageContent() {
	const [t, result] = await Promise.all([getTranslate(), getWhoIsInLocations()]);

	if (result.status === "forbidden") {
		return redirectWithLocale("/");
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-pretty text-2xl font-semibold">
					{t("team.presence.title", "Who is in")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"team.presence.description",
						"Choose a location to see who is clocked in or on a break there.",
					)}
				</p>
			</div>
			<div className="px-4 lg:px-6">
				{result.locations.length === 0 ? (
					<div className="rounded-lg border bg-card p-6 text-center text-muted-foreground text-sm">
						{t("team.presence.noLocations", "Your organization has no active locations yet.")}
					</div>
				) : (
					<ul className="divide-y overflow-hidden rounded-lg border bg-card">
						{result.locations.map((location) => (
							<li key={location.id}>
								<Link
									href={`/team/presence/${location.id}`}
									className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
								>
									<IconMapPin className="size-4 text-muted-foreground" aria-hidden="true" />
									<span className="flex-1 font-medium">{location.name}</span>
									<IconChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function WhoIsInPageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="space-y-2 px-4 lg:px-6">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-5 w-full max-w-xl" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton className="h-48 w-full" />
			</div>
		</div>
	);
}

export default function WhoIsInPage() {
	return (
		<Suspense fallback={<WhoIsInPageLoading />}>
			<WhoIsInPageContent />
		</Suspense>
	);
}
