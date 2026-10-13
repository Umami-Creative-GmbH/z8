import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";
import { getTeamDrivingDetails } from "./driving-data";
import { DrivingDetailsList } from "./driving-details-list";

type TeamDrivingPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(params: Record<string, string | string[] | undefined>, name: string): string | null {
	const value = params[name];
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Driving details missing (#1127): the work of the viewer's employees that lacks its vehicle or
 * an odometer reading while vehicle use is expected of them. Owners and admins see everyone,
 * managers the employees they manage. Read-only; the employee or an admin completes the work.
 */
async function TeamDrivingContent({ searchParams }: TeamDrivingPageProps) {
	const [t, params] = await Promise.all([getTranslate(), searchParams]);
	const result = await getTeamDrivingDetails({
		teamId: param(params, "team"),
		employeeId: param(params, "employee"),
	});
	if (result.status === "forbidden") {
		return redirectWithLocale("/");
	}
	const { details, scope } = result;

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<header className="space-y-2 px-4 lg:px-6">
				<h1 className="text-pretty text-2xl font-semibold">
					{t("team.driving.title", "Driving details missing")}
				</h1>
				<p className="max-w-prose text-muted-foreground">
					{scope === "all"
						? t(
								"team.driving.descriptionAll",
								"Work periods that lack a vehicle or an odometer reading although vehicle use is expected. They stay listed until the details are completed.",
							)
						: t(
								"team.driving.descriptionManaged",
								"Work periods of the employees you manage that lack a vehicle or an odometer reading although vehicle use is expected. They stay listed until the details are completed.",
							)}
				</p>
			</header>
			<div className="px-4 lg:px-6">
				<DrivingDetailsList
					teams={details.teams}
					employees={details.employees}
					filters={details.filters}
					rows={details.rows}
					truncated={details.truncated}
				/>
			</div>
		</div>
	);
}

function TeamDrivingLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "team.driving.loading",
				labelDefault: "Loading driving details",
			}}
			className="@container/main flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-56" />
			<Skeleton aria-hidden="true" className="h-10 w-full max-w-md" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function TeamDrivingPage(props: TeamDrivingPageProps) {
	return (
		<Suspense fallback={<TeamDrivingLoading />}>
			<TeamDrivingContent {...props} />
		</Suspense>
	);
}
