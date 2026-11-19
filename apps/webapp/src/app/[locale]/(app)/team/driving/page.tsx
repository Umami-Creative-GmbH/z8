import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { drivingDetailsTeamScope } from "@/lib/time-tracking/vehicle-use/driving-details-team-store";
import { getTranslate } from "@/tolgee/server";
import { DrivingDetailsController } from "./driving-details-controller";

type TeamDrivingPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};
function param(params: Record<string, string | string[] | undefined>, name: string): string | null {
	const value = params[name];
	return typeof value === "string" && value.length > 0 ? value : null;
}
async function TeamDrivingContent({ searchParams }: TeamDrivingPageProps) {
	const [t, params, context] = await Promise.all([
		getTranslate(),
		searchParams,
		getCurrentSettingsRouteContext(),
	]);
	const organizationId = context?.authContext.session.activeOrganizationId;
	const scope =
		context && organizationId
			? drivingDetailsTeamScope({
					accessTier: context.accessTier,
					organizationId,
					employee: context.authContext.employee ?? null,
				})
			: null;
	if (!scope) return redirectWithLocale("/");
	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("team.driving.title", "Driving details missing")}
				scope={
					scope.kind === "all"
						? t("team.driving.scopeAll", "All employees in this organization")
						: t("team.driving.scopeManaged", "Employees you manage")
				}
				description={
					scope.kind === "all"
						? t(
								"team.driving.descriptionAll",
								"Work periods that lack a vehicle or an odometer reading although vehicle use is expected. They stay listed until the details are completed.",
							)
						: t(
								"team.driving.descriptionManaged",
								"Work periods of the employees you manage that lack a vehicle or an odometer reading although vehicle use is expected. They stay listed until the details are completed.",
							)
				}
			/>
			<DrivingDetailsController
				filters={{ teamId: param(params, "team"), employeeId: param(params, "employee") }}
			/>
			<p className="max-w-prose text-sm text-muted-foreground">
				{t(
					"team.driving.guidance",
					"Open an employee’s calendar to complete work-period attribution. Missing details do not block clocking and do not establish driving authorization.",
				)}
			</p>
		</div>
	);
}
async function TeamDrivingLoading() {
	const t = await getTranslate();
	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader title={t("team.driving.title", "Driving details missing")} />
			<LoadingRegion
				label={{ labelKey: "team.driving.loading", labelDefault: "Loading driving details" }}
				role="status"
				className="space-y-4"
			>
				<Skeleton aria-hidden="true" className="h-10 w-full max-w-md" />
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</LoadingRegion>
		</div>
	);
}
export default function TeamDrivingPage(props: TeamDrivingPageProps) {
	return (
		<Suspense fallback={<TeamDrivingLoading />}>
			<TeamDrivingContent {...props} />
		</Suspense>
	);
}
